# NeuroNutrition

NeuroNutrition is an early-stage beta that uses AI-Assisted Meal Planning to
create a personalized seven-day Weekly Plan from a user's Health Profile. A
completed week's Meal Review can then shape the user's Next Weekly Plan.

[Open the live beta](https://cmilios.github.io/neuro-nutrition/)

## Safety boundary

NeuroNutrition provides general meal-planning guidance. It is not medical
advice, diagnosis, or treatment. People with medical dietary needs should
consult a qualified clinician or dietitian. Allergy and dietary-restriction
inputs do not guarantee ingredient safety, so users must verify ingredients
independently.

Because this is an early-stage beta, behavior and availability may change.

## Five-minute quick start

You need Node.js 20 and npm 10. The repository's committed lockfile is the
installation source of truth.

1. Clone this repository and enter its directory.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` for the
   Supabase project you intend to use. These values are browser-visible
   configuration; never put server secrets in a `VITE_*` variable.
5. Run `npm run dev`, then open
   `http://localhost:3000/neuro-nutrition/`.

Before proposing a change, run the project checks:

```text
npm test
npm run typecheck
npm run docs:check
npm run build
```

## Documentation

- [Domain language and product concepts](CONTEXT.md)
- [Deployment and local backend operations](DEPLOYMENT.md)
- [OAuth verification matrix](docs/oauth/verification-matrix.md)
- [OAuth release checklist](docs/oauth/release-checklist.md)
- [Apple credential-rotation runbook](docs/oauth/apple-rotation-runbook.md)
- [Architectural decisions](docs/adr/)

Detailed setup, release, and OAuth procedures belong to the linked documents;
this landing page stays focused on product orientation and the shortest local
path.
