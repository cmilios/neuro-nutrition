# Troubleshooting

_For people recovering from ordinary NeuroNutrition account, settings, or
documentation problems without exposing private information._

[Return to the user-guide Home](https://github.com/cmilios/neuro-nutrition/wiki)
· [Manage Account and Settings](https://github.com/cmilios/neuro-nutrition/wiki/Account-and-Settings)

## A sign-in method is missing

Use only methods shown on the normal **Log In** or **Create Account** screen.
[Account and Settings](https://github.com/cmilios/neuro-nutrition/wiki/Account-and-Settings)
owns the current availability details. A provider being tested in verification
mode is hidden from ordinary users and should not be treated as available.

If a method you previously used is absent:

1. Try another method already connected to the same account.
2. If you are still signed in on another browser, open **Account → Security**
   and check **Connected sign-in methods**.
3. Add a password before disconnecting an unavailable provider.
4. Do not create a second account just to work around a missing provider unless
   you intend to keep separate Health Profile and Weekly Plan data.

## Google sign-in was canceled or failed

Return to the normal sign-in screen and retry once. If the app reports that the
attempt was canceled, no account change was made. If it fails again, use a
different connected method.

Do not copy the provider callback URL, authorization code, or raw provider error
into a public report. Record only the task, the safe message shown by
NeuroNutrition, the approximate time, and whether the failure happened before
or after leaving the app.

## The Display Name screen does not continue

Remove leading or trailing spaces, enter a non-blank name, and select **Save**.
If the app says it could not save, retry. Health Profile and Weekly Plan data do
not load until the save succeeds. Select **Log Out** if you do not want to
complete the name.

## A recovery email or link does not work

Recovery-email requests currently start from **Account → Security** while you
are signed in. If too many requests were made, wait before trying again. Use the
most recent recovery email and open its link in the browser where you intend to
finish recovery.

If the recovery page says the link is invalid or expired, return to a still
signed-in session and request a new email. If you are signed out everywhere,
try another connected method that is currently offered. Never post the recovery
link or your email address in a public issue.

## A connected method is unavailable

Open **Account → Security**. A connected provider that is currently off is
labeled **Sign-in temporarily unavailable**. Add a password or verify another
connected method before attempting to disconnect it. The app blocks removal of
your only provider when no password is present.

## Appearance is wrong on another device

Theme choice is stored per browser. Open **Account → Appearance** on the affected
device and choose **System**, **Light**, or **Dark** there. **System** follows
that device's current operating-system preference.

## Apple Health appears to sync data

The Apple Health control is a mocked experimental demonstration. It does not
connect to a real Apple Health account. Treat any populated values as sample
behavior and enter and verify your Health Profile manually.

## Logout did not affect another device

**Log Out** ends only the current browser session. Repeat logout on every shared
browser or device. A password change can sign out other sessions when stronger
account-wide protection is needed.

## Report an ordinary bug

Use the [structured bug report](https://github.com/cmilios/neuro-nutrition/issues/new?template=bug_report.yml).
Include the task you were attempting, safe reproduction steps, expected and
observed behavior, browser and operating system, the page URL before any
provider redirect, and the approximate time.

## Report a documentation problem

Use the [structured documentation report](https://github.com/cmilios/neuro-nutrition/issues/new?template=documentation.yml).
Name the Wiki page or repository document, identify the unclear or inaccurate
section, and describe the correction you expected.

Public issues are not an account-support inbox. **Do not include Health Profile
data, email addresses, tokens, authorization codes, raw provider errors, or
sensitive screenshots.** Remove private details from browser-console output and
images before deciding whether any remaining evidence is safe to share.
