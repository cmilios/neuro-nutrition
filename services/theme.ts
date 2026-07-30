export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'neuro-nutrition-theme';

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

const systemPrefersDark = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const getThemePreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'system';

  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : 'system';
  } catch {
    return 'system';
  }
};

export const applyThemePreference = (preference: ThemePreference) => {
  if (typeof document === 'undefined') return;

  const useDarkTheme =
    preference === 'dark' || (preference === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', useDarkTheme);
  document.documentElement.style.colorScheme = useDarkTheme ? 'dark' : 'light';
};

export const setThemePreference = (preference: ThemePreference) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies when storage is unavailable.
  }
  applyThemePreference(preference);
};

export const initializeTheme = () => {
  const preference = getThemePreference();
  applyThemePreference(preference);

  if (typeof window.matchMedia !== 'function') return () => {};

  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    if (getThemePreference() === 'system') applyThemePreference('system');
  };
  colorSchemeQuery.addEventListener?.('change', handleSystemThemeChange);

  return () =>
    colorSchemeQuery.removeEventListener?.('change', handleSystemThemeChange);
};
