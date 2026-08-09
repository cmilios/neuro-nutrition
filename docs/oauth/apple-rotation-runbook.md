# Apple Client-Secret Rotation Runbook

**Audience:** authorized operators responsible for Apple sign-in credentials.

**Purpose:** rotate the Apple client-secret JWT safely before expiry and verify
the resulting provider state.

Owner-driven runbook for rotating the Apple **client-secret JWT** that backs
"Continue with Apple" before it expires. It resolves the rotation deliverable of
[#59](https://github.com/cmilios/neuro-nutrition/issues/59) under the parent
[Implement Google and Apple sign-in](https://github.com/cmilios/neuro-nutrition/issues/57),
and implements the rotation contract from the staged rollout gate
[#45](https://github.com/cmilios/neuro-nutrition/issues/45).

> **Scope.** This is an operational runbook, not code. It assumes Apple sign-in
> has already been configured and promoted to `on` at least once. Provider
> console and Supabase first-time setup steps live in the resolved decision
> tickets ([#43](https://github.com/cmilios/neuro-nutrition/issues/43),
> [#45](https://github.com/cmilios/neuro-nutrition/issues/45)); they are out of
> scope here.

## Why this exists

Apple client-secret JWTs are valid for **at most 180 days**. When the JWT
expires, Apple rejects the token exchange and every "Continue with Apple"
sign-in fails until a new secret is deployed. Rotation is a manual,
owner-driven task — there is no automated rotation (see the parent spec's
_Out of Scope_).

To keep a safety margin, this runbook targets a **150-day rotation cycle** with
a **30-day lead reminder**, so a new secret is generated, verified, and live
well before the 180-day hard limit.

## Credential boundary — read first

**The Apple `.p8` private key never enters this repository.** Neither does the
Team ID, Key ID, Services ID, or the generated client-secret JWT. These live
only in the approved encrypted credential vault and in Supabase as a stored
secret.

At every step in this runbook:

- Retrieve the `.p8` and identifiers from the credential vault; return them
  there when done. Do not leave copies on disk.
- Never paste secrets, tokens, the JWT, or the `.p8` into GitHub — not in files,
  issues, comments, commit messages, build artifacts, logs, or browser code.
- The rotation GitHub issue records **dates and outcomes only**, never secret
  values.

If the `.p8` is ever lost or suspected compromised, do not follow the normal
cycle — jump to [Recovery: expired or compromised key](#recovery-expired-or-compromised-key).

## When to rotate, and who owns the reminder

- **Trigger condition:** rotate on a **150-day cycle**, always completing before
  the recorded 180-day JWT expiry. The clock starts at the JWT's issuance date,
  recorded in the credential vault.
- **Reminder owner:** **Chris** is the accountable rotation owner and go/no-go
  authority. This is currently a single-owner dependency; record that in the
  vault metadata until a backup maintainer is designated.
- **Reminders:** Chris sets a recurring calendar reminder **30 days before the
  recorded expiry**, with follow-ups at **14 days** and **7 days**. The 30-day
  reminder is the one that kicks off this runbook.
- **Kickoff:** at the first (30-day) reminder, open a GitHub **rotation issue**
  that records the current **issuance and expiry dates** and the planned
  rotation date. No secrets go in the issue.

## Rotation procedure

Work through the steps in order. Apple stays `on` throughout generation and the
Supabase update; it only briefly moves to `verify` for the production check
before returning to `on`.

### 1. Open the rotation issue

At the 30-day reminder, create the GitHub rotation issue with:

- Current JWT issuance date and expiry date (from the vault).
- Target rotation date (well inside the 150-day cycle).
- A checklist mirroring the steps below.

### 2. Retrieve credentials from the vault

From the approved encrypted credential vault, retrieve:

- The Apple `.p8` signing key.
- **Team ID**, **Key ID**, and **Services ID** (the `sub` / client identifier).

Keep these in memory / a secure local session only. They never touch the repo.

### 3. Generate a new client-secret JWT

Generate a fresh client-secret JWT signed with the `.p8` (ES256), following
Apple's client-secret specification:

- **`iss`** — Team ID.
- **`sub`** — Services ID (the OAuth client identifier).
- **`aud`** — `https://appleid.apple.com`.
- **`iat`** — now.
- **`exp`** — now + at most 180 days. Set it to the **180-day maximum** so the
  JWT's own lifetime matches the recorded expiry the reminders are keyed to;
  the 150-day cycle provides the margin, not a short `exp`.
- **Header `kid`** — Key ID; **`alg`** — `ES256`.

Reference: [Apple — Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret)
and [Supabase — Apple login](https://supabase.com/docs/guides/auth/social-login/auth-apple).

Note the new **issuance date** and computed **expiry date** — these become the
new vault metadata and the reminder anchors after verification.

### 4. Update the secret in Supabase

In the Supabase dashboard, update the **Apple provider** configuration:

- Replace the stored **client secret (JWT)** with the newly generated value.
- Leave the Services ID / client ID unchanged.
- Save. The hosted provider now exchanges tokens with the new secret.

Do not record the JWT value anywhere outside Supabase and the vault.

### 5. Verify in `verify` mode before returning to `on`

Rotation must pass through the same production gate as any credential change.
Move Apple to **`verify`** and validate before promoting back to **`on`**, per
the `off → verify → on` staged rollout gate defined in
[#45](https://github.com/cmilios/neuro-nutrition/issues/45) (Gate B —
`verify → on`):

1. Set the Apple deployment mode to **`verify`** and redeploy. In `verify`,
   the Apple button is reachable only through the documented verification URL
   and stays hidden on the normal Log In / Create Account screens.
2. Using a **dedicated, non-personal Apple test account**, run the production
   verification via the verification URL:
   - New / returning sign-in completes and lands the exact return URL
     `https://cmilios.github.io/neuro-nutrition/`.
   - Session restores across the real redirect with no logged-out flash.
   - Cancellation returns cleanly with nothing created.
   - Email/password still works (regression).
   - Failure paths emit only sanitized evidence — no tokens, auth codes, email
     addresses, or raw provider messages in logs, issues, or artifacts.
   - These correspond to the manual-tier cases (M1–M13) in
     [`verification-matrix.md`](./verification-matrix.md).
3. Record the evidence in the rotation issue: provider, commit SHA, non-secret
   configuration identifiers, tester, timestamps, and outcomes — **no secret
   values**.
4. When the record passes, promote Apple back to **`on`** and redeploy.
   Chris is the accountable go/no-go authority for this promotion.

### 6. Close out

- Update the **vault metadata** with the new issuance date, new expiry date, and
  the next due date (issuance + 150 days).
- Reset the calendar reminders (30 / 14 / 7 days) against the new expiry.
- Record completion and the next due date in the rotation issue, then **close
  it** — only after production verification has passed.

## Recovery: expired or compromised key

Use this path if a reminder was missed and the JWT has **already expired**
(Apple sign-in is failing in production), or if the `.p8` is **lost or suspected
compromised**.

1. **Fail closed immediately.** Set the Apple deployment mode to **`off`** and
   redeploy so no user is offered a broken "Continue with Apple" button.
   Existing valid Supabase sessions are preserved; already-linked Apple
   identities remain listed (marked temporarily unavailable). Email/password and
   Google are unaffected.
2. **If the `.p8` is compromised (not merely expired):** first disable the
   hosted Apple provider in Supabase (the `off` deployment mode hides the button;
   disabling in Supabase stops the hosted token exchange), then revoke the
   signing key in the Apple Developer portal and create a **new key** (new `.p8`
   + Key ID). Store the new `.p8` and identifiers in the credential vault;
   destroy exposed copies. Treat any exposure as a credential-level incident.
   - If the JWT merely expired and the `.p8` is intact and trusted, skip key
     revocation and reuse the existing `.p8`.
3. **Generate a new client-secret JWT** with the current (or newly created)
   `.p8`, per [step 3](#3-generate-a-new-client-secret-jwt).
4. **Update Supabase** with the new JWT, per
   [step 4](#4-update-the-secret-in-supabase).
5. **Re-clear the full gate.** A provider returned to `off` repeats the complete
   `off → verify → on` gate before returning to `on`: clear Gate A (the
   automated suite green in CI **and** the local manual lifecycle run for Apple),
   then Gate B (the manual production verification in `verify`) per
   [step 5](#5-verify-in-verify-mode-before-returning-to-on), then promote to
   `on`. Gate definitions are in [`verification-matrix.md`](./verification-matrix.md).
6. **Record** the incident in the rotation issue (or a fresh incident issue):
   reason, operator, timestamps, actions taken, and verification outcome —
   without secrets or personal data. Update vault metadata and reminders as in
   [step 6](#6-close-out).

## Related documents

- [`verification-matrix.md`](./verification-matrix.md) — the authoritative
  case-by-case checklist (automated G1–P5, manual M1–M13) behind each gate.
- [#45](https://github.com/cmilios/neuro-nutrition/issues/45) — staged rollout,
  production gate, secret boundary, and the source rotation contract.
- [#57](https://github.com/cmilios/neuro-nutrition/issues/57) — parent Google
  and Apple sign-in implementation spec.
