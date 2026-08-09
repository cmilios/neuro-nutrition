# Reviewing Your Week

_For signed-in NeuroNutrition users who are ready to review the Current Weekly
Plan and create a Next Weekly Plan._

[Return to the user-guide Home](https://github.com/cmilios/neuro-nutrition/wiki) ·
[Use your Weekly Plan](https://github.com/cmilios/neuro-nutrition/wiki/Using-Your-Weekly-Plan)

## Start a Meal Review

Select **Next Week** to open **Review Your Week**. Each Meal Slot has **Cooked**
and **Liked** controls.

- A **Cooked Meal** has **Cooked** selected.
- A **Liked Meal** is a Cooked Meal with **Liked** also selected. The **Liked**
  control becomes available after you select **Cooked**.
- A **Disliked Meal** is a Cooked Meal with **Liked** left unselected.
- An **Uncooked Meal** is one you did not prepare.

Turning **Cooked** off also turns **Liked** off for that Meal Slot.

## Empty and Partial Meal Reviews

An **Empty Meal Review** contains no information about any meal. Choose
**Continue Without Review** without changing a Meal Slot to submit one. An
Empty Meal Review does not mean that every meal was uncooked.

A **Partial Meal Review** contains information for at least one meal. Once you
change any Meal Slot, every untouched Meal Slot in that review becomes an
Uncooked Meal. Check the whole review before choosing **Generate Next Plan** so
those untouched meals are classified as you intend.

## How the Next Weekly Plan uses the review

The Next Weekly Plan is compared only with the immediately preceding Current
Weekly Plan.

- Every Liked Meal is retained as the same recipe, under the same meal type,
  but moved to a different day.
- Disliked and Uncooked Meals are replaced.
- After an Empty Meal Review, NeuroNutrition may retain at most seven Same Meals
  to preserve nutritional balance and weekly variety. At least twenty-one of
  the twenty-eight Meal Slots must change.
- If every meal was cooked and liked, the plan is a Proven Weekly Plan. Its
  successor retains all twenty-eight exact meals under their existing meal
  types and moves each one to a different day.

A Same Meal has the same ingredients and preparation even if its displayed name
changes. These retention rules describe user-visible planning behavior; they
are not a supported public API or a promise about internal request formats.

## Wait for generation to finish

After you submit the Meal Review, the Current Weekly Plan remains visible but
read-only while the Next Weekly Plan is being generated. A successful result
becomes the new Current Weekly Plan.

If generation definitely fails, the existing Current Weekly Plan remains
unchanged and the app may offer **Try Again**. Use that offered control
rather than opening another tab or submitting a second Meal Review. If the
outcome is still unknown or the app says generation is in progress, wait for
the app to reconcile it before retrying.

[Learn when to use Start Over instead](https://github.com/cmilios/neuro-nutrition/wiki/Start-Over)
