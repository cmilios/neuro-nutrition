# Account and Settings

_For people managing access, security, profile, and appearance in the
NeuroNutrition beta. This page describes behavior verified in the current app._

[Return to the user-guide Home](https://github.com/cmilios/neuro-nutrition/wiki)
· [Troubleshoot a problem](https://github.com/cmilios/neuro-nutrition/wiki/Troubleshooting)

## Sign-in methods available now

Email and password are available for account creation and sign-in. Google is
also currently offered on the normal **Log In** and **Create Account** screens.
Apple sign-in is currently off and is not available to ordinary users.

Provider availability is controlled independently and can change during the
beta. A provider in verification mode appears only on the dedicated maintainer
verification route; it is not generally available. Use only a method shown on
the normal opening screen. If a provider button is absent, use another method
already connected to your account.

New email-and-password accounts may need to follow an email confirmation link
before their first sign-in. Keep confirmation and sign-in links private.

## Complete your Display Name

An account without a saved name stops at **Choose your Display Name** before
NeuroNutrition loads Health Profile or Weekly Plan data. Enter the name you want
the app to use and select **Save**. The name is trimmed before it is saved and
cannot be blank.

If saving fails, retry without leaving the page. You can instead select **Log
Out**; account data remains unloaded until a Display Name is saved successfully.

## Open Account settings

Open the account menu after signing in. It contains **Health Profile**,
**Appearance**, **Security**, and **Start Over** sections, plus **Log Out**.

The Apple Health control in Health Profile is an experimental mocked
demonstration. It does not connect to a real Apple Health account. Enter and
verify Health Profile values manually.

## Choose an appearance

Open **Appearance**, then choose one theme:

- **System** follows this device's light or dark preference and is the default.
- **Light** keeps the app light on this device.
- **Dark** keeps the app dark on this device.

The selection is stored in the current browser. It does not change the theme on
your other browsers or devices. If browser storage is unavailable, the selected
theme can still apply for the current page but may not be remembered.

## Manage connected sign-in methods

Open **Security** to see the methods connected to the signed-in account. A
connected Google or Apple identity can remain listed even when that provider is
currently off; the app labels it **Sign-in temporarily unavailable**.

Before selecting **Disconnect**:

1. Confirm that another listed method works for this same account.
2. If the account has no password, use **Set password** to add one.
3. Do not disconnect the only usable method.

The app prevents disconnecting the sole connected provider when no password is
present. It cannot guarantee that another provider will remain available later,
so test another method before disconnecting anything.

## Change or set a password

An account with an email-and-password method can enter its current password and
a new password under **Security**. A new password needs at least eight
characters, including one letter and one number. A successful change signs out
other sessions.

An account created through a provider can use **Set password** without entering
a current password. This keeps the current session active and adds another way
to access the account.

## Recover a password

Password recovery currently starts from an active account session. Open
**Security**, find **Forgot your current password?**, and select **Send recovery
email**. The current session stays active. Follow the private link in that email
to the recovery screen and choose a new password.

The signed-out screen does not currently offer a recovery-email request. If you
are signed out, use another connected method that appears on the normal sign-in
screen. See [Troubleshooting](https://github.com/cmilios/neuro-nutrition/wiki/Troubleshooting)
for safe next steps.

## Log out

Select **Log Out** at the bottom of the account menu. This signs out the current
browser session and clears that account's cached Weekly Plan from this browser.
It does not sign out other devices or browsers. Log out on each shared device
you used.

If Health Profile edits are unsaved, the app asks whether to keep editing or
discard them before closing the account menu or logging out.
