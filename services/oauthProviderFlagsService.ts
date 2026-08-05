import { OAUTH_VERIFICATION_PATH } from './applicationRoutes';

// Controls which OAuth providers are visible in the app. Each provider is
// gated independently by a build-time deployment flag that advances
// `off → verify → on`. This module is deliberately standalone: it does not
// depend on `authService` or the Supabase client, so it can be mocked at the
// module boundary in tests. See docs/oauth/verification-matrix.md (cases G1–G5).

export type OAuthProvider = 'google' | 'apple';
export type ProviderMode = 'off' | 'verify' | 'on';

// Static reads so Vite can inline the value at build time (matching how the
// rest of the codebase consumes `import.meta.env`). A dynamic key lookup would
// not be statically replaced.
const readRawMode = (provider: OAuthProvider): string | undefined => {
  switch (provider) {
    case 'google':
      return import.meta.env.VITE_OAUTH_GOOGLE_MODE;
    case 'apple':
      return import.meta.env.VITE_OAUTH_APPLE_MODE;
  }
};

const isOnVerificationUrl = (): boolean =>
  typeof window !== 'undefined' &&
  (
    window.location.pathname === OAUTH_VERIFICATION_PATH
    || window.location.pathname === `${OAUTH_VERIFICATION_PATH}/`
  );

/**
 * Resolve the effective deployment mode for a provider.
 *
 * Fails closed: any missing, empty, or unrecognized flag value resolves to
 * `'off'`. `'verify'` resolves to `'verify'` only while the browser is on the
 * hard-coded verification path; anywhere else it also collapses to `'off'` so
 * the provider stays hidden on normal Log In / Create Account.
 */
export const getProviderMode = (provider: OAuthProvider): ProviderMode => {
  const raw = readRawMode(provider);
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (value === 'on') return 'on';
  if (value === 'verify') return isOnVerificationUrl() ? 'verify' : 'off';
  return 'off';
};
