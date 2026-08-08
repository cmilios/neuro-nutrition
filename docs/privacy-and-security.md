# Privacy and security: current technical boundaries

_For maintainers, contributors, and security reviewers. This document describes
the data-handling behavior evidenced by the current repository. It is not a
legal privacy policy, terms of service, medical disclaimer, compliance
statement, or production-readiness certification._

This account was checked against the repository's application code, tests,
configuration, and migrations on 2026-08-09. Repository evidence does not prove
the state of every hosted setting. Where the code does not establish a fact,
this document says so rather than assuming encryption, retention, deletion,
compliance, or deployment guarantees.

For a shorter user-facing explanation, see the
[Wiki Privacy and Safety page](https://github.com/cmilios/neuro-nutrition/wiki/Privacy-and-Safety).

## Data inventory

| Data | Current use and location |
| --- | --- |
| Account and sign-in data | Supabase Auth manages the account ID, email address, password or connected-provider identity, user metadata containing the Display Name, and browser session. NeuroNutrition reads the account ID, email, Display Name, and connected-method metadata. Application tables link records to the Supabase Auth user ID. |
| Health Profile | `user_data.profile` stores age, gender selection, height, weight, optional target weight, activity level, goal, diet preference, allergy or dislike text, and an optional uploaded profile image encoded in the profile document. `user_data.milestones` stores dated weight, optional body-fat percentage, and optional notes. |
| Weekly Plan history | `weekly_plans` stores generated recipes, ingredients, instructions, nutrition estimates, ingredient-check progress, revisions, generation relationships, and active or inactive state. `weekly_plan_commands` and Meal Reroll reservations store durable operation identity, state, checkpoints, bounded failure information, and recovery evidence. |
| Meal Review input | Cooked, Liked, Disliked, and Uncooked outcomes are sent when creating a Next Weekly Plan. The durable command stores an input fingerprint and operational checkpoint rather than a separately browser-readable Meal Review record. The resulting plan records its predecessor relationship. |
| AI Usage Records | `ai_usage_records` is an immutable, operator-only ledger keyed to the user and generation command. It stores provider/model identifiers, token counts, provider request/response identifiers, bounded outcome and validation codes, raw provider usage metadata, and the pricing snapshot used for the cost estimate. It does not store the generated plan or prompt as a ledger field. |
| Privacy-limited incidents | `weekly_plan_client_incidents` stores an event type, user ID when authenticated, timestamp, and a closed set of short operational context values. The signed-out OAuth failure event may omit the user ID and is database-rate-limited. |

The current application does not use Supabase Storage for profile images. The
optional image is stored inside the Health Profile JSON document. The Apple
Health control is an experimental demonstration and is not a live Apple Health
integration.

## Data flow for AI-Assisted Meal Planning

The browser sends an authenticated generation request to the
`generate-meal-plan` Supabase Edge Function. The function validates the bearer
token with Supabase Auth before privileged work. The request carries the Health
Profile document, including the optional image when one has been saved. The
function validates the profile and inserts only the following named values into
the OpenAI prompt, depending on the requested operation:

- age, gender selection, height, current and optional target weight, activity
  level, goal, diet preference, and allergy or restriction text;
- the immediately preceding Weekly Plan and normalized Meal Review for a Next
  Weekly Plan; or
- the current meal, goal, diet preference, and allergy text for a Meal Reroll.

The optional profile image, email address, Display Name, session token, and
milestone notes are not inserted into the OpenAI prompt. The Edge Function sets
`store: false` on its Responses API request, but this repository does not claim
a broader provider-retention guarantee. OpenAI remains an external processing
boundary governed by its own service terms.

The function validates the returned structured content before a privileged
server client commits a Weekly Plan command or plan document to Supabase.
Measured usage and provider identifiers are recorded separately in the AI Usage
Record. The OpenAI API key and Supabase service credential remain server-side;
the browser neither receives them nor calls OpenAI directly.

## Supabase persistence and ownership enforcement

The browser is configured with the public Supabase project URL and a
publishable or legacy anon key. Those values identify the project; they do not
grant ownership of another user's rows. Supabase attaches the signed-in user's
JWT, and Postgres grants plus Row Level Security (RLS) enforce data access.

- `user_data` enables RLS and permits select, insert, update, and delete only
  when `auth.uid()` matches `user_id`.
- `weekly_plans` enables RLS. Authenticated browser clients receive read access
  only to owner-matching rows; direct browser writes are revoked.
- Weekly Plan changes go through narrowly granted RPCs. Some functions are
  `SECURITY DEFINER`, so their authenticated-caller checks, ownership checks,
  fixed search paths, and restricted execute grants are part of the security
  boundary.
- AI Usage Records and incident tables are not browser reporting surfaces.
  Their direct privileges are revoked from ordinary browser roles; only narrow
  server or monitoring roles receive required access.
- The Edge Functions use endpoint-specific authentication in their handlers.
  `generate-meal-plan` requires a Supabase user, the observation function
  requires a dedicated monitoring token, and the bounded incident fallback is
  intentionally anonymous because `sendBeacon` cannot attach authorization.

A browser-side `user_id` filter is not an authorization control. RLS and the
authenticated RPC checks are the server-side enforcement points. See
[System architecture and trust boundaries](architecture.md) for the wider
runtime model.

## Browser storage and caching

Supabase's browser client persists authentication state using its default
browser-storage behavior so a session can be restored. Treat any browser that
holds an active session as able to act as that user; log out after using a
shared device.

NeuroNutrition also uses:

- `sessionStorage` for a validated, user-keyed copy of the Current Weekly Plan;
- `sessionStorage` for short-lived OAuth initiation state; and
- `localStorage` for the System, Light, or Dark theme preference.

The Weekly Plan cache is an availability fallback, not a source of truth. Its
embedded owner must match the authenticated user, stale content is read-only,
only a confirmed server response can establish that no Current Weekly Plan
exists, and logout or an authoritative empty result clears the user's cached
plan. Browser storage is local to that browser profile and is not a secure
vault; clearing site data removes local copies but does not delete server data.

## Privileged operations and secrets

Public `VITE_*` values are compiled into the browser and must never contain a
server credential. The service-role credential, OpenAI API key, monitoring
token, and optional incident-webhook credential belong only in protected Edge
Function or automation secret stores. They must not appear in source,
documentation, browser storage, issue reports, workflow output, or built assets.

Privileged server credentials may bypass ordinary RLS, so they are limited to
Edge Function and monitoring paths that first enforce the endpoint's caller
contract. A local configuration file or migration is not proof that the same
control is deployed correctly in a hosted environment.

## Telemetry exclusions

Client incident reporting is best-effort operational telemetry. The browser and
database accept only named event types and short values for provider, phase,
lifecycle stage, operation, authority status, stable error code, release
identifier, or timestamp. Unexpected keys are dropped in the browser and
rejected by the database. The unauthenticated delivery fallback accepts only a
closed three-field payload and drops all extra fields before logging it.

Do not send tokens, authorization codes, passwords, email addresses, Display
Names, Health Profile values, milestones, plan or recipe content, free-form
notes, raw Supabase/OpenAI/provider errors, credentials, or secret values
through telemetry or bug reports. Server diagnostics use stable codes and
operational identifiers where implemented; browser console output is not a
supported durable audit or reporting channel.

## Current deletion and retention limitations

The application has no in-app permanent account deletion, data export, or
complete erasure workflow.

**Start Over is not deletion.** It deactivates the Current Weekly Plan while
preserving the Health Profile, milestones, inactive Weekly Plan history, command
history, and AI Usage Records. Logging out clears the application's in-memory
state and its Current Weekly Plan cache for that user, but it does not delete
Supabase Auth or database records.

Several application tables are configured to cascade when an Auth user is
deleted. AI Usage Records instead reference the Auth user with `ON DELETE
RESTRICT` and are immutable through ordinary mutation paths. Therefore a
maintainer cannot treat Auth-user deletion alone as a verified complete-erasure
procedure; an intentionally designed operator process would be required.

The repository defines no comprehensive retention schedule for Auth records,
Health Profiles, Weekly Plans, commands, AI Usage Records, incidents, Edge
Function logs, or external-provider processing. It also does not establish a
universal backup-deletion timetable. Do not promise a retention or erasure
deadline until the hosted services and an approved process have been verified.

## Security reporting

Do not disclose a suspected vulnerability in a public issue. Follow the
[security policy](../SECURITY.md), which uses GitHub's private vulnerability
reporting route. Ordinary product and documentation bugs can use the public
issue tracker after all personal data and sensitive diagnostics are removed.

## Evidence checklist

The claims above are grounded in these current sources:

- Account/session behavior: `services/supabaseClient.ts`,
  `services/authService.ts`, and `App.tsx`.
- Health Profile fields and persistence: `types.ts`,
  `components/ProfileForm.tsx`, `services/storageService.ts`, and
  `supabase/migrations/20260722091747_user_data.sql`.
- Weekly Plan authority, cache, RLS, and commands:
  `services/weeklyPlanCache.ts`, `services/weeklyPlanGateway.ts`, and the
  migrations beginning with `20260727120000_create_weekly_plans.sql`.
- AI request and usage boundaries:
  `supabase/functions/generate-meal-plan/index.ts`, `handler.ts`, `usage.ts`,
  `persistence.ts`, and
  `supabase/migrations/20260722193317_create_ai_usage_records.sql`.
- Incident exclusions: `services/clientIncidentContext.ts`,
  `services/clientIncidentTelemetry.ts`, the client-incident migrations, and
  `supabase/functions/client-incident-alert/`.
- Endpoint authentication and public configuration: `supabase/config.toml` and
  `.env.example`.

Relevant platform references are
[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets),
and [OpenAI API key safety](https://platform.openai.com/docs/api-reference/authentication).
Recheck current vendor guidance whenever a security-sensitive implementation
changes.

Update this document whenever account fields, Health Profile fields, AI prompt
inputs, persistence, RLS/grants, privileged functions, browser caching,
telemetry, deletion behavior, or secret handling changes.
