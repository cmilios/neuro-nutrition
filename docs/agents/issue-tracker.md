# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list` with appropriate state and label filters
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and PRs. Resolve ambiguous references using `gh pr view <number>`, then fall back to `gh issue view <number>`.

## Skill operations

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means read the issue and its comments.
- Use GitHub sub-issues and native issue dependencies when skills need parent, child, or blocking relationships.

## Wayfinding

A wayfinding map is one issue with linked child issues.

- Map label: `wayfinder:map`
- Child labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`
- Claim work by assigning the issue to the current user.
- A ticket is ready only when it has no open blocker and no assignee.
- If native dependencies are unavailable, record `Blocked by: #<number>` in the issue body.
