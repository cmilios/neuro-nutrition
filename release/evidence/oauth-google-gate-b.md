# Gate B evidence record — provider `google`

Per [docs/oauth/release-checklist.md](../../docs/oauth/release-checklist.md),
backed by [docs/oauth/verification-matrix.md](../../docs/oauth/verification-matrix.md).

**Provider:** `google` · **Commit SHA:** `3fb24d9` ·
**Release ID:** `3fb24d90b74eddf512285f54abe11104fb2b8641` ·
**Supabase project ref:** `cmayisxvronrwvzhyuer` ·
**Verification URL:** `/neuro-nutrition/verify-oauth/`

**Status: PROMOTED to `on` 2026-08-08**, on operator authorisation with M1 and
M10 accepted as documented partials. Findings 1–4 and 6 are resolved and
verified in production. Finding 5 is fixed in code (not yet merged to `main`
or deployed as of this writing — see [Finding 5](#5-raw-error-objects-reach-the-browser-console-on-oauth-paths---fixed-not-yet-deployed)).
See [Findings](#blocking-findings) and [Promotion](#promotion).

Earlier revisions of this record were written against the pre-merge commit
`0720be1`; the header above is the commit actually deployed at promotion.

## Gate A confirmation

`deploy.yml` builds and deploys but **runs no tests**, so CI does not establish
Gate A on any commit. Gate A was therefore established locally against the
deployed commit `0720be1` on 2026-08-08: `npm test` 290/290, `npm run typecheck`
clean, `npm run build` clean.

**Re-established on the promoted commit `3fb24d9` (2026-08-08):**
`npx vitest run --no-file-parallelism` → **306/306 in 44/44 files**,
`npm run typecheck` clean, `npm run build` clean.

Caveat, now with a remedy: the suite is flaky under *parallel* load. Successive
full runs on this same commit produced 6 failures, then 1 failure in a different
file, then a clean 306/306 sequentially — all `beforeEach` / render hook
timeouts in PGlite and `App.test.tsx`, never assertion failures. Running with
`--no-file-parallelism` is deterministic and green, which removes the objection
to adding a CI test job: the job should pin file parallelism rather than run the
default. Cost is runtime, 127s against ~54s.

## Live configuration observed (2026-08-08)

Recorded **before promotion**, while the gate was still `verify`:

| Item | Observed |
| --- | --- |
| `VITE_OAUTH_GOOGLE_MODE` | `verify` |
| `VITE_OAUTH_APPLE_MODE` | `off` |
| Supabase `/auth/v1/settings` | `google: true`, `apple: false`, `email: true` |
| Deployed Pages commit | `0720be1` (workflow run succeeded) |
| `/neuro-nutrition/verify-oauth/` | HTTP 200 |

Gating behavior verified live on that build: Log In and Create Account showed
email/password only with no provider rail; the verification URL showed
"FASTER SIGN-IN → Continue with Google" and no Apple. This matched the `verify`
contract (matrix G2, G5).

The post-promotion configuration — `google: on`, commit `3fb24d9`, providers
now shown on Log In and Create Account — is recorded under
[Promotion](#promotion). Both states are kept deliberately: the `verify`
observation is the evidence that gating worked before the gate was opened.

## Manual verification cases

| # | Case | Outcome | Evidence |
| --- | --- | --- | --- |
| M1 | New sign-in | **Partial — accepted** | No never-seen Google account was available. Covered indirectly by M8; the residual gap is stated under [M1 residual risk](#m1-residual-risk). Operator accepted 2026-08-08. |
| M2 | Returning sign-in | **Pass** | Auth logs 2026-08-08 show four separate `/authorize` → `/callback` → `login_method: oauth, provider: google` cycles for the same existing user, all `302`/success. |
| M3 | Cancellation / denied consent | **Pass** | Operator cancelled at Google's consent screen 2026-08-08; the app recovered with no error state. `weekly_plan_client_incidents` holds zero `oauth_auth_failure` rows, so cancellation was correctly not treated as a failure (matrix C2). |
| M4 | Session restoration across the real redirect | Not re-run here | Reported in a prior session against `27caf4b`. |
| M5 | Display Name handling | Not re-run here | Reported in a prior session against `27caf4b`. |
| M6 | Account Security connected methods | **Pass** | Finding 6 found and fixed this session. After enabling manual linking, `DELETE /user/identities/…` returned `200` with an `identity_unlinked` audit event for `provider: google`. |
| M7 | Logout then re-login | **Pass** | Auth logs 2026-08-08 show `logout` (204) followed 13s later by `/authorize` → `/callback` (302) and a `login_method: oauth, provider: google` for the same user. Derived from logs, not an observed UI run. |
| M8 | Same-email automatic linking | **Pass** | Directly demonstrated 2026-08-08: the Google identity was unlinked (`200`), then a subsequent Google sign-in 31s later attached to the **same user id** rather than creating a second account. |
| M9 | Apple private relay | `N/A` | Apple remains `off`. |
| M10 | Email/password regression | **Partial — accepted** | Registration verified in production (see below). Change-password and recovery deliberately not run; operator accepted 2026-08-08. |
| M11 | Failure paths emit sanitized evidence | **Pass** | Sanitization proven by unit tests; delivery proven live (below). Triggering a real provider error is covered by the operator's M3 run. At promotion time this Pass covered the stored-incident payload only, not the browser console — see finding 5, fixed in code post-promotion but not yet deployed. |
| M12 | Incident-channel health check | **Pass** | Live end-to-end check against production with the anon key, 2026-08-08 — see [Live incident-channel health check](#live-incident-channel-health-check). |
| M13 | Monitoring | **Running** | Mechanism verified pre-promotion: the observation snapshot classified a live `oauth_auth_failure` as `critical`. Baseline captured at promotion and the 24h watch started — see [M13 monitoring](#m13-monitoring). |

### What passes

`services/clientIncidentTelemetry.ts` allow-lists context keys and truncates
each value, so tokens, authorization codes, emails and raw provider text cannot
reach an incident row even if a caller passes them;
`services/clientIncidentTelemetry.test.ts` asserts this directly. All five
`reportOAuthFailure` call sites in `App.tsx` pass stable string literals, and
cancellation is explicitly excluded from incident reporting, matching matrix C2
and C5. The built bundle in `dist/` contains no client secret, no Google client
ID and no `service_role` key.

The sanitization contract is therefore sound. Everything below concerns
*delivery* — no OAuth incident can reach storage at all.

## Blocking findings

### 1. The stored context contract rejects the payload the client sends — **resolved**

`private.is_privacy_limited_client_context` backs a CHECK constraint on
`weekly_plan_client_incidents.context` and allowed only `provider`, `phase`,
`operation`, `authorityStatus`, `errorCode`. `reportOAuthFailure` in `App.tsx`
sends `provider`, `lifecycleStage`, `errorCode`, `releaseIdentifier`,
`timestamp` — three of which have no permitted key.

Reproduced against all local migrations applied in PGlite:

```
error: new row for relation "weekly_plan_client_incidents"
violates check constraint "weekly_plan_client_incidents_context_check"
```

Every OAuth incident insert fails this constraint, including for authenticated
users. The existing DB test passed only because it hand-wrote a payload using
`phase` and omitting `releaseIdentifier` and `timestamp` — a payload the client
never sends.

The keys the matrix requires (C5: provider, lifecycle stage, stable error code,
release id, timestamp) are precisely the ones the database refused.

### 2. The migration enabling OAuth incidents was never applied to production — **resolved**

`supabase/migrations/20260805120000_allow_oauth_auth_failure_incident.sql` adds
`oauth_auth_failure` to the `event_type` CHECK constraint. It is the **only**
local migration absent from the applied list on project `cmayisxvronrwvzhyuer`.
Without it, `oauth_auth_failure` is not a permitted event type at all, so the
insert fails even before finding 1 applies.

Note also that the remote migration history does not correspond to local
filenames (for example `create_weekly_plan_observation` is recorded remotely as
version `20260730061940` against local `20260729120000`). Applying the pending
migrations needs care rather than an unexamined `supabase db push`.

### 3. Signed-out OAuth failures cannot execute the reporter — **resolved**

`record_weekly_plan_client_incident` was granted to `authenticated` only —
`revoke all ... from public, anon` — and raised `'Authentication is required'`
when `auth.uid()` was null. Verified against the live project with the anon key:

```
POST /rest/v1/rpc/record_weekly_plan_client_incident
HTTP 401  {"code":"42501","message":"permission denied for function record_weekly_plan_client_incident"}
```

Three of the five OAuth failure paths run with no session, so all three hit
this: `App.tsx:382` (`oauth_callback_failed`), `App.tsx:399`
(`session_restore_failed`), `App.tsx:700` (`redirect_start_failed`).

### 4. The operator-alert fallback is unconfigured in production — **receiver deployed, secret pending**

When the RPC fails, `clientIncidentTelemetry.ts` falls back to `alertOperator`,
which reads `VITE_CLIENT_INCIDENT_ALERT_URL` and returns immediately if unset.
`deploy.yml:40` wires it from `secrets.VITE_CLIENT_INCIDENT_ALERT_URL`, but no
such secret exists on the repository (`gh secret list` — absent).

Findings 1–4 compound into a silent loss: RPC rejects → `console.warn` in the
end user's own browser → `alertOperator` no-ops → incident discarded. Nothing
reaches any operator surface.

### 5. Raw error objects reach the browser console on OAuth paths — fixed, not yet deployed

`App.tsx:393` and `App.tsx:696` logged raw Supabase/provider error objects via
`console.error`. Client-side only and not exfiltrated, but M11 asks that no raw
provider messages appear in logs or browser code. Noted, not treated as a hard
blocker, at promotion time.

**Fix.** Both call sites now log the stable `errorCode` string already computed
at that site for `reportOAuthFailure` (`session_restore_failed` and
`redirect_start_failed` respectively) instead of the caught error object. The
now-unused caught-error bindings (`catch (sessionError)`, `catch (oauthError)`)
were removed rather than kept and ignored.

**Scope decision: narrow, not general.** The same
`console.error(message, rawError)` pattern exists at twelve other sites in
`App.tsx` (non-OAuth: profile/plan loading, logout, meal-reroll and generation
command paths). Only the two named sites sit on an OAuth failure path, which is
M11's stated scope (`each | failure paths`, scoped per-provider in the
verification matrix — not a codebase-wide console-hygiene rule). Fixing all
fourteen would be a broader logging-policy change than the matrix asked for and
was out of scope for this finding; it's left as a candidate follow-up if the
project wants that as a general rule rather than an OAuth-specific one.

**Regression tests.** Extended the two existing tests that already exercise
these exact failure paths end-to-end, rather than adding a new isolated test:
`App.sessionRestore.test.tsx` ("returns to Log In with a retryable message when
session restoration fails") and `App.oauth.test.tsx` ("returns to Log In with a
retryable toast when %s redirect setup fails"). Each now asserts
`console.error` was called with the stable code and that the raw injected error
message (`"provider details must stay private"` / `"provider unreachable"`)
never appears anywhere in the mock's recorded call arguments.

**Verification:** `npx vitest run --no-file-parallelism` → 306/306 in 44/44
files (unchanged counts — assertions were added to existing tests, not new
ones), `npm run typecheck` clean, `npm run build` clean. Not yet merged to
`main` or deployed; the browser-console behavior above is verified by the
regression tests, not by a live check against production.

### 6. Disconnecting a sign-in method is impossible — manual linking is disabled — **resolved**

Observed 2026-08-08 in the deployed app: signed in with Google on an account
that also has a password, Account Security → Disconnect returned "The sign-in
method could not be disconnected. Please try again."

That is the failure branch, not the single-method guard. The guard at
`components/UserProfileModal.tsx:387` correctly stood aside — the account has
two identities — and `supabase.auth.unlinkIdentity` was called and refused.
Project auth logs show five identical failures:

```
DELETE /user/identities/<identity_id>
404: Manual linking is disabled     error_code: manual_linking_disabled
```

`unlinkIdentity` requires the project's manual-linking option, which is
disabled. The control therefore cannot work for *any* account with more than
one identity — which is every account that has used OAuth. Automatic linking is
unaffected, so accounts still merge by email correctly; only the reverse
operation is broken.

This is the same class of fault as findings 1–3: a client feature shipped and
unit-tested against a server configuration that was never applied. The unit
tests at `components/UserProfileModal.test.tsx:116` and `:161` both pass,
because they exercise the guard and the success path against a stubbed
`onDisconnectSignInMethod` — no test asserts the server permits the call.

Remediation: `enable_manual_linking = true` recorded in `supabase/config.toml`,
and the live project setting was enabled by the operator on 2026-08-08. Auth
logs show `reloading api with new configuration` at 16:34:25Z, and the next
Disconnect at 16:35:37Z returned `200` with an `identity_unlinked` audit event.
The same identity id that had failed five times succeeded. Resolved.

Caveat carried forward: no automated test would catch a regression here. The
existing unit tests stub `onDisconnectSignInMethod`, so a future project-setting
change that disables manual linking again would be silent until a user hits it —
exactly how this was found.

## Remediation (applied to production 2026-08-08)

| Change | Addresses |
| --- | --- |
| `supabase/migrations/20260808120000_record_unauthenticated_oauth_incidents.sql` | 1, 2, 3 |
| `services/clientIncidentContext.ts` (new shared contract) | 1, prevents recurrence |
| `services/clientIncidentTelemetry.ts` (imports the shared contract) | 1 |
| `supabase/migrations/weekly_plan_observation.test.ts` (drift guard + signed-out coverage) | 1, 3 |

The migration restates the `event_type` allow-list in full, so it repairs the
constraint whether or not the pending `20260805120000` has been applied. It
extends the context allow-list to the eight keys the client actually sends,
makes `user_id` nullable so a signed-out failure can be recorded unattributed,
and grants `anon` execute — narrowed to `oauth_auth_failure` only, with the
anonymous write path capped at 100 rows per minute so granting `anon` execute
does not create an unbounded insert endpoint. Past the cap the incident is
dropped rather than rejected, because telemetry must never surface an error into
a sign-in recovery path. Trade-off: a flood can crowd out genuine signal for
that minute.

`clientIncidentContext.ts` makes the key list a single shared contract imported
by both the client filter and the database test, so the two enforcement points
cannot drift apart again. The guard was mutation-checked: removing `timestamp`
from the SQL allow-list fails the suite with the exact production symptom.

Verification after the change: `npm test` 291/291, `npm run typecheck` clean,
`npm run build` clean.

### Applied to project `cmayisxvronrwvzhyuer`

Both pending migrations were applied on operator authorization, in order:
`allow_oauth_auth_failure_incident` then
`record_unauthenticated_oauth_incidents`. `supabase db push` was deliberately
not used, for the history-mismatch reason in finding 2.

Post-apply schema state, read back from the live project:

| Check | Result |
| --- | --- |
| `event_type` CHECK includes `oauth_auth_failure` | yes |
| `user_id` nullable | yes |
| `is_privacy_limited_client_context` accepts the client's five-key payload | `true` |
| `record_weekly_plan_client_incident` EXECUTE grants | `anon`, `authenticated` (not `public`) |

Migration-history caveat, since resolved (see below): the MCP recorded these
under generated versions `20260808155145` and `20260808155225` rather than the
local filenames `20260805120000` and `20260808120000`. Realigning the history
rows via direct `UPDATE` was blocked by a permission classifier. This was
cosmetic — `supabase db push` was already unusable because of the three
pre-existing mismatches noted in finding 2 — but it added two more entries to
that reconciliation backlog.

### Migration history reconciliation (2026-08-08)

All five mismatched rows (three pre-existing plus the two above) were
reconciled by **renaming the local migration files to the applied remote
versions**, rather than mutating `supabase_migrations.schema_migrations` on the
live project. This was a deliberate choice between two options considered:
`supabase migration repair --status applied/reverted <version>` against the
linked project, or the rename performed here. Repair is the more idiomatic
tool, but every mistake in it is a write against production bookkeeping — and
in this specific case, a wrong repair state could cause the next `db push` to
retry the first migration's `create table ... weekly_plan_client_incidents`,
which is not idempotent and would fail exactly as finding 2 described.
Renaming touches only local files and a test's expected-name list; a mistake
is caught by the test suite or a `db push --dry-run` before it ever reaches
Supabase, and never has a path to writing anything to the production project.
Operator approved this route on 2026-08-08.

| Old local filename | New local filename (= applied remote version) |
| --- | --- |
| `20260729120000_create_weekly_plan_observation.sql` | `20260730061940_create_weekly_plan_observation.sql` |
| `20260729135108_create_health_profile_plan_replacement_commands.sql` | `20260730062107_create_health_profile_plan_replacement_commands.sql` |
| `20260730071049_add_observation_function_failure_probe.sql` | `20260730071422_add_observation_function_failure_probe.sql` |
| `20260805120000_allow_oauth_auth_failure_incident.sql` | `20260808155145_allow_oauth_auth_failure_incident.sql` |
| `20260808120000_record_unauthenticated_oauth_incidents.sql` | `20260808155225_record_unauthenticated_oauth_incidents.sql` |

Every reference to the old filenames was updated: the `migrationNames` /
`migrations` arrays in `supabase/migrations/weekly_plan_observation.test.ts`
and `supabase/migrations/health_profile_plan_replacement_commands.test.ts`, an
internal comment in `20260808155225_record_unauthenticated_oauth_incidents.sql`
naming its sibling migration, and filename mentions in `DEPLOYMENT.md` and
`release/README.md`. SQL contents of all five files are unchanged — only the
version prefix moved.

The historical version numbers quoted earlier in this record (in finding 2 and
in the "Applied to project" section above) describe the mismatch as it stood
at promotion time and are left as written; they now refer to files that have
since been renamed per the table above.

Verified after the rename: `npx vitest run --no-file-parallelism` → 306/306 in
44/44 files, `npm run typecheck` clean, `npm run build` clean, and
`supabase db push --dry-run` (linked to `cmayisxvronrwvzhyuer`) reports no
pending migrations.

### Live incident-channel health check

Against production with the anon key, using the exact payload `App.tsx` sends
(matrix C5, checklist M12):

| Case | Before | After |
| --- | --- | --- |
| Signed-out `oauth_auth_failure`, full context | `401` `42501` permission denied | **`204`** |
| Signed-out `authoritative_load_failure` | `401` `42501` | `400` `P0001` "Authentication is required" |
| Signed-out `oauth_auth_failure` with an `email` key | `401` `42501` | `400` `23514` context CHECK violation |

The stored row carried `provider`, `lifecycleStage`, `errorCode`,
`releaseIdentifier`, `timestamp` and a null `user_id` — the C5 contract exactly,
with no identifying data. `get_weekly_plan_observation_snapshot()` then reported
`{"total": 1, "critical": 1}`, so the monitoring surface classifies these as
critical without further work. The probe row was deleted after the check.

The negative cases matter as much as the positive one: granting `anon` execute
did not widen the write path beyond OAuth failures, and did not weaken the
privacy filter.

### M1 residual risk

M1 asks for a Google account that has never used the app. None was available —
the only Google account to hand has extensive history here — and the
alternatives were rejected as disproportionate: a second Google account was not
available, and deleting the existing user to force first contact would have
destroyed that account's application data.

**What the M8 run does cover.** Unlinking the Google identity and signing in
again drove the full redirect → consent → callback → session path and caused
GoTrue to create a *new identity row* and attach it to a user. Redirect
handling, callback processing, session establishment and identity creation are
therefore exercised.

**What the M10 run covers.** Confirmed in the auth logs 2026-08-08: a
`POST /signup` returned `200` and created a brand-new `auth.users` row with
`provider: email` and no `user_data`, so the new-user bootstrap — first load
with no stored profile, and whatever onboarding that triggers — is exercised,
just not via Google. A preceding `422` also confirmed the password policy
(`letters_digits`, minimum 8) is enforced server-side in production, which
nothing had previously verified.

**What remains unproven.** Only the intersection: GoTrue creating a *new user*
from an *OAuth identity*, where no existing user matches the provider's email.
Concretely, two things are untested — the no-match branch of automatic linking,
and Display Name derivation from a Google profile onto a freshly created account
(M5 covered display name, but on an account that already existed).

This is narrower than "M1 was skipped", but it is not nothing: it is the exact
path every genuinely new user takes after promotion, and it is the first thing
they experience.

**Recommended mitigation, not yet performed.** During the controlled
verification window, confirm the first genuinely new Google user lands
correctly — a new `auth.users` row, a usable Display Name, and a working first
load. That converts this from an unknown into a watched risk, and it is now
observable because incident delivery works. Until then M1 is not a clean pass
and this record should not be read as one.

### M10 residual risk

Registration and server-side password-policy enforcement are verified above.
Password login, change-password and recovery were **not run**; the operator
accepted this on 2026-08-08, to be addressed reactively in production.

This is not a promotion risk: promoting Google does not touch the
email/password paths, so the exposure is identical before and after. It is a
pre-existing unknown that the checklist would have closed, not one the rollout
creates.

Worth checking separately, because it is the same shape as findings 1–3 and 6 —
a client feature depending on server configuration nobody confirmed: password
recovery requires working outbound email, and Supabase's built-in sender is
rate-limited and not intended for production use. If custom SMTP is not
configured, recovery fails for real users, and recovery is the only self-serve
route back in for someone locked out. No evidence either way was gathered.

### Why the incident count is now interpretable

After the operator's manual runs on 2026-08-08 — four Google sign-ins, a logout
cycle, an identity unlink, and a cancelled consent — `weekly_plan_client_incidents`
holds **zero** `oauth_auth_failure` rows.

That zero is only meaningful because delivery was proven first. Before the fix
the count was structurally pinned at zero: every insert was rejected, so a
healthy system and a completely broken one produced identical readings. Having
demonstrated that a real payload does reach the table and is classified
`critical`, a zero now genuinely means no failures occurred. This is the
condition M13's watch depends on — without it, monitoring a count that cannot
rise is theatre.

### Fallback receiver (finding 4)

`client-incident-alert` was deployed to the same project on 2026-08-08 and
verified live. It logs rather than writing to `weekly_plan_client_incidents`,
deliberately: the failure it exists to catch is that table refusing writes, so a
fallback that depended on it would be no fallback at all.

It is necessarily anonymous — `sendBeacon` cannot set an Authorization header —
so the payload is treated as hostile. Verified against the deployed endpoint:

| Case | Result |
| --- | --- |
| `OPTIONS` preflight from `https://cmilios.github.io` | `204` with the expected allow-origin/headers/methods |
| Valid alert, no Authorization header | `204` — confirms `verify_jwt` is off |
| `failedEvent` shaped like an access token | `400` `malformed_payload` |
| Body that is not JSON | `400` `malformed_payload` |
| Body over 1 KB | `413` `payload_too_large` |
| `POST` from an unrecognised origin | no `access-control-allow-origin` granted |
| `GET` | `405` `method_not_allowed` |

Only three validated fields survive into the log, and no part of the request is
echoed back, so an anonymous caller cannot write free text or personal data into
the operator's logs. The per-minute cap and the log emission itself are covered
by unit tests (8 cases in `handler.test.ts`) rather than exercised against
production, to avoid flooding it.

Log visibility: `console.warn` output appears under a function's **Logs** view,
not the **Invocations** view the dashboard opens by default, which is why the
first check appeared to show nothing. The MCP `get_logs` edge-function query
reads the request-level logs only, so it cannot see console output for any
function. The `204` response is itself evidence the line was emitted, since that
status is returned only after `recordAlert` runs.

Because a log line is a pull surface that nobody polls — the project's actual
monitoring path is `get_weekly_plan_observation_snapshot`, which a log line is
not on — the receiver can also forward to a notification channel. The channel
URL is a Supabase **function secret** (`CLIENT_INCIDENT_WEBHOOK_URL`), read
server-side and never present in the client bundle; a `VITE_`-prefixed webhook
would be inlined at build time and readable by anyone. Forwarding is
best-effort: the log line is written first, the response never waits on the
channel, and failures are reported as a closed set of codes rather than raw
fetch errors, since a Deno network error can embed the request URL — which is
the secret.

**Operator decision, 2026-08-08: no channel is configured.**
`CLIENT_INCIDENT_WEBHOOK_URL` is deliberately unset, which the forwarder
supports — it no-ops and the log line remains the record. Accepted consequence:
the organization is on the free plan, so function logs are retained about one
day, and a delivery failure that nobody looks for within that window leaves no
trace. This is a considered trade-off, not an outstanding gap.

The residual risk this leaves is specific and worth stating plainly: if incident
delivery breaks again, `clientIncidents.total` falls to zero, which is
indistinguishable from a healthy system with no OAuth failures. Silence reads as
health. That is how the faults above survived undetected. The mitigation that
addresses the realistic cause — a context key added on one side and not the
other — is the drift guard in `weekly_plan_observation.test.ts`, which prevents
recurrence rather than reporting it. That guard only protects if the suite runs;
`deploy.yml` runs no tests, so it currently depends on someone running
`npm test` locally. Adding a CI test job is the higher-value follow-up, gated on
settling the parallel-load flakiness recorded under Gate A.

**Still required and not done:** setting the `VITE_CLIENT_INCIDENT_ALERT_URL`
secret to the deployed function URL and redeploying Pages so the build inlines
it; merging and deploying the finding 5 fix (see
[Finding 5](#5-raw-error-objects-reach-the-browser-console-on-oauth-paths---fixed-not-yet-deployed));
and the operator-only manual cases M1, M3, M7, M10.

## Non-blocking observations

- **Implicit OAuth flow.** `services/supabaseClient.ts:10` calls `createClient`
  with no auth options, so auth-js v2.105.3 defaults apply — including
  `flowType: 'implicit'`. Supabase returns to the app with `access_token` and
  `refresh_token` in the URL fragment, which transits browser history before
  `detectSessionInUrl` strips it. PKCE (`flowType: 'pkce'`) exchanges a
  single-use code and never places a refresh token in the URL. Changing this is
  a behavior change that would re-open Gate A, so it is recorded rather than
  altered.
- **Supabase security advisors:** leaked-password protection is disabled (WARN);
  several `SECURITY DEFINER` functions are executable by `authenticated` (WARN).
  Neither is specific to Google sign-in.

## Promotion

Performed 2026-08-08 on explicit operator authorisation, the checklist being
incomplete (M1 and M10 accepted partials). Sequence and evidence:

| Step | Result |
| --- | --- |
| Merge PR #66 to `main` (rebase, 11 commits) | `main` at `3fb24d9` |
| Pages deploy of `3fb24d9` at `verify` | run `31267918607`, success |
| Gate A re-established on `3fb24d9` | 306/306, typecheck and build clean |
| `VITE_CLIENT_INCIDENT_ALERT_URL` reaches the bundle | confirmed present in the deployed app chunk — finding 4 fully closed |
| `VITE_OAUTH_GOOGLE_MODE` `verify` → `on` | set 16:57:27Z; `VITE_OAUTH_APPLE_MODE` untouched at `off` |
| Pages deploy applying the mode | run `31268241132`, success |
| Live Log In tab | email/password **and** "FASTER SIGN-IN → Continue with Google" |
| Live Create Account tab | same; Google present |
| Apple | absent from both tabs |
| Browser console | no errors |

The mode flip needed its own deploy: `VITE_` values are inlined at build time,
so changing the repository variable alone changes nothing until the next build.

**Rollback:** set `VITE_OAUTH_GOOGLE_MODE` to `off` and re-run the deploy
workflow. The build fails closed to `off` if the variable is missing entirely.

## M13 monitoring

Baseline at promotion, 2026-08-08 17:00:05Z:

| Metric | Value |
| --- | --- |
| `clientIncidents.total` (15 min window) | 0 |
| `clientIncidents.critical` (15 min window) | 0 |
| `oauth_auth_failure` rows, all time | 0 |

A rise in `critical` now means real OAuth failures, because delivery was proven
end to end before promotion. Two things to watch in the first 24 hours:

1. Any `oauth_auth_failure` row — read `provider`, `lifecycleStage` and
   `errorCode`; the payload carries nothing else.
2. **The first genuinely new Google user**, which is the M1 gap: confirm a new
   `auth.users` row, a usable Display Name and a working first load. Until one
   such user is observed, the OAuth-originated user-creation path remains
   unproven in production.

## Sign-off

- [x] Gate A confirmed green on the commit SHA above — *local only; CI still does not run tests*
- [ ] M1–M13 complete for this provider — *M1 and M10 accepted as documented
  partials, not passes; M13 runs during controlled verification*
- [x] All evidence fields recorded; no secrets present in any evidence
- [x] M12 incident-channel health check passed — live against production, 2026-08-08
- [x] M13 monitoring in place for controlled verification and the first 24h — *baseline recorded at promotion; the 24h watch is now running*

**Promotion decision:** `promote` — executed 2026-08-08 17:00Z
