# Privacy and Safety

_For people deciding whether to use the NeuroNutrition beta. This page explains
the current privacy and health-safety boundaries in plain language._

## What NeuroNutrition saves

Your account is managed by Supabase Auth. NeuroNutrition uses your email,
Display Name, connected sign-in methods, and account ID to load the data that
belongs to you.

Your saved Health Profile can include age, gender selection, height, weight,
target weight, activity level, goal, diet preference, allergy or dislike text,
an optional profile image, and milestones. Supabase also stores your Current
and previous Weekly Plans, ingredient-check progress, and records needed to
finish or recover plan changes safely.

## What is used for meal generation

NeuroNutrition sends the saved Health Profile to its protected Supabase
function, which asks OpenAI to generate meal-planning content. A Next Weekly
Plan can also use your previous plan and Meal Review; a Meal Reroll uses the
current meal and relevant goal, diet, and allergy details.

The protected function receives the optional profile image as part of the saved
Health Profile, but does not include that image in the OpenAI prompt. Your email
address, Display Name, session token, and milestone notes are not included in
the prompt either. OpenAI is an external service, and this beta does not promise
a specific provider-retention period.

## Browser copies

Your browser keeps the signed-in session and may keep a user-specific copy of
the Current Weekly Plan for temporary read-only fallback. It also stores your
theme preference. On a shared device, log out when you finish. Clearing browser
data removes local copies, not the data saved with your account.

## Health and allergy safety

NeuroNutrition provides general AI-Assisted Meal Planning guidance. It is not
medical advice, diagnosis, or treatment. If you have medical dietary needs,
consult a qualified clinician or dietitian.

Entering an allergy or dietary restriction does not guarantee ingredient
safety. Check every suggested ingredient and product label yourself before
cooking or eating.

## Deletion limits in this beta

There is no in-app permanent account-deletion or complete data-erasure flow.
**Start Over does not delete your account or Health Profile.** It removes the
Current Weekly Plan from use while preserving your profile, milestones, and
previous plan and generation history. Logging out also does not delete saved
data.

The project does not currently promise one retention period for every account,
database, log, or external-provider record.

## Report problems safely

Never put passwords, session links, tokens, email addresses, Health Profile
details, screenshots containing personal data, or raw provider errors in a
public issue.

Report a suspected security vulnerability through the
[private vulnerability-reporting form](https://github.com/cmilios/neuro-nutrition/security/advisories/new).
Use the public issue tracker only for ordinary bugs after removing personal and
sensitive information.

For the verified inventory, enforcement boundaries, telemetry exclusions, and
evidence sources, read the repository's
[technical privacy and security source](https://github.com/cmilios/neuro-nutrition/blob/main/docs/privacy-and-security.md).

[Return to the Wiki Home](https://github.com/cmilios/neuro-nutrition/wiki)
