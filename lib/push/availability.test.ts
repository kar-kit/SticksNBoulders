import { applicationServerKey, pushAvailability, type PushEnv } from "./availability";

const ready: PushEnv = {
  publicKey: "BPub",
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  ios: false,
  standalone: false,
  permission: "default",
};

describe("pushAvailability", () => {
  it("is ready on a desktop browser with the Push API", () => {
    expect(pushAvailability(ready)).toEqual({ kind: "ready", permission: "default" });
  });

  it("asks an iPhone in a Safari tab to install, rather than calling it unsupported", () => {
    // Safari hides PushManager until the site is a Home Screen app.
    expect(pushAvailability({ ...ready, ios: true, standalone: false, hasPushManager: false })).toEqual({ kind: "ios-install" });
  });

  it("is ready on an installed iPhone app with the Push API (iOS 16.4+)", () => {
    expect(pushAvailability({ ...ready, ios: true, standalone: true })).toMatchObject({ kind: "ready" });
  });

  it("calls an installed iPhone app without the Push API too old", () => {
    expect(pushAvailability({ ...ready, ios: true, standalone: true, hasPushManager: false })).toEqual({ kind: "unsupported", ios: true });
  });

  it("is unsupported without a service worker or notifications", () => {
    expect(pushAvailability({ ...ready, hasServiceWorker: false }).kind).toBe("unsupported");
    expect(pushAvailability({ ...ready, hasNotification: false }).kind).toBe("unsupported");
  });

  it("says blocked when the coach said no, which only settings can undo", () => {
    expect(pushAvailability({ ...ready, permission: "denied" })).toEqual({ kind: "denied" });
  });

  it("says not set up before anything else when the deployment has no key", () => {
    expect(pushAvailability({ ...ready, publicKey: "", ios: true })).toEqual({ kind: "unconfigured" });
  });
});

describe("applicationServerKey", () => {
  it("decodes base64url, padding and all", () => {
    expect([...applicationServerKey("AQID")]).toEqual([1, 2, 3]);
    expect([...applicationServerKey("-_8")]).toEqual([251, 255]);
  });
});
