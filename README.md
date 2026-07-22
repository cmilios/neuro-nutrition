<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1SJRjliEpFlLb4gzF7X53-CzE83yN-DPv

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Ensure `.env.local` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (the Claude API key lives server-side in Supabase, not here).
3. Run the app:
   `npm run dev`  → http://localhost:3000/neuro-nutrition/

AI meal generation runs through a Supabase Edge Function that holds the Claude
API key. See [DEPLOYMENT.md](DEPLOYMENT.md) for backend + hosting setup.
