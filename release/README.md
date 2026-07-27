# Immutable release-candidate rehearsal

Issue #23 is a fail-closed approval gate. This workflow creates one candidate,
rehearses it only in an isolated production-like Supabase project, and emits a
reviewable `go` or `no-go` report. It never deploys to, migrates, or changes the
rollout state of the production project.

The active production project ref is `cmayisxvronrwvzhyuer`. It must never be
used as the rehearsal project ref.

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

Mark a check `passed` only when its `evidence` array names at least one captured
artifact. Any missing, failed, or evidence-free check is a `no-go`.

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
