# Google and Apple authentication baseline

Research date: 2026-07-30

Scope: browser-based React/Vite application at `https://cmilios.github.io/neuro-nutrition/`, Supabase project `cmayisxvronrwvzhyuer`

## Decision

Use Supabase's browser OAuth redirect flow for both Google and Apple. Keep the
provider callback and the final application redirect as two separate
configuration layers:

1. Google and Apple return to Supabase at
   `https://cmayisxvronrwvzhyuer.supabase.co/auth/v1/callback`.
2. Supabase returns the completed session to the application URL passed as
   `options.redirectTo`, which must be present in the Supabase Auth redirect
   allow-list.

This repository's browser client uses the default implicit flow, not a
server-side PKCE callback. Therefore, the exact application return URLs should
be:

- Production: `https://cmilios.github.io/neuro-nutrition/`
- Localhost: `http://localhost:3000/neuro-nutrition/`
- Optional local IP equivalent, if developers use it:
  `http://127.0.0.1:3000/neuro-nutrition/`

No new `/auth/callback` page is required for that flow. If the application later
adopts PKCE, it will need a real callback route that exchanges the authorization
code and that route will replace these landing URLs in `redirectTo`.

Supabase documents that `redirectTo` must match its Auth redirect allow-list,
that the Site URL is used when `redirectTo` is omitted, and that production
entries should be exact rather than wildcarded. It separately documents the
provider callback as `https://<project-ref>.supabase.co/auth/v1/callback`.
([redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple))

## Repository and hosted baseline

### Repository

- The app is a static GitHub Pages deployment with Vite base path
  `/neuro-nutrition/` and local port `3000`
  ([`vite.config.ts`](../../vite.config.ts),
  [`services/applicationRoutes.ts`](../../services/applicationRoutes.ts)).
- `@supabase/supabase-js` is pinned to `2.105.3`; the browser client uses only
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  ([`package.json`](../../package.json),
  [`services/supabaseClient.ts`](../../services/supabaseClient.ts)).
- Authentication currently implements email/password sign-in and registration.
  Registration writes `user_metadata.name`, and session mapping reads only that
  key. There is no OAuth method, provider metadata normalization, identity
  listing, or missing-name gate
  ([`services/authService.ts`](../../services/authService.ts)).
- Local Supabase config has no external provider sections. It uses the local app
  as `site_url` and allow-lists only password-recovery routes
  ([`supabase/config.toml`](../../supabase/config.toml)).
- The Pages workflow uses Node 20 and has no Google/Apple visibility flags
  ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)).

### Hosted Supabase, observed read-only on 2026-07-30

A read-only `GET /v1/projects/{ref}/config/auth` Management API request and a
read-only query of `auth.identities` established:

- Site URL: `https://cmilios.github.io/neuro-nutrition/`
- Additional redirect allow-list: empty
- Email provider: enabled
- Google provider: disabled; no client ID or secret present
- Apple provider: disabled; no client ID or secret present
- Manual identity linking: disabled
- Existing identities: five `email` identities and no Google or Apple identities

The hosted state is authoritative; the checked-in local `config.toml` does not
prove hosted Auth configuration. The fields above are available through
Supabase's official Auth configuration
[Management API](https://supabase.com/docs/reference/api/v1-update-auth-service-configuration).
No credential values or user identifiers were read into this note.

Consequently, production OAuth is not currently usable. Before either provider
is exposed, its credentials and enablement must exist in hosted Supabase and the
production and intended local application return URLs must be allow-listed.

## Google contract

### Google Auth Platform configuration

The project owner must provide or create:

1. A Google Cloud project.
2. Google Auth Platform Branding and Audience configuration.
3. Data Access containing only the basic identity scopes required by Supabase:
   `openid`, `.../auth/userinfo.email`, and
   `.../auth/userinfo.profile`.
4. An OAuth client of type **Web application**.
5. Authorized JavaScript origins:
   - `https://cmilios.github.io`
   - `http://localhost:3000` while local testing is needed
   - optionally `http://127.0.0.1:3000` if that local origin is supported
6. Authorized redirect URI:
   `https://cmayisxvronrwvzhyuer.supabase.co/auth/v1/callback`.
7. The resulting client ID and client secret entered in the hosted Supabase
   Google provider configuration.

Google origins contain only scheme, host, and port; the GitHub Pages repository
path is not part of an origin. Supabase's current Google guide specifies the web
client, origins, callback, scopes, audience, branding, and provider credentials.
([Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Google client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid))

For a public app, configure the Google audience appropriately and publish it
**In production**. Google's Testing status normally limits the consent screen
to 100 listed test users and can expire authorizations after seven days, though
Google documents an exception when the app requests only basic Sign in with
Google identity scopes. Do not add broader API scopes to this authentication
client; sensitive or restricted scopes add verification and consent burden.
([Google audience modes](https://support.google.com/cloud/answer/15549945?hl=en))

### Google metadata

The requested scopes make verified email and profile claims available, but the
Display Name gate must still be provider-neutral. Google's canonical OIDC
reference says `name`, `picture`, `given_name`, and `family_name` might be
present rather than guaranteeing them. It also says email can change and must
not be treated as Google's stable identifier; Google's stable provider
identifier is `sub`.
([Google OIDC claims](https://developers.google.com/identity/openid-connect/reference))

Supabase owns the mapping from the provider identity into its user and identity
objects. Application code should normalize a usable Display Name from known
metadata keys and require the user to supply one when none is usable, rather
than assuming the existing `user_metadata.name` key will always be populated.

## Apple contract

### Apple Developer configuration

The project owner must have an Apple Developer account and provide or create:

1. The 10-character Apple Team ID.
2. A primary Apple-platform App ID with the Sign in with Apple capability.
3. A Services ID for this website, associated with that primary App ID.
4. Website configuration for the Services ID:
   - Domain: `cmayisxvronrwvzhyuer.supabase.co`
   - Return URL:
     `https://cmayisxvronrwvzhyuer.supabase.co/auth/v1/callback`
5. A Sign in with Apple private signing key (`.p8`) and its Key ID.
6. A generated client-secret JWT whose subject is the Services ID.
7. The Services ID and generated client secret entered in the hosted Supabase
   Apple provider configuration.
8. Email relay sources/domains configured if NeuroNutrition sends mail to users
   who choose Hide My Email.

Apple requires a Services ID to be associated with an existing primary App ID
enabled for Sign in with Apple. Supabase specifies that the web domain is the
Supabase project domain and the return URL is the Supabase Auth callback; it
also currently says its Auth integration does not support Apple's
server-to-server notification endpoint, so that endpoint should be left blank.
([Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web),
[Supabase Apple configuration](https://supabase.com/docs/guides/auth/social-login/auth-apple))

Apple does not accept localhost as the Services ID return target for this
architecture. Local browser testing should therefore still use the hosted HTTPS
Supabase callback; Supabase can then redirect to the allow-listed localhost app
URL. A fully local Supabase Apple flow would require a separately registered,
publicly reachable HTTPS callback domain and is not required for this rollout.

### Apple name and email behavior

Apple's identity token does not contain the user's full name. In the hosted
Supabase OAuth flow, Supabase cannot recover it; Apple makes it available only
in the first native or Sign in with Apple JS authorization response. The chosen
OAuth flow must therefore send an Apple user with no existing Display Name to
the separate Display Name onboarding prompt.
([Supabase Apple name behavior](https://supabase.com/docs/guides/auth/social-login/auth-apple))

Apple users can choose Hide My Email. The resulting private relay address is a
valid address for the Apple identity but is different from the user's existing
password or Google email. That distinction matters for identity linking and
must be covered by release verification and support documentation.

### Apple client-secret lifetime and rotation

The `.p8` file is the long-lived private signing key; the value placed in
Supabase as the Apple secret is a signed JWT that expires. Apple caps the JWT
expiration at `15,777,000` seconds (six months). It uses:

- header `alg=ES256` and the Apple Key ID as `kid`;
- Team ID as `iss`;
- generation time as `iat`;
- an `exp` no more than six months later;
- `https://appleid.apple.com` as `aud`; and
- the case-sensitive Services ID as `sub`.

([Apple client-secret specification](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret))

Required operational runbook:

1. Store the `.p8`, Team ID, Key ID, and Services ID in an approved secret
   manager outside the repository. Restrict access and record ownership.
2. Record the generated JWT's exact `iat` and `exp`.
3. Schedule a recurring reminder at least 30 days before `exp`, with escalation
   if it is not acknowledged. Six months is the maximum, so the reminder should
   be based on the actual token expiry rather than a fixed calendar assumption.
4. Before expiry, generate a replacement JWT from the protected `.p8`; validate
   its claims locally without logging the token.
5. Replace the Apple secret in Supabase, then complete a production Apple
   sign-in and a returning-user sign-in while the Apple button remains gated
   from general release.
6. Record the new expiry and evidence. If verification fails and the previous
   JWT is still valid, restore it while investigating.
7. If the `.p8` is lost or suspected compromised, create and transition to a
   new private key, then revoke the old key. Apple permits two Sign in with Apple
   private keys per primary App ID, allowing controlled overlap.

([Apple private-key rotation](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/),
[Supabase six-month warning](https://supabase.com/docs/guides/auth/social-login/auth-apple))

Google's client secret has no equivalent six-month JWT expiry in this flow, but
it is still a server credential and should be rotated on compromise or under
the owner's normal credential policy.

## Identity linking and Account Security

Supabase automatically links a new OAuth identity to an existing Supabase user
when the email address matches. Supabase requires unique emails and avoids
linking unverified competing identities to reduce pre-account-takeover risk.
Manual different-email linking is beta and is currently disabled in the hosted
project.
([Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking))

This supports the desired same-email preservation case, but it is not a
universal guarantee:

- a Google or Apple identity whose verified email exactly matches the existing
  email/password identity should attach to the same Supabase user ID, preserving
  data keyed to that user;
- an Apple private-relay email will not equal the existing real email and can
  produce a separate Supabase user;
- identities with different emails are intentionally out of scope for manual
  linking.

Account Security should obtain the authenticated user's identities with
`getUserIdentities()` and render their `provider` values rather than inferring a
provider from email or metadata. Supabase documents that an OAuth-created
account can add password authentication while signed in using
`updateUser({ password })`. Therefore, an OAuth-only user should see connected
providers and a **Set password** path; password recovery remains for a user who
already has, but forgot, password access.
([identity objects](https://supabase.com/docs/guides/auth/identities),
[identity-linking FAQ](https://supabase.com/docs/guides/auth/auth-identity-linking#frequently-asked-questions))

## Feature flags and release order

Use two independent build-time flags:

- `VITE_ENABLE_GOOGLE_AUTH`
- `VITE_ENABLE_APPLE_AUTH`

Treat only the literal string `true` as enabled; absence and every other value
must be false. These are deployment controls, not secrets, and can be GitHub
Actions variables. Google/Apple client secrets and the Apple `.p8` must never be
`VITE_*` variables, GitHub Pages assets, or repository files.

Release each provider independently:

1. Complete its provider-console configuration.
2. Configure and enable it in hosted Supabase.
3. Add the exact production and intended localhost app return URLs to Supabase.
4. Keep its frontend flag false while performing a controlled production
   round-trip.
5. Verify new-account creation, same-email linking, missing-name onboarding,
   returning sign-in, cancellation/failure handling, and Account Security.
6. For Apple, also verify the private-relay-email behavior and record the
   client-secret expiry/reminder.
7. Set only that provider's frontend flag true and deploy.

A frontend flag is not a security boundary. Disabling a button does not disable
the provider endpoint; emergency shutdown should turn off the hosted Supabase
provider as well as the flag.

## Relevant current changes

The Supabase Auth and breaking-change changelogs were reviewed on 2026-07-30.
No Google- or Apple-social-login breaking change alters the hosted callback
design above.

Two nearby notices should not be mistaken for changes to this flow:

- The `/v1/oauth/token` success status change from `201` to `200` concerns
  Supabase acting as an OAuth 2.1 provider, not Supabase consuming Google or
  Apple social login; this app does not call that endpoint directly.
  ([notice](https://supabase.com/changelog/45468-breaking-change-oauth-token-endpoint-will-return-http-200-instead-of-201))
- The `API_EXTERNAL_URL` `/auth/v1` change affects self-hosted Supabase. This
  repository uses the hosted platform, and the final hosted provider callback
  remains `/auth/v1/callback`.
  ([Auth changelog](https://supabase.com/changelog?tags=auth))

One repository-relevant deprecation is actionable even though it is not
OAuth-specific: Supabase ended support for Node.js 20 in future releases of its
JavaScript packages on 2026-06-30, while the Pages workflow still selects Node
20. The currently pinned `2.105.3` package is reproducible, but dependency
upgrades should first move CI to Node 22 or later.
([Node 20 deprecation](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20))

## Owner-supplied facts still required

The following cannot be discovered safely from the repository or read-only
hosted state:

- which Google Cloud project and owner should hold the production OAuth client;
- Google branding, audience, publishing, and verification status;
- the Google client ID and client secret;
- Apple Developer membership and authorized operator;
- Apple Team ID, primary App ID, Services ID, Key ID, and protected `.p8`;
- the secret manager and named rotation owner;
- the generated Apple client-secret issuance/expiry dates; and
- the calendar/automation system that will own the recurring pre-expiry reminder.

These are rollout prerequisites, not reasons to expose credentials in the
repository.
