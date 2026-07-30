export const APPLICATION_BASE_PATH = '/neuro-nutrition/';
export const PASSWORD_RECOVERY_PATH =
  `${APPLICATION_BASE_PATH}recover-password`;

export const passwordRecoveryUrl = (origin: string) =>
  new URL(PASSWORD_RECOVERY_PATH, origin).toString();
