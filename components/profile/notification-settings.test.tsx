import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PushAvailability } from "@/lib/push/availability";

const store = vi.hoisted(() => ({
  availability: { kind: "ready", permission: "default" } as PushAvailability,
  subscription: null as { endpoint: string } | null,
  endpoints: [] as string[],
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  savePushPrefs: vi.fn(),
  sendTestPush: vi.fn(),
}));

vi.mock("@/lib/push/push-store", () => ({
  detectPushAvailability: () => store.availability,
  currentSubscription: async () => store.subscription,
  readMyPushPrefs: async () => ({ prefs: { clips: true, replies: true }, endpoints: store.endpoints }),
  enablePush: store.enablePush,
  disablePush: store.disablePush,
  savePushPrefs: store.savePushPrefs,
  sendTestPush: store.sendTestPush,
}));

const { NotificationSettings } = await import("./notification-settings");

beforeEach(() => {
  store.availability = { kind: "ready", permission: "default" };
  store.subscription = null;
  store.endpoints = [];
  for (const fn of [store.enablePush, store.disablePush, store.savePushPrefs, store.sendTestPush]) fn.mockReset();
});

describe("NotificationSettings (F27)", () => {
  it("on an iPhone in Safari, shows how to install instead of a button that cannot work", async () => {
    store.availability = { kind: "ios-install" };
    render(<NotificationSettings userId="coach_c" />);
    expect(await screen.findByText(/only work from the Home Screen app/)).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.getByText(/iOS 16.4/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never asks for permission until the coach taps", async () => {
    render(<NotificationSettings userId="coach_c" />);
    const button = await screen.findByRole("button", { name: "Turn on notifications" });
    expect(store.enablePush).not.toHaveBeenCalled();
    store.enablePush.mockResolvedValue({ status: "on", prefs: { clips: true, replies: true } });
    await userEvent.click(button);
    expect(store.enablePush).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("switch", { name: /New clips/ })).toBeChecked();
    expect(screen.getByRole("switch", { name: /Athlete replies/ })).toBeChecked();
  });

  it("shows the switches, the test and the way off for a device that is on", async () => {
    store.availability = { kind: "ready", permission: "granted" };
    store.subscription = { endpoint: "https://fcm.googleapis.com/x" };
    store.endpoints = ["https://fcm.googleapis.com/x"];
    store.savePushPrefs.mockResolvedValue(undefined);
    store.sendTestPush.mockResolvedValue({ delivered: 1, devices: 1 });
    render(<NotificationSettings userId="coach_c" />);

    const clips = await screen.findByRole("switch", { name: /New clips/ });
    await userEvent.click(clips);
    expect(store.savePushPrefs).toHaveBeenCalledWith({ clips: false, replies: true });
    expect(clips).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Sent/);

    store.disablePush.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Turn off on this device" }));
    expect(store.disablePush).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
  });

  it("puts a switch back when saving it fails", async () => {
    store.availability = { kind: "ready", permission: "granted" };
    store.subscription = { endpoint: "e" };
    store.endpoints = ["e"];
    store.savePushPrefs.mockRejectedValue(new Error("offline"));
    render(<NotificationSettings userId="coach_c" />);
    const replies = await screen.findByRole("switch", { name: /Athlete replies/ });
    await userEvent.click(replies);
    await waitFor(() => expect(replies).toBeChecked());
    expect(screen.getByRole("status")).toHaveTextContent(/Couldn’t save/);
  });

  it("treats a subscription the server no longer knows as off", async () => {
    store.availability = { kind: "ready", permission: "granted" };
    store.subscription = { endpoint: "e" };
    store.endpoints = [];
    render(<NotificationSettings userId="coach_c" />);
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
  });

  it("explains a block rather than offering a button the browser will ignore", async () => {
    store.availability = { kind: "denied" };
    render(<NotificationSettings userId="coach_c" />);
    expect(await screen.findByText(/blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the deployment has no keys", async () => {
    store.availability = { kind: "unconfigured" };
    render(<NotificationSettings userId="coach_c" />);
    expect(await screen.findByText(/aren’t set up/)).toBeInTheDocument();
  });
});
