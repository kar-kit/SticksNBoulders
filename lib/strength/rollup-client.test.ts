import { refreshRollup } from "./rollup-client";

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ account: { createJWT: async () => ({ jwt: "jwt" }) } }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("refreshRollup", () => {
  /**
   * The offline queue reads `code` to decide: a 5xx retries, a 4xx is marked
   * permanent so it stops blocking the sets queued behind it. Without the
   * status on the error every failure looks the same to the queue.
   */
  it.each([400, 503])("throws carrying the status %s for the queue to classify", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
    await expect(refreshRollup("squat", "2026-09-14T10:00:00.000Z")).rejects.toMatchObject({ code: status });
  });

  /** The route takes the athlete from the JWT; a body that named one could be forged. */
  it("never sends an athlete id", async () => {
    const fetchSpy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await refreshRollup("squat", "2026-09-14T10:00:00.000Z");
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ exerciseId: "squat", loggedAt: "2026-09-14T10:00:00.000Z" });
  });
});
