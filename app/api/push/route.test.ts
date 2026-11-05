// @vitest-environment node
import { pushSubscriptionPermissions } from "@/appwrite/documents/policy";
import { appwrite, jwtFor, resetAppwrite, routeRequest } from "../route-test-kit";

/**
 * F27's device routes. The route, push-admin and the write helper are real;
 * only node-appwrite and web-push are replaced. Who a device belongs to must
 * come from the token alone, because a row here decides whose notifications
 * land on whose lock screen.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification } }));

const { POST, PATCH, DELETE } = await import("./route");
const { POST: TEST } = await import("./test/route");
const { pushRowId } = await import("@/appwrite/documents/push-admin");

const COACH = "coach_ruairi";
const OTHER = "coach_louis";
const ENDPOINT = "https://web.push.apple.com/QGp1c2g-device-1";
const KEYS = { p256dh: "B" + "A".repeat(86), auth: "a".repeat(22) };
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const subscribeAs = (user: string, body: unknown = { subscription: { endpoint: ENDPOINT, keys: KEYS } }) => {
  const request = routeRequest("/api/push", { jwt: jwtFor(user), body });
  request.headers.set("user-agent", IPHONE);
  return POST(request);
};
const rows = () => appwrite.tables.push_subscriptions ?? [];

beforeEach(() => {
  resetAppwrite();
  appwrite.tables.push_subscriptions = [];
  sendNotification.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/push", () => {
  it("401 with no token, storing nothing", async () => {
    expect((await POST(routeRequest("/api/push", { body: { subscription: { endpoint: ENDPOINT, keys: KEYS } } }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("registers the device to the caller, readable by them alone", async () => {
    const response = await subscribeAs(COACH);
    expect(response.status).toBe(200);
    const [row] = rows();
    expect(row).toMatchObject({
      $id: pushRowId(ENDPOINT).rowId,
      user_id: COACH,
      endpoint: ENDPOINT,
      endpoint_hash: pushRowId(ENDPOINT).hash,
      label: "iPhone",
      notify_clips: true,
      notify_replies: true,
    });
    expect(row.$permissions).toEqual(pushSubscriptionPermissions({ userId: COACH }));
    expect(appwrite.keylessCalls).toEqual([]);
  });

  it("ignores a user id in the body", async () => {
    await subscribeAs(COACH, { subscription: { endpoint: ENDPOINT, keys: KEYS }, userId: OTHER, user_id: OTHER });
    expect(rows()[0].user_id).toBe(COACH);
  });

  it("keeps one row per device however often it subscribes", async () => {
    await subscribeAs(COACH);
    await subscribeAs(COACH, { subscription: { endpoint: ENDPOINT, keys: { ...KEYS, auth: "b".repeat(22) } } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].auth).toBe("b".repeat(22));
  });

  it("hands a device over when somebody else signs in on it", async () => {
    await subscribeAs(OTHER);
    await subscribeAs(COACH);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].user_id).toBe(COACH);
    expect(rows()[0].$permissions).toEqual(pushSubscriptionPermissions({ userId: COACH }));
  });

  it("gives a new device the switches the coach already chose", async () => {
    await subscribeAs(COACH, { subscription: { endpoint: ENDPOINT, keys: KEYS }, prefs: { clips: true, replies: false } });
    await subscribeAs(COACH, { subscription: { endpoint: `${ENDPOINT}-laptop`, keys: KEYS } });
    expect(rows().map((r) => r.notify_replies)).toEqual([false, false]);
  });

  it.each([
    ["an endpoint on no push service", { subscription: { endpoint: "https://192.168.1.38/hook", keys: KEYS } }],
    ["plain http", { subscription: { endpoint: "http://fcm.googleapis.com/fcm/send/x", keys: KEYS } }],
    ["bad keys", { subscription: { endpoint: ENDPOINT, keys: { p256dh: "x", auth: "y" } } }],
    ["no subscription", {}],
  ])("400 for %s, storing nothing", async (_label, body) => {
    expect((await subscribeAs(COACH, body)).status).toBe(400);
    expect(rows()).toEqual([]);
  });
});

describe("PATCH /api/push", () => {
  it("sets the switches on every device the caller has, and no one else's", async () => {
    await subscribeAs(COACH);
    await subscribeAs(COACH, { subscription: { endpoint: `${ENDPOINT}-2`, keys: KEYS } });
    await subscribeAs(OTHER, { subscription: { endpoint: `${ENDPOINT}-other`, keys: KEYS } });
    const response = await PATCH(routeRequest("/api/push", { method: "PATCH", jwt: jwtFor(COACH), body: { prefs: { clips: false, replies: true } } }));
    expect(await response.json()).toMatchObject({ status: "saved", devices: 2 });
    expect(rows().filter((r) => r.user_id === COACH).every((r) => r.notify_clips === false)).toBe(true);
    expect(rows().find((r) => r.user_id === OTHER)!.notify_clips).toBe(true);
  });

  it("400 for a malformed switch", async () => {
    const response = await PATCH(routeRequest("/api/push", { method: "PATCH", jwt: jwtFor(COACH), body: { prefs: { clips: "yes" } } }));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/push", () => {
  it("removes the caller's device", async () => {
    await subscribeAs(COACH);
    const response = await DELETE(routeRequest("/api/push", { method: "DELETE", jwt: jwtFor(COACH), body: { endpoint: ENDPOINT } }));
    expect(await response.json()).toEqual({ status: "removed" });
    expect(rows()).toEqual([]);
  });

  it("will not remove somebody else's", async () => {
    await subscribeAs(OTHER);
    const response = await DELETE(routeRequest("/api/push", { method: "DELETE", jwt: jwtFor(COACH), body: { endpoint: ENDPOINT } }));
    expect(await response.json()).toEqual({ status: "absent" });
    expect(rows()).toHaveLength(1);
  });
});

describe("POST /api/push/test", () => {
  const vapid = () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    vi.stubEnv("VAPID_SUBJECT", "mailto:coach@example.com");
  };

  it("503 when the deployment has no VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect((await TEST(routeRequest("/api/push/test", { jwt: jwtFor(COACH), body: {} }))).status).toBe(503);
  });

  it("sends to each of the caller's devices and removes one the push service says is gone", async () => {
    vapid();
    await subscribeAs(COACH);
    await subscribeAs(COACH, { subscription: { endpoint: `${ENDPOINT}-dead`, keys: KEYS } });
    await subscribeAs(OTHER, { subscription: { endpoint: `${ENDPOINT}-other`, keys: KEYS } });
    sendNotification.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      if (endpoint.endsWith("-dead")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const response = await TEST(routeRequest("/api/push/test", { jwt: jwtFor(COACH), body: {} }));
    expect(await response.json()).toMatchObject({ delivered: 1, removed: 1, devices: 2 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, payload, options] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toMatchObject({ kind: "test", url: "/me" });
    expect(options.vapidDetails).toEqual({ subject: "mailto:coach@example.com", publicKey: "public", privateKey: "private" });
    expect(rows().map((r) => r.endpoint).sort()).toEqual([ENDPOINT, `${ENDPOINT}-other`].sort());
  });
});
