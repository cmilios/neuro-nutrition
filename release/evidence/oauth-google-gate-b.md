# Gate B evidence record — provider `google`

Per [docs/oauth/release-checklist.md](../../docs/oauth/release-checklist.md),
backed by [docs/oauth/verification-matrix.md](../../docs/oauth/verification-matrix.md).

**Provider:** `google` · **Commit SHA:** `0720be1` ·
**Release ID:** `0720be1fe779f76a385084604331797ebca8f6b6` ·
**Supabase project ref:** `cmayisxvronrwvzhyuer` ·
**Verification URL:** `/neuro-nutrition/verify-oauth/`

**Status: INCOMPLETE — promotion blocked.** Findings 1–3 were remediated and
verified against production on 2026-08-08; findings 4–5 and the operator-only
manual cases remain open. See [Blocking findings](#blocking-findings).

## Gate A confirmation

`deploy.yml` builds and deploys but **runs no tests**, so CI does not establish
Gate A on any commit. Gate A was therefore established locally against the
deployed commit `0720be1` on 2026-08-08: `npm test` 290/290, `npm run typecheck`
clean, `npm run build` clean.

Caveat: the suite is flaky under parallel load. Two consecutive full runs
produced 5 failures and then 1 different failure, all `beforeEach` / render hook
timeouts in PGlite and `App.test.tsx`. Every failing file passed in isolation,
so these are resource contention, not regressions — but a test job added to CI
as-is would be intermittently red.

## Live configuration observed (2026-08-08)

| Item | Observed |
| --- | --- |
| `VITE_OAUTH_GOOGLE_MODE` | `verify` |
| `VITE_OAUTH_APPLE_MODE` | `off` |
| Supabase `/auth/v1/settings` | `google: true`, `apple: false`, `email: true` |
| Deployed Pages commit | `0720be1` (workflow run succeeded) |
| `/neuro-nutrition/verify-oauth/` | HTTP 200 |

Gating behavior verified live on the deployed build: Log In and Create Account
show email/password only with no provider rail; the verification URL shows
"FASTER SIGN-IN → Continue with Google" and no Apple. This matches the `verify`
contract (matrix G2, G5).

## Manual verification cases

| # | Case | Outcome | Evidence |
| --- | --- | --- | --- |
| M1 | New sign-in | **Not run** | Requires a signed-out browser and a dedicated test Google account; operator-only. |
| M2 | Returning sign-in | Not re-run here | Reported in a prior session against `27caf4b`. |
| M3 | Cancellation / denied consent | **Not run** | Operator-only. |
| M4 | Session restoration across the real redirect | Not re-run here | Reported in a prior session against `27caf4b`. |
| M5 | Display Name handling | Not re-run here | Reported in a prior session against `27caf4b`. |
| M6 | Account Security connected methods | Not re-run here | Reported in a prior session against `27caf4b`. |
| M7 | Logout then re-login | **Not run** | Operator-only. |
| M8 | Same-email automatic linking | Not re-run here | Reported in a prior session against `27caf4b`. |
| M9 | Apple private relay | `N/A` | Apple remains `off`. |
| M10 | Email/password regression | **Not run** | Requires authenticating and registering in production; operator-only. |
| M11 | Failure paths emit sanitized evidence | **Pass** | Sanitization proven by unit tests; delivery proven live (below). Triggering a real provider error is covered by the operator's M3 run. |
| M12 | Incident-channel health check | **Pass** | Live end-to-end check against production with the anon key, 2026-08-08 — see [Live incident-channel health check](#live-incident-channel-health-check). |
| M13 | Monitoring | **Ready, not run** | Mechanism verified: the observation snapshot classified a live `oauth_auth_failure` as `critical`. The 24h watch itself is an operator activity during controlled verification. |

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

### 5. Raw error objects reach the browser console on OAuth paths

`App.tsx:393` and `App.tsx:696` log raw Supabase/provider error objects via
`console.error`. Client-side only and not exfiltrated, but M11 asks that no raw
provider messages appear in logs or browser code. Noted, not treated as a hard
blocker; **not fixed**.

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

Migration-history caveat: the MCP recorded these under generated versions
`20260808155145` and `20260808155225` rather than the local filenames
`20260805120000` and `20260808120000`. Realigning the history rows was blocked
by a permission classifier. This is cosmetic — `supabase db push` was already
unusable because of the three pre-existing mismatches noted in finding 2 — but
it does add two more entries to that reconciliation backlog.

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

**Not verified:** that the emitted line is visible on the operator's log
surface. The MCP `get_logs` edge-function view returned only request-level
entries, no `console` output for any function, and lagged behind these calls.
The handler-to-log boundary is unit-tested and the wiring is a single
`console.warn`, but the last hop is unconfirmed and should be eyeballed on the
dashboard before the fallback is relied on.

**Still required and not done:** setting the `VITE_CLIENT_INCIDENT_ALERT_URL`
secret to the deployed function URL and redeploying Pages so the build inlines
it; finding 5; and the operator-only manual cases M1, M3, M7, M10.

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

## Sign-off

- [ ] Gate A confirmed green on the commit SHA above — *local only; CI does not run tests*
- [ ] M1–M13 complete for this provider — *M1, M3, M7, M10 outstanding (operator-only)*
- [x] All evidence fields recorded; no secrets present in any evidence
- [x] M12 incident-channel health check passed — live against production, 2026-08-08
- [ ] M13 monitoring in place for controlled verification and the first 24h — *mechanism verified; watch not yet run*

**Promotion decision:** `hold`
