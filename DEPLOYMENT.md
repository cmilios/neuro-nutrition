# NeuroNutrition operator deployment runbook

**Audience:** maintainers who are authorized to deploy NeuroNutrition.

**Purpose:** deploy, verify, and roll back the GitHub Pages frontend and the
Supabase backend without treating repository files as proof of current
production state.

NeuroNutrition is a static React/Vite frontend backed by Supabase Auth,
Postgres, and three Edge Functions. The production Supabase project reference
is `cmayisxvronrwvzhyuer`, and the public application URL is
<https://cmilios.github.io/neuro-nutrition/>. These public identifiers are
included because operators need them to select and verify the deployment
target. They are not credentials.

## Current-truth and evidence boundary

This runbook describes procedure, not present-tense readiness. A committed
migration, workflow, function directory, or `supabase/config.toml` entry shows
deployment intent only. It does not prove that the corresponding production
resource is configured, deployed, healthy, or serving the release under
review.

For every release, record non-secret evidence tied to the exact commit:

- commit SHA and the successful local/CI check runs;
- the remote migration inventory before and after deployment;
- Edge Function names, versions, JWT-verification mode, and deployment time;
- the GitHub Pages run URL and deployed commit SHA;
- live smoke-test outcomes and any incident references;
- the operator, timestamps, release decision, and rollback point.

Evidence may contain public project identifiers, release IDs, workflow URLs,
and sanitized outcomes. Never record secret values, authorization codes,
tokens, email addresses, raw provider errors, credentials, Health Profile data,
Weekly Plan contents, or client-confidential material in the repository,
issues, logs, screenshots, or build artifacts.

## System and authority boundaries

```text
Browser on GitHub Pages
  |-- public Supabase configuration + user session --> Supabase Auth/Postgres
  |-- user session --> generate-meal-plan --> OpenAI
  `-- privacy-limited incident signal --> client-incident-alert

GitHub Actions observation runner
  `-- dedicated monitoring credential --> weekly-plan-observation
                                      `--> generate-meal-plan/release-identity
```

Postgres and the Edge Functions are authoritative for persisted application
state. Browser cache is a read-only fallback and is never deployment evidence.

## Prerequisites and ownership

Before starting, confirm:

- a release owner and rollback decision-maker are named;
- the release commit is reviewed, immutable for the deployment, and available
  from the main repository;
- Node.js 20 and npm 10 are installed;
- the Supabase CLI is installed or available through `npx`, and the operator is
  authenticated to the production project;
- the GitHub CLI is authenticated with access to Actions variables, secrets,
  workflows, and Pages deployments;
- the operator can access the approved secret vault, Supabase dashboard, and
  provider consoles required for the release;
- a reviewed last-known-good frontend and Edge Function source revision is
  identified;
- database-affecting releases have an approved recovery point and restore
  procedure. Follow the isolated rehearsal and recovery-point gate in
  [`release/README.md`](release/README.md) before touching production.

Run `supabase <command> --help` before using an unfamiliar CLI command. The CLI
changes independently of this repository. The examples below use `npm` and
`npx`; in Windows PowerShell, use `npm.cmd`, `npx.cmd`, and `curl.exe` for the
corresponding commands.

## Configuration ownership

### Public browser configuration

The values below are bundled into client JavaScript and must be treated as
public even when GitHub stores them in its Actions **Secrets** UI:

| Name | Owner | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | GitHub Actions secret | Public URL of the selected Supabase project. |
| `VITE_SUPABASE_ANON_KEY` | GitHub Actions secret | Browser publishable/legacy anon key; authorization still depends on RLS and user identity. |
| `VITE_CLIENT_INCIDENT_ALERT_URL` | GitHub Actions secret | Optional browser-visible fallback endpoint for a sanitized incident signal. |
| `VITE_OAUTH_GOOGLE_MODE` | GitHub Actions variable | Independent Google rollout mode: `off`, `verify`, or `on`; invalid values fail closed to `off`. |
| `VITE_OAUTH_APPLE_MODE` | GitHub Actions variable | Independent Apple rollout mode: `off`, `verify`, or `on`; invalid values fail closed to `off`. |
| `VITE_RELEASE_ID` | deployment workflow | Set from the deployed commit SHA for privacy-limited incident attribution. |
| `WEEKLY_PLAN_OBSERVATION_ENABLED` | GitHub Actions variable | `manual` permits dispatched observation; `true` permits dispatched and scheduled observation. Any other value skips the workflow. |

`.env.example` is the authoritative list of public local-development names. It
contains placeholders and public identifiers only. `.env.local` is ignored by
Git and must not contain server credentials.

### Server and operator secrets

| Name or class | Owner | Boundary |
| --- | --- | --- |
| `OPENAI_API_KEY` | Supabase Edge Function secret | Server-side OpenAI credential used by `generate-meal-plan`; never a `VITE_*` value. |
| `OPENAI_MODEL` | Supabase Edge Function configuration | Optional server-side model override; verify the selected value for each release. |
| `CLIENT_INCIDENT_WEBHOOK_URL` | Supabase Edge Function secret | Optional forwarding destination used by `client-incident-alert`. |
| `OBSERVATION_*_URL` | GitHub Actions secrets | Monitoring endpoints; do not infer reachability from their presence. |
| `OBSERVATION_*_TOKEN` | GitHub Actions secrets | Dedicated high-entropy monitoring credential; never use a Supabase service credential in the runner. |
| `OBSERVATION_ALERT_URL` | GitHub Actions secret | Optional independent operator alert destination. |
| Supabase service credentials | Supabase-managed Edge Function environment | Used only inside privileged functions; never expose them to the browser or observation runner. |
| OAuth provider credentials and Apple `.p8`/client-secret JWT | provider console, approved vault, and Supabase Auth | Follow the specialist OAuth runbooks; never copy values into release evidence. |

Use name-only inventory commands when checking configuration:

```text
gh secret list
gh variable list
npx supabase secrets list --project-ref cmayisxvronrwvzhyuer
```

Set Supabase secrets from a temporary, access-controlled file outside the
repository. Do not put a literal secret in shell history or a command example:

```text
npx supabase secrets set --env-file <secure-temporary-env-file> --project-ref cmayisxvronrwvzhyuer
```

Delete the temporary file through the organization's secure process after the
CLI confirms the update. A successful secret update is not proof that the
dependent function works; verification remains required.

### Hosted Supabase Auth configuration

[`supabase/config.toml`](supabase/config.toml) defines local intent; it does not
update or prove the hosted Auth settings. In the production Supabase dashboard,
revalidate these settings before any Auth-affecting release:

- **Site URL:** `https://cmilios.github.io/neuro-nutrition/`;
- **Redirect URLs:** the production root above and
  `https://cmilios.github.io/neuro-nutrition/recover-password`; include the
  documented localhost root and recovery URLs only when hosted-project local
  testing requires them;
- **Email:** record whether confirmation is enabled and exercise that exact
  signup branch; verify production SMTP delivery before relying on confirmation
  or password recovery;
- **Password policy:** require at least eight characters with at least one
  letter and one number, and require the current password for authenticated
  password changes; verify the hosted controls rather than inferring them from
  local config;
- **Manual identity linking:** keep it enabled while the Account Security
  disconnect flow depends on `unlinkIdentity` for multi-method accounts.

Do not change hosted Auth policy as an incidental deployment step. A mismatch
blocks the release until the intended setting is reviewed, applied by an
authorized owner, and verified with dedicated non-personal accounts. Provider
credentials, callback setup, staged activation, and Apple rotation remain
owned by the specialist [OAuth runbooks](#oauth-gate).

## Edge Function authentication boundaries

All three functions deliberately set `verify_jwt = false` in
[`supabase/config.toml`](supabase/config.toml). Do not flip the setting or add
`--verify-jwt` as a documentation-only cleanup. The functions implement
different application-level boundaries that must be preserved and tested:

- `generate-meal-plan` accepts application operations by `POST`. Before any
  application behavior, it requires a bearer session token and validates it
  through Supabase Auth. Its GET-only `/release-identity` route accepts only the
  dedicated monitoring bearer credential and reports whether the immutable
  deployment version matches the reviewed version.
- `weekly-plan-observation` is GET-only. It compares the supplied monitoring
  bearer credential by SHA-256 digest, accepts only the `database`,
  `release-identity`, and `function-failures` probes, and keeps the privileged
  Supabase credential inside the function.
- `client-incident-alert` accepts `POST` and CORS `OPTIONS` without a user
  credential because browser `sendBeacon` cannot attach one. It reads no user
  data and writes no database data. It accepts a closed, size-limited payload,
  rate-limits per isolate, logs only allow-listed fields, and optionally
  forwards the sanitized alert.

These descriptions are derived from the committed handlers and their tests.
They do not prove the deployed versions contain the same code. Compare the
live function inventory and run the release verification below.

## Release procedure

### 1. Pin the release and run preflight checks

Start from a clean checkout of the exact reviewed commit. Record the SHA and
confirm no deployable input is modified:

```text
git status --short
git rev-parse HEAD
npm ci
npm run docs:check
npm test
npm run typecheck
npm run build
```

The release is blocked if any command fails, the worktree is dirty, or CI is
not green on the same SHA.

For database or Edge Function changes, complete the isolated rehearsal,
recovery-point proof, and `go` decision in [`release/README.md`](release/README.md).
That gate does not deploy production by itself.

### 2. Capture the live baseline

Link the CLI explicitly to the public production project reference and record
the non-secret inventories:

```text
npx supabase link --project-ref cmayisxvronrwvzhyuer
npx supabase migration list --linked
npx supabase functions list --project-ref cmayisxvronrwvzhyuer
npx supabase secrets list --project-ref cmayisxvronrwvzhyuer
gh secret list
gh variable list
gh run list --workflow deploy.yml --limit 5
gh run list --workflow observe-weekly-plan.yml --limit 5
```

Stop on an unexpected target, missing migration, unknown function version,
failed monitoring run, or unexplained configuration drift. Investigate and
record a sanitized disposition before proceeding.

### 3. Apply database migrations

Review every unapplied migration in `supabase/migrations/` and confirm the
approved recovery point exists. Preview the remote change, then apply it once:

```text
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

The post-push inventory must show exactly the reviewed migrations. Never repair
migration history or make an ad hoc production schema edit merely to make the
lists match. A history mismatch is a release blocker requiring diagnosis and
an explicitly reviewed recovery plan.

Database rollback is normally a forward corrective migration. Do not run
destructive reverse SQL against production from this runbook. If safety cannot
be restored forward, stop application mutation and use the approved recovery
point/restore procedure.

### 4. Deploy Edge Functions

Deploy only the functions changed by the release, naming each one explicitly.
The commands read the per-function authentication mode from
`supabase/config.toml`:

```text
npx supabase functions deploy generate-meal-plan --project-ref cmayisxvronrwvzhyuer
npx supabase functions deploy weekly-plan-observation --project-ref cmayisxvronrwvzhyuer
npx supabase functions deploy client-incident-alert --project-ref cmayisxvronrwvzhyuer
npx supabase functions list --project-ref cmayisxvronrwvzhyuer
```

Omit unchanged functions. After deployment, record the version and verify that
`verify_jwt` remains `false` for every deployed function. For a deliberate
`generate-meal-plan` deployment, update and review its expected immutable
deployment version as described in [`release/README.md`](release/README.md);
otherwise the release-identity probe must fail closed.

### 5. Deploy the frontend

The authoritative frontend workflow is
[`deploy.yml`](.github/workflows/deploy.yml). A push to `main` or an authorized
manual dispatch builds the application and publishes `dist/` to GitHub Pages.
Before deployment, confirm the GitHub environment contains the required public
configuration names and the intended independent OAuth modes.

For the normal main-branch release, use the workflow run triggered by the merge
of the pinned commit and inspect it directly. Do not manually dispatch mutable
`main`: it may advance between approval and dispatch.

For an authorized manual deployment or recovery, create a reviewed immutable
tag that points at the pinned SHA, push it without force, and dispatch that tag:

```text
git tag --annotate deploy-<release-id> <pinned-sha> --message "Deploy <release-id>"
git push origin refs/tags/deploy-<release-id>
gh workflow run deploy.yml --ref deploy-<release-id>
gh run list --workflow deploy.yml --limit 5
gh run view <run-id> --json status,conclusion,headSha,jobs,url
```

Do not approve the release until the run completed successfully and `headSha`
equals the pinned release SHA. Never move or reuse a deployment tag. A green
local build or an uploaded artifact is not proof that Pages serves that commit.

## Verification and release gates

### Automated gate

The exact release commit must pass:

- `npm run docs:check`;
- the full Vitest suite;
- TypeScript typechecking;
- the production Vite build;
- the repository's required GitHub checks.

### Live backend and frontend gate

After all deployment steps:

1. Re-run the migration and function inventories and compare them with the
   reviewed release inputs.
2. Prove the Pages deployment record belongs to the pinned SHA, then fetch the
   live root with a cache-busting query and require a successful response:

   ```text
   gh api "repos/cmilios/neuro-nutrition/deployments?environment=github-pages&sha=<pinned-sha>"
   gh api repos/cmilios/neuro-nutrition/deployments/<deployment-id>/statuses
   curl --fail --silent --show-error --location "https://cmilios.github.io/neuro-nutrition/?release=<pinned-sha>" --output <temporary-index-file>
   ```

   Require an active/successful `github-pages` deployment tied to the SHA, then
   open the same URL in a clean browser session and confirm the current app
   shell and expected release behavior. The release ID is telemetry context,
   not a visible UI field, so do not claim it was read from the page.
3. Use dedicated non-personal test accounts. Verify email/password sign-in,
   session restoration, Health Profile loading, Current Weekly Plan loading,
   one authorized generation path relevant to the release, logout, and reload.
4. Confirm an unauthenticated `generate-meal-plan` application request is
   rejected. Do not paste a real user token into release evidence or shell
   history.
5. Check `gh variable get WEEKLY_PLAN_OBSERVATION_ENABLED` and require `manual`
   or `true`; any other value would skip the job and cannot satisfy the gate.
   Dispatch `Observe authoritative Weekly Plan`, inspect the run, and require
   the observation job—not merely the workflow—to complete successfully with
   database, release-identity, and function-failure evaluations. The runner
   must use only its dedicated monitoring credential.
6. Coordinate an expected synthetic incident-channel check with the operator
   receiving alerts. Load the configured endpoint into a non-echoed shell
   variable, send only this closed, non-personal payload, and require HTTP 204
   plus the expected sanitized log/forwarded alert:

   ```text
   curl --fail --silent --show-error --request POST "<client-incident-alert-url>" --header "Origin: https://cmilios.github.io" --header "Content-Type: text/plain" --data '{"eventType":"telemetry_delivery_failure","failedEvent":"operator_health_check","occurredAt":"<ISO-8601-timestamp>"}'
   ```

   Never substitute a real failure payload, user identifier, provider response,
   or credential. Record only the 204 outcome and sanitized alert reference.
7. Review sanitized Supabase Auth and Edge Function logs for the release window
   and resolve unexpected authentication, function, or migration failures.

Local files and automated mocks cannot satisfy these live checks.

### OAuth gate

Google and Apple release and rollback independently. This runbook owns only the
shared deployment sequence. Do not duplicate provider credentials or lifecycle
steps here:

- use the [OAuth verification matrix](docs/oauth/verification-matrix.md) for
  Gate A and the complete automated/manual case mapping;
- use the [OAuth release checklist](docs/oauth/release-checklist.md) for each
  provider's evidence-bearing `verify` to `on` decision;
- use the [Apple rotation runbook](docs/oauth/apple-rotation-runbook.md) for
  Apple client-secret rotation and recovery.

A provider that fails verification returns to `off` while the other provider's
mode remains unchanged. It must clear its own gates again before returning to
`on`.

### Go/no-go decision

Choose **go** only when the exact release SHA has green automated checks, the
live inventories match the reviewed inputs, Pages serves that SHA, applicable
user journeys pass, monitoring passes, every OAuth provider being promoted has
its own completed gate, and rollback evidence is ready. Any missing, stale, or
contradictory evidence is **no-go**.

## Rollback

Rollback is a new, observable release. Record its commit, operator, reason,
start/end timestamps, commands, workflow URLs, live verification, and outcome.

### Frontend rollback

Prefer a reviewed revert merged to `main`; the normal Pages workflow then
produces an auditable deployment. For emergency recovery, dispatch
`deploy.yml` from a reviewed last-known-good branch or tag and verify the run's
`headSha`, the Pages deployment/status record, the cache-busted live response,
and the clean-browser smoke check described above. Do not call a local `dist/`
directory proof of rollback.

### Edge Function rollback

Use a clean checkout of the reviewed last-known-good source. Deploy only the
affected function, preserving its deliberate `verify_jwt = false` setting and
custom authentication boundary. Then record the new function version, rerun
the relevant authenticated/unauthenticated checks, and run the observation
workflow. Rolling back `generate-meal-plan` also requires its release-identity
version contract to match the redeployed version.

### Database rollback

Stop mutation paths if the schema is unsafe. Prefer a reviewed forward repair.
If forward repair is not safe, use the approved recovery point and restore
procedure from the rehearsal gate. Never delete migration-history records,
apply reverse SQL, or restore over production without explicit incident
authority and a verified recovery plan.

### OAuth and secret rollback

Set only the failing provider's mode to `off` and redeploy; follow its OAuth
runbook before promoting again. For a compromised secret, disable the affected
integration, rotate it through the owning vault/provider/Supabase surface,
redeploy dependent components, and re-run the full applicable gate. Do not put
the old or new value in evidence.

## Completion record

A deployment is complete only when the evidence record contains:

- exact deployed and rollback SHAs;
- successful check and workflow links;
- before/after migration and function inventories;
- sanitized live verification outcomes;
- per-provider OAuth decisions where applicable;
- monitoring and alert-channel outcomes;
- a signed `go`, `no-go`, or rollback decision;
- links to resolved incidents or follow-up issues for every discrepancy.

Keep time-sensitive status in that release evidence, not in this runbook.
