# Domain Docs

This repository uses the single-context documentation layout.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If they do not exist, proceed silently. Domain-modeling workflows create them when terminology or architectural decisions are resolved.

## Layout

```text
/
├── CONTEXT.md
├── docs/adr/
└── components/, services/, supabase/
```

## Vocabulary

Use terminology defined in `CONTEXT.md`. Avoid introducing synonyms that conflict with its glossary.

If a change contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
