export const APPLICATION_BASE_PATH = '/neuro-nutrition/';
export const PASSWORD_RECOVERY_PATH =
  `${APPLICATION_BASE_PATH}recover-password`;

// Documented, non-discoverable path used to validate an OAuth provider in
// `verify` mode before it is promoted to `on`. A provider in `verify` mode is
// reachable only from this exact path and stays hidden on normal Log In /
// Create Account. See docs/oauth/verification-matrix.md (case G2).
export const OAUTH_VERIFICATION_PATH =
  `${APPLICATION_BASE_PATH}verify-oauth`;

export const passwordRecoveryUrl = (origin: string) =>
  new URL(PASSWORD_RECOVERY_PATH, origin).toString();
