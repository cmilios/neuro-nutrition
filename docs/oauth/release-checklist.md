# OAuth Release Checklist (Gate B: `verify` → `on`)

**Audience:** authorized operators deciding whether to promote one OAuth
provider from `verify` to `on`.

**Purpose:** provide the evidence-bearing manual gate for provider promotion.

Operator gate checklist for promoting a single provider ("Continue with Google"
or "Continue with Apple") from `verify` to `on`. It materializes the **manual
tier** cases **M1–M13** from
[docs/oauth/verification-matrix.md](./verification-matrix.md) into a structured,
evidence-bearing gate, resolving the release-checklist deliverable of
[#60](https://github.com/cmilios/neuro-nutrition/issues/60) under the parent
[Implement Google and Apple sign-in](https://github.com/cmilios/neuro-nutrition/issues/57).
It implements the Gate B evidence contract from the staged rollout gate
[#45](https://github.com/cmilios/neuro-nutrition/issues/45).

> **Scope.** This checklist is the human gate that runs **once per provider**,
> against the real provider and the real Supabase project, with the provider in
> `verify` mode, before it is promoted to `on`. The automated tier (cases
> G1–P5) is a separate, prior gate (Gate A) and is not repeated here. See the
> matrix's [Gate mapping](./verification-matrix.md#gate-mapping).

## How to use this checklist

1. Copy the [per-provider run block](#per-provider-run-block) below into a new
   evidence record — a comment on the promotion issue, or a file under
   `release/evidence/` — once for **google** and once for **apple**.
2. Confirm **Gate A is already green** for the exact deploy commit you are
   verifying (the full automated suite passed in CI on that commit).
3. Put the provider in `verify` mode and drive every case M1–M13 through the
   documented verification URL using a dedicated, non-personal test account.
4. Record evidence for every row. A row may only be marked **Pass** with its
   evidence fields filled in.
5. Promote to `on` **only** when every applicable row is **Pass** and the
   [sign-off](#sign-off) is complete. Any **Fail** blocks promotion.

## Credential and evidence boundary — read first

Recorded evidence is **non-secret only**. At no point does this checklist, its
evidence records, linked issues, logs, or artifacts contain:

- OAuth tokens, ID tokens, authorization codes, or refresh tokens
- Client secrets, the Apple `.p8` private key, or the generated client-secret JWT
- Real end-user email addresses or the test account's provider password
- Raw provider error strings or response bodies

**Non-secret configuration identifiers** that are safe to record: the provider
name, the Google OAuth **client ID** (public), the Apple **Services ID** and
**Team ID**, the Supabase project ref, the deploy **commit SHA**, and the
release identifier. When in doubt, leave it out and describe it instead.

## Evidence fields (required for every case)

Every case row carries this evidence:

| Field | Meaning |
| --- | --- |
| **Provider** | `google` or `apple` |
| **Commit SHA** | the exact deploy commit under verification (Gate A green on this SHA) |
| **Release ID** | the release identifier promoted to `verify` |
| **Config identifiers** | non-secret identifiers relevant to the case (client ID, Services ID, Team ID, Supabase project ref, verification URL) |
| **Tester** | operator who ran the case |
| **Started / Completed** | ISO-8601 timestamps for the case run |
| **Outcome** | `Pass` / `Fail` / `N/A` |
| **Notes / incident refs** | observations and links to any incident records (no secrets) |

---

## Per-provider run block

> Copy everything from here to the end of the sign-off, once per provider.

**Provider:** `__________`  ·  **Commit SHA:** `__________`  ·
**Release ID:** `__________`  ·  **Supabase project ref:** `__________`  ·
**Verification URL:** `/neuro-nutrition/verify-oauth`

**Gate A confirmation:** automated suite green in CI on the commit above —
link: `__________`

### Manual verification cases

Each row maps 1:1 to a matrix case. Fill Tester / timestamps / Outcome /
Notes for every applicable row.

| # | Case | Expected result | Tester | Started | Completed | Outcome | Notes / incident refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | New sign-in | Account created; lands the exact return URL `https://cmilios.github.io/neuro-nutrition/` | | | | | |
| M2 | Returning sign-in | Authenticates the same account | | | | | |
| M3 | Cancellation / denied consent | Returns cleanly to the initiating view; nothing created or linked | | | | | |
| M4 | Session restoration across the real redirect | Restores without a logged-out flash or cross-user data leakage | | | | | |
| M5 | Display Name handling | Name present → gate bypassed; name absent → Display Name gate shown | | | | | |
| M6 | Account Security | Connected provider presented correctly in the connected-methods list | | | | | |
| M7 | Logout then re-login | Succeeds | | | | | |
| M8 | **google only** — same-email automatic linking | Linked identity keeps the existing Supabase user ID and all user-owned data | | | | | |
| M9 | **apple only** — private-relay address | Separate-account behavior observed; pre-sign-in relay disclosure verified in production | | | | | |
| M10 | Email/password regression | Login, register, change password, and recovery still work in production | | | | | |
| M11 | Failure paths | Emit sanitized operational evidence only — confirm no secrets, tokens, auth codes, emails, or raw provider messages appear in logs, issues, artifacts, or browser code | | | | | |
| M12 | Incident-channel health check | Passes **before** the provider enters `verify` | | | | | |
| M13 | Monitoring | Controlled verification and the first 24h after `on` are actively watched | | | | | |

> **Provider-specific rows:** run **M8** for `google` only and **M9** for
> `apple` only; mark the non-applicable one `N/A` in the other provider's block.

### Sign-off

Promotion to `on` is authorized only when every applicable row above is
**Pass**.

- [ ] Gate A confirmed green on the commit SHA above
- [ ] M1–M13 complete for this provider (provider-specific rows respected)
- [ ] All evidence fields recorded; no secrets present in any evidence
- [ ] M12 incident-channel health check passed **before** `verify`
- [ ] M13 monitoring in place for controlled verification and the first 24h

**Authorized by:** `__________`  **Role:** `__________`
**Date (ISO-8601):** `__________`
**Promotion decision:** `promote to on` / `hold` / `roll back`

---

## Rollback

A provider returned to `off` re-clears **Gate A** (automated suite green on the
redeploy commit) and then **Gate B** (a fresh copy of this checklist, complete
with evidence) before it may return to `on`, per the matrix
[Gate mapping](./verification-matrix.md#gate-mapping).
