# NeuroNutrition — Deployment & Local Dev

The app is a static React/Vite frontend (hosted on GitHub Pages) plus a Supabase
backend: **Auth**, a **Postgres table** (`user_data`) for persistence, and an
**Edge Function** (`generate-meal-plan`) that proxies the OpenAI API so the API
key is never exposed to the browser.

```
Browser (GitHub Pages)  ──JWT──▶  Supabase Edge Function  ──OPENAI_API_KEY──▶  OpenAI API
        │                                    (key server-side only)
        └──anon key + JWT──▶  Supabase Auth + user_data table (RLS)
```

## 1. Backend (Supabase) — active project `cmayisxvronrwvzhyuer`

> The original `neuro-nutrition` project was paused > 90 days and became
> permanently unrestorable, so a new project (`neuronutrition-app`, ref
> `cmayisxvronrwvzhyuer`, region eu-west-1) was created to replace it.

Already done:
- ✅ `user_data` table + RLS policies applied
- ✅ `generate-meal-plan` edge function deployed (verify_jwt = true)

**Remaining manual step — set the OpenAI API key secret** (the dashboard, not
the repo). In the Supabase dashboard:
**Project → Edge Functions → Secrets** (or Project Settings → Edge Functions),
add:
- `OPENAI_API_KEY` = your OpenAI Platform API key (`sk-...`)
- *(optional)* `OPENAI_MODEL` overrides the default `gpt-5.6-sol`

Or via CLI:
```bash
supabase link --project-ref cmayisxvronrwvzhyuer
supabase secrets set OPENAI_API_KEY=sk-xxxxxxxx
supabase functions deploy generate-meal-plan   # only needed to push code changes
```

Keep `verify_jwt = true` (see `supabase/config.toml`) so only signed-in users
can call the AI proxy.

### Auth setting to check
In **Supabase → Authentication → Providers → Email**, decide on "Confirm email":
- **ON**  → new users must click an email link before they can log in. The app
  now handles this (shows a "check your email" message instead of a broken login).
- **OFF** → users can log in immediately after signing up (simpler for testing).

### AI usage ledger

Before deploying the issue #3 Edge Function, apply the committed database
migrations with the Supabase CLI. The function writes one immutable
`ai_usage_records` row per OpenAI call through its server-side service role.
The `anon` and `authenticated` roles have no table or reporting-view access.

The migration creates a no-login `ai_usage_reader` role with read-only access.
Operators can inspect per-user totals from the SQL editor while explicitly
assuming that role:

```sql
begin;
set local role ai_usage_reader;

select *
from public.ai_usage_by_user
order by estimated_cost_usd desc nulls last;

commit;
```

The estimate is an operational snapshot, not an invoice. Raw provider usage and
the pricing version/snapshot remain stored so historical calculations are
auditable if rates change.

## 2. Frontend hosting (GitHub Pages) — already configured

`.github/workflows/deploy.yml` builds and deploys on every push to `main`.
Repo **Settings → Secrets and variables → Actions** must contain:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

OAuth visibility is controlled by these **repository variables** (not secrets):

- `VITE_OAUTH_GOOGLE_MODE`: `off`, `verify`, or `on`
- `VITE_OAUTH_APPLE_MODE`: `off`, `verify`, or `on`

The deployment workflow defaults missing or invalid modes to `off`. Use
`verify` while testing a configured provider at
`https://cmilios.github.io/neuro-nutrition/verify-oauth`; use `on` only after
the provider-specific release checklist passes.

(The old `GEMINI_API_KEY` secret is no longer used and can be deleted.)

Live URL: https://cmilios.github.io/neuro-nutrition/

## 3. Run locally

```bash
npm install
npm run dev        # http://localhost:3000/neuro-nutrition/
```

`.env.local` holds the public Supabase URL/key and non-secret OAuth rollout
modes — these are safe for the client (the anon key is protected by RLS). The
OpenAI key is **not** here; local dev calls the *deployed* edge function, so meal
generation works locally as long as the function is deployed and its secret is
set.

Copy `.env.example` to `.env.local` and set either OAuth mode to `verify` or
`on` when testing its button locally. `.env.local` is ignored by Git.

### (Optional) run the edge function locally too
```bash
supabase functions serve generate-meal-plan --env-file supabase/.env.local
# supabase/.env.local should contain OPENAI_API_KEY=... (this file is gitignored)
```
## Account and Auth configuration

### Activate Google and Apple sign-in

The hosted Supabase callback URL registered with both identity providers is:

```text
https://cmayisxvronrwvzhyuer.supabase.co/auth/v1/callback
```

The application return URL allowed in Supabase Auth is:

```text
https://cmilios.github.io/neuro-nutrition/
```

In **Supabase Dashboard → Authentication → URL Configuration**:

1. Set **Site URL** to `https://cmilios.github.io/neuro-nutrition/`.
2. Add `https://cmilios.github.io/neuro-nutrition/` to **Redirect URLs**.
3. For local hosted-project testing, also add
   `http://localhost:3000/neuro-nutrition/`.

#### Google

In Google Auth Platform / Google Cloud Console:

1. Configure the app branding and audience. Use **External** unless sign-in is
   intentionally restricted to one Google Workspace organization.
2. Create an OAuth 2.0 **Web application** client.
3. Add the Supabase callback URL above as an **Authorized redirect URI**.
4. While the Google app is in testing, add the dedicated test accounts as test
   users. Do not request scopes beyond basic identity (`openid`, `email`, and
   `profile`).
5. Copy the generated **Client ID** and **Client secret** directly into
   **Supabase Dashboard → Authentication → Sign In / Providers → Google**,
   enable Google, and save. Do not commit or paste the client secret into the
   repository or an issue.

#### Apple

An active Apple Developer Program membership is required. In Apple Developer:

1. Create or select an **App ID** and enable **Sign in with Apple**.
2. Create a **Services ID** for the web client and associate it with that App ID.
3. Configure the Services ID website domain as
   `cmayisxvronrwvzhyuer.supabase.co` and its return URL as the Supabase callback
   URL above.
4. Create a **Sign in with Apple key**, download its `.p8` file once, and record
   its **Key ID** and the account **Team ID** securely.
5. Generate an Apple client-secret JWT and enter the **Services ID** as the
   first Client ID plus the generated secret in
   **Supabase Dashboard → Authentication → Sign In / Providers → Apple**.
   Enable Apple and save. Never commit the `.p8` key or client-secret JWT.
6. Follow `docs/oauth/apple-rotation-runbook.md`; the Apple client-secret must
   be rotated before expiry.

#### Staged activation

For each configured provider independently:

1. Keep its GitHub variable at `off` while credentials are being created.
2. Set it to `verify`, deploy, and complete
   `docs/oauth/release-checklist.md` at the verification URL.
3. If every applicable check passes, set it to `on` and redeploy. Roll back to
   `off` immediately if the live flow fails.

GitHub CLI examples:

```bash
gh variable set VITE_OAUTH_GOOGLE_MODE --body verify
gh variable set VITE_OAUTH_APPLE_MODE --body verify

# After each provider passes verification:
gh variable set VITE_OAUTH_GOOGLE_MODE --body on
gh variable set VITE_OAUTH_APPLE_MODE --body on
```

Before releasing the Account experience:

- Apply `20260729135108_create_health_profile_plan_replacement_commands.sql`
  before deploying the updated `generate-meal-plan` Edge Function and web app.
- In Supabase Auth, require the current password for authenticated password
  changes and enforce a minimum of eight characters with at least one letter
  and one number.
- Enable leaked-password rejection when the project plan supports it. Do not
  enable age-based emailed reauthentication for this release.
- Add the production `/recover-password` URL to the Auth redirect allow-list
  and verify that production SMTP can deliver recovery emails.
- Exercise password change, password recovery, terminal replacement failure,
  stale recovery, and authoritative replacement sync in the deployed
  environment. Local configuration and automated tests do not prove hosted
  Auth settings are active.

### Production Auth verification — 2026-07-30

Verified in the hosted Supabase dashboard for project `cmayisxvronrwvzhyuer`:

- Current-password enforcement is enabled for authenticated password changes.
- The minimum password length is eight characters.
- Passwords require at least one letter and one digit.
- Age-based emailed reauthentication ("Secure password change") remains
  disabled for this release.
- Leaked-password rejection remains disabled because the project is on the
  Free plan; Supabase exposes this control only on Pro and above.
