# Authenticated password-change contract

Status: resolved  
Research date: 2026-07-28

## Decision

The Account > Security experience can implement the agreed flow:

- require the signed-in user's current password;
- accept and confirm a different new password;
- keep the initiating session signed in after success; and
- revoke the user's other sessions.

Use the authenticated Supabase Auth user-update endpoint, not an admin password reset:

```ts
await supabase.auth.updateUser({
  current_password: currentPassword,
  password: newPassword,
})
```

Supabase documents `current_password` for `supabase-js` 2.102.0 and later. This repository currently declares `@supabase/supabase-js` `^2.87.0` and locks 2.87.0, whose installed `UserAttributes` type does not contain `current_password`. Implementation therefore requires upgrading and locking `@supabase/supabase-js` to at least 2.102.0. ([Supabase password guide](https://supabase.com/docs/guides/auth/passwords#verifying-the-current-password))

The Supabase project must also have **Require current password when changing password** enabled. With it enabled, the Auth server requires `current_password` and verifies it against the user's stored password before accepting the replacement. A recovery session is deliberately exempt so that forgotten-password recovery remains possible. ([Supabase password-security guide](https://supabase.com/docs/guides/auth/password-security#require-current-password-when-changing-password), [Auth server update handler](https://github.com/supabase/auth/blob/master/internal/api/user.go#L136-L178))

## Session behavior

The approved "stay signed in here" behavior is supported. For an authenticated user update, the Auth server passes the initiating session ID into its password-update operation. That operation preserves the initiating session and revokes every other session for the user. If no initiating session exists, as in a privileged administrative update, it revokes all sessions instead. ([Authenticated update caller](https://github.com/supabase/auth/blob/master/internal/api/user.go#L185-L195), [password-update session logic](https://github.com/supabase/auth/blob/master/internal/models/user.go#L330-L357))

Revocation is not the same as instant invalidation of every already-issued JWT. Supabase destroys the affected sessions and refresh tokens, but an access token already held by another client can remain valid until its encoded expiry. The UI may state that other sessions are signed out, but security-sensitive authorization must not assume all of their bearer tokens stop working immediately. ([Supabase sign-out guide](https://supabase.com/docs/guides/auth/signout#sign-out-and-scopes))

## Security requirements and constraints

The server enforces project password policy on password changes:

- configurable minimum length;
- configurable required character classes;
- optional rejection of leaked passwords through Have I Been Pwned (Pro plan and above); and
- an Auth-server maximum of 72 characters.

Supabase recommends a minimum of at least eight characters. Strengthened policy applies when an existing user changes a password even if their old password was allowed under a weaker policy. Weak-password responses carry structured reasons such as `length`, `characters`, and `pwned`. The UI should explain the configured policy before submission and still treat the server as authoritative. ([Supabase password-security guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [Auth server password checks](https://github.com/supabase/auth/blob/master/internal/api/password.go))

Additional server constraints are:

- the new password cannot equal the existing password;
- when the user has MFA enabled, changing the password requires an AAL2 session; and
- an SSO-managed user cannot set a password through this route.

([Auth server update handler](https://github.com/supabase/auth/blob/master/internal/api/user.go#L98-L120), [same-password and current-password checks](https://github.com/supabase/auth/blob/master/internal/api/user.go#L136-L178))

Supabase separately offers **Require reauthentication when changing password**. If enabled, a session created more than 24 hours ago must call `reauthenticate()`, collect the emailed or texted nonce, and submit that nonce with the password update. This is distinct from requiring the current password. If both settings are enabled, the server performs both checks in sequence; integration testing should confirm the final UI flow against the actual hosted project configuration. ([Supabase reauthentication guide](https://supabase.com/docs/guides/auth/password-security#require-reauthentication-when-changing-password), [Auth server update handler](https://github.com/supabase/auth/blob/master/internal/api/user.go#L136-L178))

## Error contract

Branch on the structured Auth error `code`, not the human-readable message. The Security tab should map at least:

| Code | User-facing outcome |
| --- | --- |
| `current_password_required` | Ask for the current password. |
| `current_password_invalid` | Explain that the current password is incorrect. |
| `same_password` | Ask for a new password different from the current one. |
| `weak_password` | Show the server's policy reasons beside the new-password field. |
| `reauthentication_needed` | Start the nonce reauthentication step if that project setting is enabled. |
| `reauthentication_not_valid` | Explain that the verification code is invalid and allow a new code. |
| `insufficient_aal` | Require the user's configured MFA challenge. |
| `session_not_found` / `session_expired` | End the form flow and ask the user to sign in again. |
| `user_sso_managed` | Explain that the identity provider manages this account's password. |
| `validation_failed` | Show a safe validation failure and retain non-secret form state only where useful. |

Supabase wraps Auth API failures as `AuthApiError`; its documented table defines most of these codes. The current Auth source additionally defines `current_password_required` and `current_password_invalid`, which are not yet present in the published table. ([Supabase Auth error guide](https://supabase.com/docs/guides/auth/debugging/error-codes), [Auth server error-code constants](https://github.com/supabase/auth/blob/master/internal/api/apierrors/errorcode.go#L96-L127))

Never retain any password field after success, modal closure, tab navigation, or a session error. On success, clear all three password inputs and show an in-tab confirmation while leaving the current session active.

## Forgotten-password recovery

Keep recovery separate from authenticated password change:

1. call `resetPasswordForEmail(email, { redirectTo })`;
2. establish the recovery session at the callback/update-password route; and
3. call `updateUser({ password })` from that recovery session.

The server does not require the old password from a recovery session even when current-password enforcement is enabled. Production recovery depends on correctly configured redirect URLs and email delivery; Supabase recommends custom SMTP because its hosted default sender is best-effort and rate-limited. ([Supabase reset-password guide](https://supabase.com/docs/guides/auth/passwords#resetting-a-password), [recovery-session exemption](https://github.com/supabase/auth/blob/master/internal/api/user.go#L153-L168))

## Implementation checks

Before treating the feature as complete:

1. verify that the hosted project's current-password setting is available and enabled;
2. upgrade and lock `@supabase/supabase-js` to 2.102.0 or later;
3. integration-test correct, missing, and incorrect current passwords;
4. integration-test password policy, same-password, MFA, and expired-session errors;
5. confirm the initiating browser refreshes successfully after the update;
6. confirm another browser's refresh token is rejected after the update; and
7. if nonce reauthentication is enabled, test a session older than 24 hours and the combination of nonce plus current password.
