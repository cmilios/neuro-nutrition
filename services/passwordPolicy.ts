export const passwordPolicyMessage =
  'Use at least 8 characters with one letter and one number.';

export const satisfiesPasswordPolicy = (password: string) =>
  password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
