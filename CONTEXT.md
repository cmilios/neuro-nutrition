# NeuroNutrition

NeuroNutrition creates personalized meal plans and uses a completed week's experience to shape the following week.

## Language

**Weekly Plan**:
A seven-day set of breakfast, lunch, dinner, and snack meals tailored to the user's profile.
_Avoid_: Menu, schedule

**Current Weekly Plan**:
The authoritative Weekly Plan presently served to an authenticated user across sessions and devices. A device may temporarily display an older copy, but creating a Next Weekly Plan replaces the authoritative plan, and a Meal Reroll updates the selected Meal Slot in that plan.
_Avoid_: Active menu, local plan

**Meal Review**:
The user's record of which meals from the current Weekly Plan were cooked and liked.
_Avoid_: Review form, survey

**Cooked Meal**:
A meal from the current Weekly Plan that the user prepared.
_Avoid_: Completed meal

**Liked Meal**:
A Cooked Meal that the user enjoyed.
_Avoid_: Favorite

**Disliked Meal**:
A Cooked Meal that the user did not enjoy.
_Avoid_: Rejected meal

**Uncooked Meal**:
A meal from the current Weekly Plan that the user did not prepare.
_Avoid_: Skipped meal

**Empty Meal Review**:
A Meal Review in which the user supplied no information about any meal.
_Avoid_: All meals uncooked

**Partial Meal Review**:
A Meal Review with information for at least one meal. Every untouched meal in a Partial Meal Review is an Uncooked Meal.
_Avoid_: Incomplete survey

**Same Meal**:
Two meals with the same ingredients and preparation, regardless of their displayed names.
_Avoid_: Exact-name match, renamed variation

**Meal Reroll**:
The replacement of one meal with a different meal of the same meal type, without changing the rest of the Weekly Plan.
_Avoid_: Refresh, regenerate plan

**Meal Slot**:
One position in a Weekly Plan, identified by its day and meal type.
_Avoid_: Position, time

**Start Over**:
The user command that removes the Current Weekly Plan by deactivating it while preserving the user's profile, milestones, AI Usage Records, and inactive plan history. It is distinct from permanent account-data deletion.
_Avoid_: Reset account, delete account

**Next Weekly Plan**:
The variety-focused successor to the current Weekly Plan, evaluated only against that immediately preceding plan. It retains each Liked Meal as an exact recipe copy under the same meal type on a different day and replaces Disliked and Uncooked Meals; after an Empty Meal Review, the planner may retain at most seven Same Meals chosen to preserve nutritional balance and weekly variety, and must change at least twenty-one. Every retained meal keeps its meal type but moves to a different day.
_Avoid_: Random plan, reset plan

**Proven Weekly Plan**:
A Weekly Plan in which every meal was cooked and liked. Its successor retains all twenty-eight exact meals under the same meal types and rotates each to a different day.
_Avoid_: Perfect plan, final plan

**AI Usage Record**:
An immutable attribution of one billable AI generation attempt to a user, including measured model usage and the cost estimate applicable at that time.
_Avoid_: Diagnostic log, invoice
