import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderMode } = vi.hoisted(() => ({
  getProviderMode: vi.fn(),
}));

vi.mock("../services/oauthProviderFlagsService", () => ({
  getProviderMode,
}));

import UserProfileModal from "./UserProfileModal";

const connectedMethods = [
  { identityId: "google-1", provider: "google" },
  { identityId: "apple-1", provider: "apple" },
];

const createProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  profile: null,
  milestones: [],
  email: "alex@example.com",
  name: "Alex",
  hasCurrentPlan: false,
  planMutationsDisabled: false,
  onUpdateProfile: vi.fn(),
  onAddMilestone: vi.fn(),
  onDeleteMilestone: vi.fn(),
  onChangePassword: vi.fn(),
  onSetPassword: vi.fn(),
  onGetConnectedSignInMethods: vi.fn().mockResolvedValue(connectedMethods),
  onDisconnectSignInMethod: vi.fn(),
  onSendRecovery: vi.fn(),
  onStartOver: vi.fn(),
  onLogout: vi.fn(),
});

describe("UserProfileModal Account Security", () => {
  beforeEach(() => {
    getProviderMode.mockReset().mockReturnValue("on");
  });

  it("lists connected methods from identities and marks a disabled provider unavailable", async () => {
    getProviderMode.mockImplementation((provider: string) =>
      provider === "google" ? "off" : "on",
    );
    const props = createProps();
    const user = userEvent.setup();
    render(<UserProfileModal {...props} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));

    const methods = await screen.findByRole("list", {
      name: "Connected sign-in methods",
    });
    expect(within(methods).getByText("Google")).toBeInTheDocument();
    expect(within(methods).getByText("Apple")).toBeInTheDocument();
    expect(within(methods).getByText("Sign-in temporarily unavailable"))
      .toBeInTheDocument();
    expect(within(methods).queryByText("alex@example.com")).not.toBeInTheDocument();
    await waitFor(() => expect(props.onGetConnectedSignInMethods).toHaveBeenCalledOnce());
    expect(props.onDisconnectSignInMethod).not.toHaveBeenCalled();
  });

  it("sets a password for an OAuth-only account and switches to change-password", async () => {
    const props = createProps();
    props.onGetConnectedSignInMethods
      .mockResolvedValueOnce([{ identityId: "google-1", provider: "google" }]);
    props.onSetPassword.mockResolvedValue([
      { identityId: "google-1", provider: "google" },
      { identityId: "email-1", provider: "email" },
    ]);
    const user = userEvent.setup();
    render(<UserProfileModal {...props} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));
    await screen.findByText("Google");
    expect(screen.queryByLabelText(/^Current password/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^New password/), "new-secret2");
    await user.type(screen.getByLabelText("Confirm new password"), "new-secret2");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => expect(props.onSetPassword).toHaveBeenCalledWith("new-secret2"));
    expect(await screen.findByText("Email/password")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Current password/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password set. Your session remains active.",
    );
    expect(props.onGetConnectedSignInMethods).toHaveBeenCalledOnce();
  });

  it("keeps Change Password available when connected methods cannot be loaded", async () => {
    const props = createProps();
    props.onGetConnectedSignInMethods.mockRejectedValue(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<UserProfileModal {...props} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connected sign-in methods could not be loaded.",
    );
    expect(screen.getByLabelText(/^Current password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connected methods" }))
      .toBeInTheDocument();
  });

  it("blocks disconnecting the only sign-in method when no password exists", async () => {
    const props = createProps();
    props.onGetConnectedSignInMethods.mockResolvedValue([
      { identityId: "google-1", provider: "google" },
    ]);
    const user = userEvent.setup();
    render(<UserProfileModal {...props} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));
    await screen.findByText("Google");
    await user.click(screen.getByRole("button", { name: "Disconnect Google" }));

    expect(props.onDisconnectSignInMethod).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add a password or another sign-in method before disconnecting your only sign-in method.",
    );
  });

  it("disconnects a selected method when another sign-in method remains", async () => {
    const props = createProps();
    props.onGetConnectedSignInMethods
      .mockResolvedValueOnce([
        { identityId: "google-1", provider: "google" },
        { identityId: "email-1", provider: "email" },
      ])
      .mockResolvedValueOnce([
        { identityId: "email-1", provider: "email" },
      ]);
    props.onDisconnectSignInMethod.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<UserProfileModal {...props} />);

    await user.click(screen.getByRole("tab", { name: "Security" }));
    await screen.findByText("Google");
    await user.click(screen.getByRole("button", { name: "Disconnect Google" }));

    await waitFor(() => expect(props.onDisconnectSignInMethod).toHaveBeenCalledWith("google-1"));
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.getByText("Email/password")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Google disconnected.");
  });
});
