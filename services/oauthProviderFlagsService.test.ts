import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAUTH_VERIFICATION_PATH } from "./applicationRoutes";
import {
  getProviderMode,
  type OAuthProvider,
} from "./oauthProviderFlagsService";

const ENV_KEY: Record<OAuthProvider, string> = {
  google: "VITE_OAUTH_GOOGLE_MODE",
  apple: "VITE_OAUTH_APPLE_MODE",
};

const setUrl = (pathname: string) => {
  window.history.pushState({}, "", pathname);
};

const providers: OAuthProvider[] = ["google", "apple"];

describe("oauthProviderFlagsService.getProviderMode", () => {
  beforeEach(() => {
    setUrl("/neuro-nutrition/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setUrl("/neuro-nutrition/");
  });

  describe.each(providers)("provider %s", (provider) => {
    const key = ENV_KEY[provider];

    it("fails closed to 'off' when the flag is missing", () => {
      // No stubbed value: the flag is simply absent from the build.
      vi.stubEnv(key, undefined as unknown as string);
      expect(getProviderMode(provider)).toBe("off");
    });

    it("fails closed to 'off' when the flag is an empty string", () => {
      vi.stubEnv(key, "");
      expect(getProviderMode(provider)).toBe("off");
    });

    it("fails closed to 'off' when the flag is whitespace only", () => {
      vi.stubEnv(key, "   ");
      expect(getProviderMode(provider)).toBe("off");
    });

    it("fails closed to 'off' for an unrecognized value", () => {
      vi.stubEnv(key, "enabled");
      expect(getProviderMode(provider)).toBe("off");
    });

    it("fails closed to 'off' for a case variant (exact match required)", () => {
      vi.stubEnv(key, "ON");
      expect(getProviderMode(provider)).toBe("off");
    });

    it("returns 'off' when explicitly configured to 'off'", () => {
      vi.stubEnv(key, "off");
      expect(getProviderMode(provider)).toBe("off");
    });

    it("returns 'on' when configured to 'on'", () => {
      vi.stubEnv(key, "on");
      expect(getProviderMode(provider)).toBe("on");
    });

    it("returns 'on' regardless of the current URL", () => {
      vi.stubEnv(key, "on");
      setUrl("/some/unrelated/path");
      expect(getProviderMode(provider)).toBe("on");
    });

    it("returns 'verify' when configured to 'verify' and on the verification URL", () => {
      vi.stubEnv(key, "verify");
      setUrl(OAUTH_VERIFICATION_PATH);
      expect(getProviderMode(provider)).toBe("verify");
    });

    it("collapses 'verify' to 'off' when not on the verification URL", () => {
      vi.stubEnv(key, "verify");
      setUrl("/neuro-nutrition/");
      expect(getProviderMode(provider)).toBe("off");
    });
  });

  it("controls each provider independently", () => {
    vi.stubEnv(ENV_KEY.google, "on");
    vi.stubEnv(ENV_KEY.apple, "off");
    expect(getProviderMode("google")).toBe("on");
    expect(getProviderMode("apple")).toBe("off");
  });
});
