import { signOut } from "./session";

const deleteSession = vi.hoisted(() => vi.fn());
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ account: { deleteSession } }),
}));
vi.mock("./circle", () => ({ forgetCircle: vi.fn() }));
vi.mock("@/lib/profile/profile-store", () => ({ forgetProfile: vi.fn() }));
vi.mock("@/lib/profile/avatar-cache", () => ({ forgetAvatars: vi.fn() }));
const detachQueue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/offline/client", () => ({ detachQueue }));

describe("signing out", () => {
  it("stops the offline queue sending as this athlete", async () => {
    // A shared phone: whatever this athlete left queued must not go out under
    // the next person's session. See client.test.ts › "a shared phone".
    deleteSession.mockResolvedValue({});
    await signOut();
    expect(detachQueue).toHaveBeenCalledTimes(1);
  });

  it("stops it even when the session cannot be deleted, as with no signal", async () => {
    deleteSession.mockRejectedValue(new TypeError("Failed to fetch"));
    detachQueue.mockClear();
    await signOut();
    expect(detachQueue).toHaveBeenCalledTimes(1);
  });
});
