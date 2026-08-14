# Immutable release-candidate rehearsal

**Audience:** authorized operators and maintainers working on release tooling.

**Purpose:** explain the fail-closed rehearsal, observation, and delivery-gate
tools that support the operator procedure in [`DEPLOYMENT.md`](../DEPLOYMENT.md).

Issue #23 is a fail-closed approval gate. This workflow creates one candidate,
rehearses it only in an isolated production-like Supabase project, and emits a
reviewable `go` or `no-go` report. It never deploys to, migrates, or changes the
rollout state of the production project.

The active production project ref is `cmayisxvronrwvzhyuer`. It must never be
used as the rehearsal project ref.

## Post-release observation and delivery gate

Issue #25 adds a separate, read-only delivery gate. Migration
`20260730061940_create_weekly_plan_observation.sql` creates the
`weekly_plan_monitor` NOLOGIN role and grants it only execution of an aggregate
snapshot function. Provision the workflow token with that role; never use the
service-role key for observation.

The scheduled workflow asks GitHub for a run every fifteen minutes. GitHub
treats scheduled workflows as best-effort and throttles them, so the intervals
it actually delivers are longer and uneven; the delivery gate tolerates gaps of
up to three hours rather than requiring the requested cadence. Its three
GET-only probes return the aggregate database snapshot, immutable release
comparison, and critical function-failure count. Missing or failed probes fail
closed, emit a GitHub Actions operator alert, and optionally notify
`OBSERVATION_ALERT_URL`.
The runner has no plan-mutation path. Client telemetry is allow-listed,
content-free, best-effort, and cannot interrupt application behavior. Configure
the required `VITE_CLIENT_INCIDENT_ALERT_URL` deployment secret to route a
telemetry-storage outage to an independent, abuse-protected operator alert
endpoint. Alert configuration and reachability are delivery-gate evidence:
until they are verified, the final report remains blocked without preventing
the application from being built or deployed.

The schedule is disabled by default so an unprovisioned monitor does not create
continuous failed GitHub Actions runs. Before enabling it:

1. Apply `20260730061940_create_weekly_plan_observation.sql`.
2. Deploy the database, release-identity, and function-failure GET probes.
3. Configure their `OBSERVATION_*_URL` and least-privilege
   `OBSERVATION_*_TOKEN` repository secrets. `OBSERVATION_ALERT_URL` is
   optional.
4. Set the repository Actions variable `WEEKLY_PLAN_OBSERVATION_ENABLED` to
   `manual`, run `Observe authoritative Weekly Plan` manually, and confirm it
   passes.
5. Change `WEEKLY_PLAN_OBSERVATION_ENABLED` to `true` to start the schedule.

Removing that variable, or changing it to any other value, skips both scheduled
and manually dispatched observation. `manual` permits only dispatched
validation; `true` permits both dispatched and scheduled observation. This
keeps an unprovisioned monitor quiet without weakening its fail-closed behavior
when it is deliberately enabled.

The production implementation uses the `weekly-plan-observation` Edge Function
for the aggregate database and function-failure probes. The
`generate-meal-plan` Edge Function exposes a GET-only release-identity route.
Both verify the same high-entropy monitoring bearer credential by its SHA-256
digest; the credential itself exists only in GitHub Actions. Supabase's service
credential remains inside the observation function and is never sent to the
runner.

The three configured probe URLs are:

- `...?probe=database`
- `...?probe=release-identity`
- `...?probe=function-failures`

Each probe is attempted up to four times with a ten-second per-request timeout
and a linear backoff, so a single transient upstream error (a 502 from the
Supabase edge, a dropped connection) does not report the monitor as unavailable.
Retries cover network failures and the retryable statuses 408, 424, 429, 500,
502, 503 and 504. A `401` or `403` — our own monitoring credential rotated or
mistyped — fails immediately without retrying, so a genuine misconfiguration
still fails closed and fast. Exhausting all attempts remains a
`monitoring_unavailable` critical finding that fails the run.

`424` is retried despite being a 4xx, because the refusal it reports is
observed to be transient: gateway logs show the Data API answering `PGRST303`
on one call and `200` on the next with the same key, several times a day. Those
refusals were invisible until the function learned to report them separately —
the retry had always absorbed them. Treating one as fatal would fail a window
that is about to heal itself, so a refusal is only believed once it has
survived every attempt, and it is then still reported as `http_424` rather than
collapsing into an unreachable upstream. The cause of the intermittent refusal
is tracked separately and is not yet explained.

The observation function distinguishes the two upstream failure modes it can
meet, so that classification is reachable. When an upstream refuses the
credential the probe presented it, the function returns `424
probe_credential_rejected`, which the runner does not retry; an upstream that
could not be reached, or failed for any other reason, keeps `502
probe_unavailable` and is retried. Which credential was refused depends on the
probe: the database and function-failure probes present the service credential
held inside the function, so a `424` there means the Data API rejected it, while
the release-identity probe forwards the runner's own monitoring credential to
`generate-meal-plan`, so a `424` there means the two functions' expected digests
have drifted apart — typically a half-finished rotation. That is distinct again
from this function's own `401 unauthorized`, which means it rejected the
runner's credential itself. No upstream status text or message crosses the
boundary: the runner receives the error class only, per
[`docs/privacy-and-security.md`](../docs/privacy-and-security.md).

To rotate the monitoring credential, generate a new random 256-bit value, write
it to all three `OBSERVATION_*_TOKEN` GitHub secrets, replace its digest in both
Edge Functions, and deploy both functions together. A deliberate
`generate-meal-plan` deployment must also update the expected immutable
deployment version passed to its release-identity handler in `index.ts`; an
unreviewed redeployment then fails the release-identity check closed.

After at least 24 hours, assemble every timestamped monitor artifact into the
input and create the immutable final report with `npm.cmd run
observation:report`. It derives cadence from those timestamps and says
`delivered` only when every observation is clean, no gap exceeds three hours,
alert reachability is evidenced, the identified recovery point has
direct retention proof through at least seven days after the window, all
required evidence links are present, and every finding has a resolved
disposition. A summary comment or declared timestamp cannot satisfy these
gates.

## 1. Prepare and pin one candidate

Start from a clean commit. Record the full Edge Function deployment version
reported by the isolated project; a mutable label such as `latest` is not an
acceptable version.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

$candidateCommit = git rev-parse HEAD
node release/cli.mjs manifest `
  --commit $candidateCommit `
  --project-ref <isolated-project-ref> `
  --region eu-west-1 `
  --function-version generate-meal-plan=<isolated-deployment-version> `
  --out release/evidence/release-manifest.json
node release/cli.mjs verify `
  --manifest release/evidence/release-manifest.json
```

The output file is create-only. The manifest pins the commit, every SQL
migration checksum, each Edge Function version and source checksum, every
frontend artifact file and checksum, and the isolated target identity. Copying
or rebuilding a deployable input invalidates the candidate.

## 2. Rehearse the exact candidate

Create two independent test accounts and browser sessions in the isolated
project. Load only sanitized legacy fixtures plus synthetic invalid, duplicate,
wrong-owner, and canonical-mismatch fixtures. Apply the pinned migrations,
deploy the pinned function source, and publish the pinned frontend artifact.

Capture machine-readable command output, SQL query results, screenshots, and
request/response envelopes under the manifest's
`release/evidence/<candidate-id>/` directory. Paths recorded in the results file
are relative to that directory. Evidence
must contain no credentials, prompts, Weekly Plan contents, ingredients, raw
exceptions, or production user data.

Generate the candidate-bound checklist from the gate's authoritative catalogue:

```powershell
node release/cli.mjs template `
  --manifest release/evidence/release-manifest.json `
  --out release/evidence/rehearsal-results.json
```

Exercise every generated check:

- Prove invalid documents and source/destination count, ownership, and
  canonical-content mismatches abort the transaction, preserve source rows and
  the legacy column, and leave rollout in maintenance.
- Prove missing secrets and a wrong Edge Function release fail before mutation.
- Remove the Realtime publication in isolation and prove the gate detects it.
- Prove cross-account reads and direct authenticated writes are denied.
- Drop a successful response and retry the same command identity; prove one
  provider call, one mutation, and the recorded result.
- Simulate frontend publication and privacy-limited telemetry failures; neither
  may activate authority or corrupt user behavior.
- Enter emergency maintenance and prove both database and Edge Function
  mutations are rejected while reads remain available.
- Run the complete signed-in journey in two independent sessions: load,
  ingredient progress, concurrent generation, Meal Reroll, disconnect/refetch,
  stale request, response loss/retry, recovery, reload, and Start Over.

Mark a check `passed` only when its `evidence` array names at least one JSON
execution envelope. Each envelope must contain `schemaVersion: 1`, the manifest
`candidateId`, the check name, isolated `targetProjectRef`, ISO `startedAt` and
`completedAt`, the executed `command`, `exitCode: 0`, and one or more named
`assertions` with `status: "passed"`. The two-session check must additionally
name at least two distinct opaque session IDs in `sessions`. Screenshots, query
results, and request envelopes can be listed from the execution envelope.
Candidate association, structure, file readability, and checksums are verified
when the report is created. Any missing, malformed, failed, or evidence-free
check is a `no-go`.

## 3. Create and restore the recovery point

Before migration, create a project recovery point using the organization's
approved Supabase backup mechanism. Restore it into a second isolated project,
then compare migration inventory, user ownership, Current Weekly Plan
invariants, and rollout state with the source snapshot. Record separate evidence
for `recovery-point-created` and `recovery-point-restored`.

Do not put exports or credentials in this repository.

## 4. Record the decision

Update the generated results with statuses and candidate-relative evidence
paths, then create the report:

```powershell
node release/cli.mjs report `
  --manifest release/evidence/release-manifest.json `
  --results release/evidence/rehearsal-results.json `
  --out release/evidence/rehearsal-report.json
```

The command exits non-zero for `no-go`. It also refuses a manifest whose target
is production. Attach the manifest and report to issue #23 and record the
decision there. A `go` approves only the later controlled cutover checkpoint;
it does not itself authorize or alter production.
