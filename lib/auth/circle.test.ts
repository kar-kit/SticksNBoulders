import { ensureMyCircle, forgetCircle } from "./circle";

const createJWT = vi.hoisted(() => vi.fn(async () => ({ jwt: "token-123" })));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ account: { createJWT } }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  forgetCircle();
  createJWT.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("preparing an account before its first write", () => {
  it("proves who is asking with a JWT, never with an id in the body", async () => {
    // The server takes the user id from the token. Accepting one from the
    // caller would let anyone create, or join, somebody else's circle.
    fetchMock.mockResolvedValue({ ok: true });
    await ensureMyCircle();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/circle");
    expect(init.headers.Authorization).toBe("Bearer token-123");
    expect(init.body).toBeUndefined();
  });

  it("costs one request even when several writes ask at once", async () => {
    // Starting a session and creating an exercise in the same breath is one
    // round trip, not two.
    fetchMock.mockResolvedValue({ ok: true });
    await Promise.all([ensureMyCircle(), ensureMyCircle(), ensureMyCircle()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so one bad moment does not block the page", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(ensureMyCircle()).rejects.toThrow(/Could not prepare your account/);

    fetchMock.mockResolvedValueOnce({ ok: true });
    await expect(ensureMyCircle()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails loudly rather than letting the write go on to be rejected", async () => {
    // A silent failure here surfaces as a 401 on the athlete's first set, which
    // is the least useful place for it to appear.
    createJWT.mockRejectedValueOnce(new Error("no session"));
    await expect(ensureMyCircle()).rejects.toThrow();
  });
});
