import { fetchClipUrls } from "./queue-store";

/**
 * What `fetchClipUrls` puts on the wire (v22). The server half is
 * app/api/clip/route.test.ts; this pins that a screen with no proxies sends
 * exactly the body it sent before, and one with proxies says which.
 */
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", account: { createJWT: async () => ({ jwt: "jwt-1" }) } }),
}));

const sent: unknown[] = [];
beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { fileIds: string[] };
      sent.push(body);
      return Response.json({ urls: Object.fromEntries(body.fileIds.map((id) => [id, `/api/clip/${id}?t=x`])) });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchClipUrls", () => {
  it("sends bare ids exactly as before proxies existed", async () => {
    await fetchClipUrls(["a", "b", "a", ""]);
    expect(sent).toEqual([{ fileIds: ["a", "b"] }]);
  });

  it("sends the proxies the rows name, and keys the answer by clip id", async () => {
    const urls = await fetchClipUrls([{ fileId: "a", proxyId: "a_proxy" }, { fileId: "b", proxyId: null }, "c"]);
    expect(sent).toEqual([{ fileIds: ["a", "b", "c"], proxies: { a: "a_proxy" } }]);
    expect([...urls.keys()]).toEqual(["a", "b", "c"]);
  });

  it("asks nothing for nothing", async () => {
    expect((await fetchClipUrls([])).size).toBe(0);
    expect(sent).toEqual([]);
  });
});
