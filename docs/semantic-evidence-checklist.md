# Documentation ownership and semantic evidence checklist

**Audience:** maintainers and documentation reviewers.

**Purpose:** identify the single owner for each kind of public claim and map
claims that require human judgment to current evidence. This checklist
complements `npm run docs:check`; it does not turn repository state into proof
of hosted configuration or production readiness.

## How to use this checklist

Review every row when its owner changes and before making a release or
publication claim. Follow the linked evidence to the behavior, configuration,
or live system; do not approve a row from prose alone. Record time-sensitive
results in the release or issue evidence for the exact commit under review.

If the evidence is missing or contradictory, correct a documentation defect in
the owning document. Record a product, security, privacy, Supabase, environment,
or infrastructure defect as separate follow-up work rather than weakening the
claim or silently expanding documentation work into a product change.

## Document ownership

| Fact class | Owning document | Audience and purpose |
| --- | --- | --- |
| Product orientation, maturity, live-app entry, shortest local start, and documentation index | [`README.md`](../README.md) | Repository visitors deciding what NeuroNutrition is or where to go next. |
| End-user tasks and plain-language safety limits | [`docs/wiki/`](wiki/) | People using the beta; each page states its task and intended reader. |
| Canonical product vocabulary | [`CONTEXT.md`](../CONTEXT.md) | Contributors naming domain behavior consistently. |
| Local setup, repository layout, and test strategy | [`docs/development.md`](development.md) | Maintainers and approved contributors running and verifying the project. |
| Contribution workflow and definition of done | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Maintainers and approved contributors preparing changes. |
| Runtime architecture, trust boundaries, and internal data flow | [`docs/architecture.md`](architecture.md) | Maintainers changing the system without treating internal interfaces as a public API. |
| Technical data-handling inventory and privacy/security boundaries | [`docs/privacy-and-security.md`](privacy-and-security.md) | Maintainers, contributors, and security reviewers; it is not a legal privacy policy. |
| Private vulnerability reporting | [`SECURITY.md`](../SECURITY.md) | Security researchers and reporters using a non-public route. |
| Deployment, verification, rollback, and live-evidence procedure | [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Authorized operators; the runbook does not assert current hosted state. |
| Provider verification and Apple credential rotation | [`docs/oauth/`](oauth/) | Authorized operators performing specialist OAuth gates and rotation. |
| Durable architectural decisions | [`docs/adr/`](adr/) | Maintainers understanding decisions that constrain future changes. |
| Documentation ownership and semantic traceability | This checklist | Maintainers reviewing claims that cannot be validated mechanically. |

Detailed facts stay with the owner above. Other documents should summarize only
what their audience needs and link to the owner for the maintained detail.

## Screenshot source

The approved documentation image source is
[`docs/wiki/assets/`](wiki/assets/). The current set contains one tightly
cropped Weekly Plan image with synthetic meal names and ingredients, no account
or Health Profile data, and meaningful alternative text in both the landing
page and Wiki Home. Review the image visually against the current UI whenever
meal-card presentation changes; file existence and alternative-text checks do
not prove that pixels are current or synthetic.

## Behavioral claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| Account access, Display Name, settings, password, provider, and logout guidance matches the offered UI. | [Account and Settings](wiki/Account-and-Settings.md) | [`App.oauth.test.tsx`](../App.oauth.test.tsx), [`components/AuthScreen.test.tsx`](../components/AuthScreen.test.tsx), [`services/authService.test.ts`](../services/authService.test.ts), and account behavior in [`App.tsx`](../App.tsx). | Compare every named control and availability statement with the normal signed-out and signed-in UI; label gated or mocked capabilities explicitly. |
| Initial generation, Meal Reroll, Meal Review, Next Weekly Plan, Health Profile Plan Replacement, retry, and Start Over guidance matches user-visible behavior. | [Weekly Plan Wiki pages](wiki/) | [`App.test.tsx`](../App.test.tsx), [`App.nextGeneration.test.tsx`](../App.nextGeneration.test.tsx), [`App.startOver.test.tsx`](../App.startOver.test.tsx), [`services/weeklyPlanGateway.test.ts`](../services/weeklyPlanGateway.test.ts), and [`supabase/functions/generate-meal-plan/`](../supabase/functions/generate-meal-plan/). | Walk each task and compare labels, disabled/read-only states, success, definite failure, and unknown-outcome recovery. |
| The architecture describes authoritative state, cache fallback, command identity, and recovery without promising a public API. | [`docs/architecture.md`](architecture.md) | [`services/weeklyPlanGateway.ts`](../services/weeklyPlanGateway.ts), [`services/weeklyPlanCache.ts`](../services/weeklyPlanCache.ts), command migrations, Edge Function tests, and [`authorityFirstSourceBoundary.test.ts`](../authorityFirstSourceBoundary.test.ts). | Trace each lifecycle diagram to the linked code and migration; describe transitional paths as transitional. |

## Health-safety claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| NeuroNutrition is described as AI-Assisted Meal Planning, not medical advice, diagnosis, treatment, or an AI nutritionist. | [`CONTEXT.md`](../CONTEXT.md) | Canonical definitions in [`CONTEXT.md`](../CONTEXT.md) and the public landing/Wiki safety summaries. | Search every intended public document for prohibited or stronger health claims and review generated examples for implied medical authority. |
| Allergy and dietary-restriction inputs are not presented as an ingredient-safety guarantee. | [Privacy and Safety](wiki/Privacy-and-Safety.md) | Profile inputs in [`components/ProfileForm.tsx`](../components/ProfileForm.tsx) and prompt construction in [`supabase/functions/generate-meal-plan/index.ts`](../supabase/functions/generate-meal-plan/index.ts). | Confirm user guidance requires independent ingredient and label checks and does not claim the generator enforces safety. |

## Privacy claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| The saved-data inventory, AI-generation inputs, browser copies, telemetry exclusions, and deletion limitations match current implementation. | [`docs/privacy-and-security.md`](privacy-and-security.md) | Evidence links in that document to application services, Edge Functions, migrations, storage boundaries, and tests. | Follow each evidence link; do not infer hosted retention, encryption, deletion, or provider behavior that the repository cannot prove. |
| Public reports and documentation examples exclude secrets, tokens, authorization codes, email addresses, raw provider errors, Health Profile data, and sensitive screenshots. | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | The user-facing summary in [Troubleshooting](wiki/Troubleshooting.md), structured forms under [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/), and validation in [`docs/check.mjs`](check.mjs). | Inspect prose, images, fixtures, issue forms, and proposed evidence before publication; automated string checks are only a minimum guard. |
| Suspected vulnerabilities have a private reporting route. | [`SECURITY.md`](../SECURITY.md) | GitHub repository private-vulnerability-reporting setting and the linked advisory form. | Verify the live setting before claiming availability; never redirect vulnerability details to a public issue. |

## Supabase claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| Auth, RLS, ownership checks, privileged operations, authoritative Weekly Plans, and durable commands are described from repository behavior. | [`docs/architecture.md`](architecture.md) | [`supabase/config.toml`](../supabase/config.toml), migrations under [`supabase/migrations/`](../supabase/migrations/), PGlite migration tests, and Edge Functions under [`supabase/functions/`](../supabase/functions/). | Distinguish repository intent from applied hosted schema and function configuration; verify the target project live for release claims. |
| Public Supabase identifiers and browser-safe variables are separated from server secrets. | [`DEPLOYMENT.md`](../DEPLOYMENT.md) | [`.env.example`](../.env.example), Vite configuration, workflow secret references, and Edge Function environment access. | Confirm examples contain placeholders or documented public identifiers only; never capture secret values in evidence. |

## Environment claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| The supported local Node/npm baseline and documented npm commands match machine-readable project metadata. | [`docs/development.md`](development.md) | [`.nvmrc`](../.nvmrc), [`package.json`](../package.json), [`package-lock.json`](../package-lock.json), and command validation in [`docs/check.mjs`](check.mjs). | Run setup and all documented commands in a clean supported environment when changing the baseline. |
| Every documented public `VITE_*` variable belongs to the public configuration contract. | [`docs/development.md`](development.md) | [`.env.example`](../.env.example), configuration consumers, and the `public-env` validator. | Confirm browser exposure is intentional and that no server secret was renamed into a `VITE_*` variable. |

## Deployment claims

| Claim under review | Owner | Current evidence | Human check |
| --- | --- | --- | --- |
| Application deployment, migration, verification, observation, and rollback steps are reproducible procedures rather than assertions that production is ready. | [`DEPLOYMENT.md`](../DEPLOYMENT.md) | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), release tooling under [`release/`](../release/), migration tests, and the runbook's evidence gates. | Tie every live claim to the exact commit, target, workflow run, and non-secret observation evidence. A local pass is not deployment proof. |
| Wiki source is repository-authoritative, publication is independent of app deployment, and rendered pages are inspected after publication. | [`docs/adr/0002-repository-authoritative-github-wiki.md`](adr/0002-repository-authoritative-github-wiki.md) | `npm run docs:check`, [the publication workflow](../.github/workflows/publish-wiki.yml), and its rendered page, navigation, image, and heading checks. | Verify the workflow run for the exact merged commit and inspect the rendered Wiki; a branch commit or local validation is not publication evidence. |

## Final semantic review record

For the commit under review, record these non-secret results in its issue or
release evidence:

- reviewer and UTC timestamp;
- exact commit SHA and target environment;
- pass/fail for every section above, with evidence links;
- `npm run docs:check`, complete tests, typecheck, and production-build results;
- Wiki publication run and rendered-inspection result from `main`;
- private vulnerability-reporting verification; and
- follow-up issue links for any product, security, privacy, Supabase,
  environment, or infrastructure defect.

Do not mark the documentation system complete while any row is unsupported or
while publication evidence belongs to a different commit.
