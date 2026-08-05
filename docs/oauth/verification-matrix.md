# OAuth Verification Test Matrix

Verification matrix for Google and Apple sign-in, resolving map ticket
[#56](https://github.com/cmilios/neuro-nutrition/issues/56) under the map
[Add Google and Apple sign-in safely](https://github.com/cmilios/neuro-nutrition/issues/42).

It turns the lifecycle contract ([#44](https://github.com/cmilios/neuro-nutrition/issues/44)),
the staged rollout gate ([#45](https://github.com/cmilios/neuro-nutrition/issues/45)),
and the approved UI prototype ([#46](https://github.com/cmilios/neuro-nutrition/issues/46),
Variant B — email-first with an express provider rail) into individual
executable cases.

**Status: specification.** This document enumerates the cases and their gate
mapping. Materializing them into `vitest` files, a release checklist entry, and
CI wiring is the post-map build phase — not part of this document.

## Tiers

| Tier | Runner | Auth layer | When it runs |
| --- | --- | --- | --- |
| **Automated (local)** | `vitest` + `jsdom` + `@testing-library/react` | Supabase client / `onAuthStateChange` **mocked** | CI, every deploy commit |
| **Manual (production `verify`)** | Human operator, dedicated non-personal test accounts | **Real** provider + real Supabase project, provider in `verify` mode | Once per provider, before promotion to `on` |

**Automation boundary:** automate everything a mocked auth layer can exercise;
send anything requiring a live provider or the real Supabase project to the
manual tier.

## Gates

Each provider advances `off → verify → on` independently (per #45).

- **Gate A — before `off → verify`:** the entire automated suite is green in CI
  on the exact deploy commit, **and** the local manual lifecycle run for that
  provider passes.
- **Gate B — before `verify → on`:** the manual production-verification
  checklist for that provider is complete with recorded evidence.
- A **rolled-back** provider re-clears Gate A then Gate B before returning to `on`.

## Dimensions

Every case has the coordinate **surface × provider × outcome × tier**. Shared
automated cases are written **provider-parameterized** over `[google, apple]`
(marked _both_); genuinely provider-specific cases are called out. Expected
results are taken from the #44 contract.

---

## Automated tier (mocked auth)

### Deployment-mode gating

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| G1 | both | mode `off` | no entry point for the provider anywhere |
| G2 | both | mode `verify` | provider reachable only via the documented verification URL; hidden on normal Log In / Create Account |
| G3 | both | mode `on` | provider button shown on both Log In and Create Account |
| G4 | both | missing / empty / unrecognized mode | fails closed as `off` |
| G5 | both | any mode | email/password remains available |

### Auth entry — Variant B (#46)

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| E1 | both | Log In & Create Account with provider `on` | email/password is primary; provider sits in the "Faster sign-in" express rail below the primary CTA |
| E2 | both | only one provider `on` | that provider's button shows alone; no empty divider scaffolding |

### Redirect / session restore

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| R1 | both | sign-in initiated | neutral "Signing you in…" state; no logged-out flash; no other user's cached data exposed |
| R2 | both | restore succeeds, name present | lands in the normal authenticated app |
| R3 | both | restore succeeds, name missing | routed to the Display Name gate |
| R4 | both | no valid session restored | returns to initiating view with retryable error, provider retry, Back to Log In, email/password available |

### Identity / account creation

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| I1 | both | first successful provider sign-in | account created; later sign-ins authenticate it |
| I2 | both | provider response with **no verified email** | fails closed: no account created or admitted, transient session discarded, retry/other method offered, sanitized incident recorded |
| I3 | **apple** | before Apple sign-in | relay-email / duplicate-account risk disclosure is shown |

### Display Name gate

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| D1 | both | usable provider name supplied | normalized into canonical `user_metadata.name`; no gate |
| D2 | both | no usable name | gate shown; user stays authenticated |
| D3 | both | existing stored Display Name | canonical and wins; provider metadata never overwrites; returning user bypasses the gate |
| D4 | both | gate active | Health Profile / Weekly Plan / user data not loaded until the name is durably saved |
| D5 | both | gate active | cannot be dismissed or bypassed; only exits are saving a valid trimmed name or logging out |
| D6 | both | save fails | entered value retained; retry offered |

### Account Security

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| S1 | both | connected methods | listed from Supabase identities, not inferred from email/metadata |
| S2 | both | OAuth-only user | Set-password shows New + Confirm only; **no** current-password field |
| S3 | both | password set | email/password added as a method; session stays active; Security switches to the Change-password contract |
| S4 | both | disconnect the sole sign-in method with no password | fails closed (disconnect blocked) |
| S5 | both | provider flag off but session valid | identity still listed, marked "Sign-in temporarily unavailable"; not unlinked, session not invalidated |

### Logout

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| L1 | n/a | log out | ends only the current browser session (other devices remain signed in) |
| L2 | n/a | log out succeeds | all user-specific in-memory and local cached state cleared before Log In shows |
| L3 | n/a | log out | existing unsaved Health Profile guard preserved; no extra confirmation added |
| L4 | n/a | sign-out fails | Account stays open, user not shown as logged out, retryable error |

### Cancellation, failures & notifications

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| C1 | both | explicit cancellation / denied consent | nothing created or linked; return to initiating view; all methods available; retry allowed |
| C2 | both | cancellation toast | non-modal `role="status"`, does not steal focus, dismiss control, auto-dismiss ~5s; **not** recorded as an incident |
| C3 | both | callback / provider / session-restore failure toast | same toast pattern; sanitized message; return to initiating view with provider retry + email/password |
| C4 | both | toast placement | desktop bottom-right; mobile above the bottom safe area at available width |
| C5 | both | failure incident payload | contains only provider, lifecycle stage, stable error code (+ release id, timestamp); never tokens, auth codes, emails, or raw provider messages |

### Provider unavailability (only method)

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| U1 | both | unavailable provider was the user's only sign-in method | explain temporary unavailability, direct to support; **do not** offer password recovery when password access was never established |

### Email/password regression

| # | Case | Expected |
| --- | --- | --- |
| P1 | login | unchanged behavior |
| P2 | register, including the email-confirmation branch | unchanged behavior |
| P3 | change password (current + new) | unchanged behavior |
| P4 | password recovery route | unchanged behavior |
| P5 | provider additions present | do not regress any existing email/password flow |

---

## Manual tier (production `verify`, per provider)

Run for **google** and **apple** independently, with dedicated non-personal
test accounts, provider in `verify` mode.

| # | Provider | Case | Expected |
| --- | --- | --- | --- |
| M1 | each | new sign-in | account created; lands the exact return URL `https://cmilios.github.io/neuro-nutrition/` |
| M2 | each | returning sign-in | authenticates the same account |
| M3 | each | cancellation | returns cleanly, nothing created |
| M4 | each | session restoration across the real redirect | restores without logged-out flash or cross-user leakage |
| M5 | each | Display Name handling | name present → bypass; name absent → gate |
| M6 | each | Account Security | connected provider presented correctly |
| M7 | each | logout then re-login | succeeds |
| M8 | **google** | same-email automatic linking | linked identity keeps the existing Supabase user ID and all user-owned data |
| M9 | **apple** | private-relay address | separate-account behavior observed; pre-sign-in disclosure verified in production |
| M10 | each | email/password regression | still works in production |
| M11 | each | failure paths | emit sanitized operational evidence; confirm no secrets, tokens, auth codes, emails, or raw provider messages appear in logs, issues, artifacts, or browser code |
| M12 | each | incident-channel health check | passes **before** entering `verify` |
| M13 | each | monitoring | controlled verification and the first 24h after `on` are watched |

## Gate mapping

- **Gate A (`off → verify`):** automated cases **G–P all green in CI** on the
  deploy commit, plus the manual lifecycle cases run locally / pre-prod for that
  provider.
- **Gate B (`verify → on`):** manual cases **M1–M13 complete** for that
  provider, with evidence recorded (provider, commit SHA, non-secret
  configuration identifiers, tester, timestamps, outcomes, incident references —
  no secret values), per the #45 release checklist.
- **Rollback:** a provider returned to `off` re-clears Gate A then Gate B before
  returning to `on`.
