# Contributing to NeuroNutrition

This guide is for project maintainers and approved contributors. NeuroNutrition
is publicly visible but currently has no license; do not treat the repository as
open-source software or assume permission to copy, redistribute, or create
derivative works.

## Start with a GitHub Issue

GitHub Issues are the source of work. Before making a change:

1. Select an approved, sufficiently specified issue, or discuss a proposed
   change with a maintainer first.
2. Read linked parent issues, blockers, and decisions so the change preserves
   the accepted product and security boundaries.
3. Keep one branch and pull request focused on one coherent issue. Record newly
   discovered defects as follow-up issues instead of silently expanding scope.

The repository may contain work that is planned, gated, transitional, or
available only for verification. Confirm current code and configuration before
describing such behavior as available.

## Create a branch

Update your local default branch, then create a short, descriptive branch. Use
lowercase words separated by hyphens and include the issue number when useful,
for example `docs/77-contributor-onboarding`.

Do not mix formatting, dependency updates, generated files, or unrelated fixes
into the branch. Preserve existing worktree changes that are not yours.

## Make the change

- Follow the [developer guide](docs/development.md) for setup, repository
  orientation, and the testing strategy.
- Use the canonical product language in [CONTEXT.md](CONTEXT.md).
- Keep browser code free of secrets. Do not include tokens, authorization codes,
  email addresses, raw provider errors, credentials, personal Health Profile
  data, or client-confidential information in code, tests, documentation,
  screenshots, issues, logs, or artifacts.
- Add or update tests at the user-visible or public contract seam when behavior
  changes. Avoid tests coupled to private implementation details.
- Update the owning documentation whenever behavior, setup, configuration,
  architecture, data handling, operational procedure, or domain language
  changes. Link to detailed guidance rather than copying it into several files.

## Verify the result

Run focused tests while iterating and run all project checks before opening a
pull request:

```text
npm test
npm run typecheck
npm run docs:check
npm run build
```

Review the final diff for issue scope, accidental files, sensitive values, and
documentation freshness. Automated checks do not establish that hosted
configuration or a production release is correct; provide the live evidence
required by the issue when applicable.

## Commit and open a pull request

Create small, understandable commits with imperative messages that explain the
outcome. Do not commit `.env.local`, service credentials, generated `dist/`
output, local Supabase state, or production evidence containing sensitive data.

Open a pull request that:

- links the originating issue;
- summarizes the user-visible or operational outcome;
- lists the exact verification commands and their results;
- calls out migrations, configuration, rollout, security, or documentation
  effects; and
- identifies any intentionally deferred work.

Respond to review with additional focused commits. Do not rewrite or force-push
shared history unless the maintainer coordinating the branch asks you to.

## Agent operators

Automated contributors follow the same GitHub Issues and review path. Repository
specific instructions live in:

- [issue tracker and Wayfinding workflow](docs/agents/issue-tracker.md)
- [triage label mapping](docs/agents/triage-labels.md)
- [domain-documentation rules](docs/agents/domain.md)

Those files are authoritative for agent operations; this human-first guide does
not duplicate their workflow.
