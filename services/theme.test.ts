import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemePreference,
  getThemePreference,
  setThemePreference,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to the system preference', () => {
    expect(getThemePreference()).toBe('system');
  });

  it('persists and applies an explicit dark preference', () => {
    setThemePreference('dark');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('resolves the system preference when applying the theme', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    applyThemePreference('system');

    expect(document.documentElement).toHaveClass('dark');
    vi.unstubAllGlobals();
  });
});
