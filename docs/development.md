# Developer guide

This guide is for maintainers and approved contributors who need to run,
understand, and verify NeuroNutrition. The [project landing page](../README.md)
owns the short product introduction; this document owns local development and
testing guidance.

## Prerequisites

- Node.js 20 and npm 10. The exact npm release used for this repository is in
  `package.json`, and `.nvmrc` declares the Node.js major version.
- Git for cloning the repository and preparing a change.
- Browser-safe Supabase configuration supplied by a maintainer, or a local
  Supabase stack if the change requires backend development.

Confirm the active toolchain before installation:

```text
node --version
npm --version
```

On Windows, PowerShell execution policy can prevent the `npm.ps1` shim from
running. Use `npm.cmd` in place of `npm` if that occurs. The remaining commands
and repository paths are the same on Windows, macOS, and Linux.

## Reproducible installation

Clone the repository, enter its root directory, and install exactly the
dependencies recorded in `package-lock.json`:

```text
npm ci
```

Use `npm ci`, rather than `npm install`, for a clean setup and for verification.
If the lockfile and project metadata disagree, installation should fail rather
than silently rewrite the dependency graph.

## Configure the frontend

Copy `.env.example` to `.env.local`:

```text
# macOS or Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

The example is the authoritative list of browser-visible configuration:

- `VITE_SUPABASE_URL` identifies the Supabase project.
- `VITE_SUPABASE_ANON_KEY` is the project's publishable or legacy anonymous
  browser key.
- `VITE_OAUTH_GOOGLE_MODE` and `VITE_OAUTH_APPLE_MODE` independently control
  whether each provider is `off`, available only on the verification route, or
  `on` for ordinary sign-in.
- `VITE_CLIENT_INCIDENT_ALERT_URL` is an optional public Edge Function URL for
  privacy-limited incident delivery.
- `VITE_RELEASE_ID` is an optional build identifier; local development may use
  `development`.

Every `VITE_*` value is compiled into browser code and must be treated as
public. Never place a Supabase secret or service-role key, OpenAI API key,
OAuth client secret, webhook credential, token, email address, or personal
Health Profile data in one of these variables. Placeholder values in
`.env.example` are intentional unless the identifier is already public.

For the hosted development project, obtain the current browser configuration
from a maintainer. Local frontend work can use that hosted backend; a local
database is optional unless the change affects migrations, RLS, RPCs, Auth, or
Edge Functions.

## Run the application

Start Vite and open `http://localhost:3000/neuro-nutrition/`:

```text
npm run dev
```

The application is served beneath `/neuro-nutrition/`, including locally.
Direct-route behavior must preserve that base path.

Useful commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm test` | Run the complete Vitest suite once. |
| `npm test -- components/AuthScreen.test.tsx` | Run one test file while iterating. |
| `npm run typecheck` | Check TypeScript without emitting files. |
| `npm run docs:check` | Validate Markdown links, assets, commands, navigation, and public configuration names. |
| `npm run build` | Create the production bundle in `dist/`. |
| `npm run preview` | Serve the existing production bundle for local inspection. |

## Optional local Supabase stack

Backend work additionally requires the Supabase CLI and a running
Docker-compatible container runtime. Follow the current
[Supabase CLI installation guide](https://supabase.com/docs/guides/local-development/cli/getting-started),
then discover the installed command surface rather than assuming a CLI version:

```text
supabase --version
supabase --help
```

This repository already contains `supabase/config.toml` and ordered migrations.
From the repository root, `supabase start` launches the development-only local
stack and applies the repository configuration. Use the URL and publishable key
printed by the CLI in `.env.local`; do not copy its secret key into browser
configuration. The local stack is not hardened for public traffic and must not
be exposed externally.

Before a database or Edge Function change, read
[deployment and local backend operations](../DEPLOYMENT.md). That document owns
linked-project operations, migrations, server-side secrets, deployment, and
release verification. Do not run a linked or destructive database command
unless the issue explicitly requires it and the target has been verified.

## Repository orientation

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Top-level authentication, data loading, and Weekly Plan workflows. |
| `components/` | User-facing React components and component-level behavior tests. |
| `services/` | Browser-side service boundaries for Auth, authoritative Weekly Plan data, cache fallback, routing, themes, and telemetry. |
| `supabase/functions/` | Server-side Edge Functions and their HTTP or persistence seams. |
| `supabase/migrations/` | Ordered database schema, RLS, RPC, and durable command changes. |
| `build/` | Build-time behavior such as GitHub Pages route entry points. |
| `release/` | Release verification, observation, and evidence tooling. |
| `docs/` | Repository documentation, ADRs, agent instructions, and documentation validation. |
| `.github/workflows/` | Documentation checks, application deployment, and production observation automation. |

Use the canonical concepts in the [domain glossary](../CONTEXT.md). Review the
[architectural decisions](adr/) before changing a boundary they cover.

## Testing strategy

Tests describe behavior at public seams and live beside the code or contract
they exercise:

- React Testing Library tests cover user-visible component and application
  workflows.
- Service tests cover exported browser-side boundaries without reaching into
  private implementation details.
- Edge Function tests cover HTTP, generation, persistence, and retry behavior
  through injected external boundaries.
- Migration contract tests exercise SQL behavior with an isolated Postgres
  runtime.
- Documentation tests exercise `npm run docs:check` as one observable command.

Work in small vertical slices when practical: add one failing behavioral test,
make it pass, then continue. Run the focused test and `npm run typecheck`
regularly. Before proposing any change, run the complete verification set:

```text
npm test
npm run typecheck
npm run docs:check
npm run build
```

Tests do not prove hosted Supabase configuration, OAuth-provider setup, secret
availability, or a production deployment. Follow the relevant release or OAuth
runbook when the issue requires live evidence.

## Before changing code

Start from the GitHub Issue that defines the work, identify the smallest
behavioral seam that proves it, and read the nearby implementation and tests.
If behavior, setup, configuration, domain language, data handling, architecture,
or operations change, update the document that owns that truth in the same
change. See the [contribution guide](../CONTRIBUTING.md) for the human workflow.
