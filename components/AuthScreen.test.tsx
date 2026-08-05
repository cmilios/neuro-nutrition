import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderMode } from "../services/oauthProviderFlagsService";

const { getProviderMode, login, register } = vi.hoisted(() => ({
  getProviderMode: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../services/oauthProviderFlagsService", () => ({
  getProviderMode,
}));

vi.mock("../services/authService", () => ({
  authService: { login, register },
}));

import AuthScreen from "./AuthScreen";

type Modes = { google: ProviderMode; apple: ProviderMode };

const setModes = ({ google, apple }: Modes) => {
  getProviderMode.mockImplementation((provider: "google" | "apple") =>
    provider === "google" ? google : apple,
  );
};

const googleButton = () =>
  screen.queryByRole("button", { name: /continue with google/i });
const appleButton = () =>
  screen.queryByRole("button", { name: /continue with apple/i });
const appleDisclosure = () => screen.queryByText(/private relay/i);

describe("AuthScreen provider rail", () => {
  beforeEach(() => {
    getProviderMode.mockReset();
    login.mockReset();
    register.mockReset();
    setModes({ google: "off", apple: "off" });
  });

  // G1 — mode off hides the provider everywhere (both surfaces).
  it("hides both provider buttons and the rail when both flags are off", async () => {
    setModes({ google: "off", apple: "off" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(googleButton()).toBeNull();
    expect(appleButton()).toBeNull();
    expect(screen.queryByText(/faster sign-in/i)).toBeNull();

    // Same on the Create Account surface.
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(googleButton()).toBeNull();
    expect(appleButton()).toBeNull();
  });

  // G3 — mode on shows the button on both Log In and Create Account.
  it("shows both provider buttons on Log In and Create Account when both flags are on", async () => {
    setModes({ google: "on", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(googleButton()).not.toBeNull();
    expect(appleButton()).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(googleButton()).not.toBeNull();
    expect(appleButton()).not.toBeNull();
  });

  // G2 — verify mode surfaces the button (the flags service already restricts
  // `verify` to the verification URL, so a `verify` result means "show it").
  it("shows a provider button when its flag resolves to verify", () => {
    setModes({ google: "verify", apple: "off" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(googleButton()).not.toBeNull();
    expect(appleButton()).toBeNull();
  });

  // G4 — an 'off' resolution keeps the provider hidden. The fail-closed
  // *resolution* of missing/empty/unrecognized flag values into 'off' lives in
  // the flags service and is covered by oauthProviderFlagsService.test.ts; here
  // we assert only that AuthScreen honors an 'off' result by hiding the button.
  it("keeps a provider hidden when its flag resolves to off", () => {
    setModes({ google: "on", apple: "off" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(googleButton()).not.toBeNull();
    expect(appleButton()).toBeNull();
  });

  // E2 — a single enabled provider shows alone with no orphaned rail scaffolding
  // when the other is off.
  it("shows only the enabled provider with no empty divider when one flag is off", () => {
    setModes({ google: "off", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(googleButton()).toBeNull();
    expect(appleButton()).not.toBeNull();
    // The rail itself still renders because at least one provider is enabled.
    expect(screen.getByText(/faster sign-in/i)).toBeInTheDocument();
  });

  // E1 — email/password stays the primary path; providers sit in the rail below.
  it("keeps email/password primary with the provider rail below the submit button", () => {
    setModes({ google: "on", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    const submit = screen.getByRole("button", { name: /^sign in$/i });
    const google = googleButton();
    expect(submit).toBeInTheDocument();
    expect(google).not.toBeNull();
    // The provider button appears after the primary submit in document order.
    expect(
      submit.compareDocumentPosition(google as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // I3 — the Apple relay disclosure is present whenever the Apple button shows.
  it("shows the Apple private-relay disclosure whenever the Apple button is visible", () => {
    setModes({ google: "off", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(appleButton()).not.toBeNull();
    expect(appleDisclosure()).not.toBeNull();
  });

  it("does not show the Apple disclosure when the Apple button is hidden", () => {
    setModes({ google: "on", apple: "off" });
    render(<AuthScreen onSuccess={vi.fn()} />);

    expect(appleButton()).toBeNull();
    expect(appleDisclosure()).toBeNull();
  });

  // Clicking a provider button initiates the OAuth flow for that provider.
  it("initiates the OAuth flow with the matching provider identifier", async () => {
    const onProviderSignIn = vi.fn();
    setModes({ google: "on", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} onProviderSignIn={onProviderSignIn} />);

    await userEvent.click(googleButton() as HTMLElement);
    expect(onProviderSignIn).toHaveBeenCalledWith("google");

    await userEvent.click(appleButton() as HTMLElement);
    expect(onProviderSignIn).toHaveBeenLastCalledWith("apple");
  });

  // P1 — the email/password login path is unchanged by the provider additions.
  it("still submits email/password login unchanged when providers are enabled", async () => {
    setModes({ google: "on", apple: "on" });
    login.mockResolvedValue({ id: "user-1", email: "alex@example.com", name: "Alex" });
    const onSuccess = vi.fn();
    render(<AuthScreen onSuccess={onSuccess} onProviderSignIn={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/you@example.com/i), "alex@example.com");
    await userEvent.type(screen.getByPlaceholderText("••••••••"), "secret-password1");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(login).toHaveBeenCalledWith("alex@example.com", "secret-password1");
    expect(onSuccess).toHaveBeenCalledWith({
      id: "user-1",
      email: "alex@example.com",
      name: "Alex",
    });
  });

  // P5 — the register (Create Account) email/password path is likewise unchanged.
  it("still registers via email/password unchanged when providers are enabled", async () => {
    setModes({ google: "on", apple: "on" });
    register.mockResolvedValue({
      user: { id: "user-2", email: "sam@example.com", name: "Sam" },
      needsEmailConfirmation: false,
    });
    const onSuccess = vi.fn();
    render(<AuthScreen onSuccess={onSuccess} onProviderSignIn={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await userEvent.type(screen.getByPlaceholderText(/john doe/i), "Sam");
    await userEvent.type(screen.getByPlaceholderText(/you@example.com/i), "sam@example.com");
    await userEvent.type(screen.getByPlaceholderText("••••••••"), "secret-password2");
    // Two buttons read "Create Account" in register mode (the tab and the form
    // submit); the submit is the one with type="submit".
    const submitAccount = screen
      .getAllByRole("button", { name: /create account/i })
      .find((button) => button.getAttribute("type") === "submit");
    await userEvent.click(submitAccount as HTMLElement);

    expect(register).toHaveBeenCalledWith("sam@example.com", "secret-password2", "Sam");
    expect(onSuccess).toHaveBeenCalledWith({
      id: "user-2",
      email: "sam@example.com",
      name: "Sam",
    });
  });

  // G5 — email/password remains available regardless of provider mode.
  it("keeps the email/password fields and tab toggle available in every mode", () => {
    setModes({ google: "off", apple: "off" });
    const { unmount } = render(<AuthScreen onSuccess={vi.fn()} />);
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    unmount();

    setModes({ google: "on", apple: "on" });
    render(<AuthScreen onSuccess={vi.fn()} />);
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /create account/i }).length,
    ).toBeGreaterThan(0);
  });
});
