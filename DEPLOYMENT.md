# NeuroNutrition — Deployment & Local Dev

The app is a static React/Vite frontend (hosted on GitHub Pages) plus a Supabase
backend: **Auth**, a **Postgres table** (`user_data`) for persistence, and an
**Edge Function** (`generate-meal-plan`) that proxies the Claude API so the API
key is never exposed to the browser.

```
Browser (GitHub Pages)  ──JWT──▶  Supabase Edge Function  ──ANTHROPIC_API_KEY──▶  Claude API
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

**Remaining manual step — set the Claude API key secret** (the MCP/dashboard, not
the repo). In the Supabase dashboard:
**Project → Edge Functions → Secrets** (or Project Settings → Edge Functions),
add:
- `ANTHROPIC_API_KEY` = your Anthropic key (`sk-ant-...`)
- *(optional)* `ANTHROPIC_MODEL` = `claude-sonnet-5`  (cheaper/faster than the
  default `claude-opus-4-8`)

Or via CLI:
```bash
supabase link --project-ref cmayisxvronrwvzhyuer
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
supabase functions deploy generate-meal-plan   # only needed to push code changes
```

Keep `verify_jwt = true` (see `supabase/config.toml`) so only signed-in users
can call the AI proxy.

### Auth setting to check
In **Supabase → Authentication → Providers → Email**, decide on "Confirm email":
- **ON**  → new users must click an email link before they can log in. The app
  now handles this (shows a "check your email" message instead of a broken login).
- **OFF** → users can log in immediately after signing up (simpler for testing).

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
are safe for the client (the anon key is protected by RLS). The Claude key is
**not** here; local dev calls the *deployed* edge function, so meal generation
works locally as long as the function is deployed and its secret is set.

### (Optional) run the edge function locally too
```bash
supabase functions serve generate-meal-plan --env-file supabase/.env.local
# supabase/.env.local should contain ANTHROPIC_API_KEY=... (this file is gitignored)
```
