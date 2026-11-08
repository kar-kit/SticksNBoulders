import { DEFAULT_PUSH_PREFS, isP256dh, isPushAuth, isPushEndpoint, prefsOf, PUSH_ENDPOINT_MAX } from "./push";
import { POLICIES, pushSubscriptionPermissions } from "./policy";
import { expectedStamp, ownerProof, verdictFor } from "./provenance";

const P256DH = "B" + "A".repeat(86); // 87 characters, like a real 65-byte key
const AUTH = "a".repeat(22);

describe("isPushEndpoint (F27): where the server will POST", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGp1c2g",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ])("accepts a real push service: %s", (url) => {
    expect(isPushEndpoint(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://fcm.googleapis.com.evil.io/fcm/send/abc", // a suffix trick
    "https://evilfcm.googleapis.com/x", // not the host
    "https://user:pw@fcm.googleapis.com/x", // credentials
    "https://fcm.googleapis.com:8443/x", // a port
    "https://192.168.1.38/x", // the NAS
    "https://localhost/x",
    "https://appwrite.internal/v1/x",
    "not a url",
    "",
    `https://fcm.googleapis.com/${"a".repeat(PUSH_ENDPOINT_MAX)}`,
  ])("refuses anything else: %s", (url) => {
    expect(isPushEndpoint(url)).toBe(false);
  });

  it("refuses a non-string", () => {
    expect(isPushEndpoint(undefined)).toBe(false);
    expect(isPushEndpoint({ endpoint: "https://fcm.googleapis.com/x" })).toBe(false);
  });
});

describe("subscription keys", () => {
  it("accepts base64url of the right lengths only", () => {
    expect(isP256dh(P256DH)).toBe(true);
    expect(isPushAuth(AUTH)).toBe(true);
    expect(isP256dh("short")).toBe(false);
    expect(isPushAuth("a".repeat(40))).toBe(false);
    expect(isPushAuth("a".repeat(21) + "!")).toBe(false);
  });
});

describe("prefsOf", () => {
  it("reads a missing switch as on, like the column default", () => {
    expect(prefsOf({})).toEqual(DEFAULT_PUSH_PREFS);
    expect(prefsOf({ notify_clips: false })).toEqual({ clips: false, replies: true });
    expect(prefsOf({ notify_clips: true, notify_replies: false })).toEqual({ clips: true, replies: false });
  });
});

describe("push subscription policy", () => {
  it("is readable by its owner and nobody else, and writable by no session", () => {
    expect(pushSubscriptionPermissions({ userId: "coach_c" })).toEqual(['read("user:coach_c")']);
    expect(POLICIES.push_subscriptions({ userId: "coach_c" }).some((p) => /^(update|delete)/.test(p))).toBe(false);
  });

  it("refuses an empty owner", () => {
    expect(() => pushSubscriptionPermissions({ userId: "" })).toThrow();
  });

  it("is what the audit's stamp scan expects", () => {
    expect(expectedStamp("push_subscriptions", { user_id: "coach_c" })).toEqual(['read("user:coach_c")']);
    expect(expectedStamp("push_subscriptions", {})).toBeNull();
  });

  it("needs no authorship proof and is never judged by validate-row, being server-only", () => {
    expect(ownerProof("push_subscriptions", { user_id: "coach_c" })).toEqual([]);
    expect(verdictFor("push_subscriptions", { $id: "r", user_id: "coach_c", $permissions: ['read("users")'] }).action).toBe("skip");
  });
});
