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

(The old `GEMINI_API_KEY` secret is no longer used and can be deleted.)

Live URL: https://cmilios.github.io/neuro-nutrition/

## 3. Run locally

```bash
npm install
npm run dev        # http://localhost:3000/neuro-nutrition/
```

`.env.local` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only — these
are safe for the client (the anon key is protected by RLS). The OpenAI key is
**not** here; local dev calls the *deployed* edge function, so meal generation
works locally as long as the function is deployed and its secret is set.

### (Optional) run the edge function locally too
```bash
supabase functions serve generate-meal-plan --env-file supabase/.env.local
# supabase/.env.local should contain OPENAI_API_KEY=... (this file is gitignored)
```
