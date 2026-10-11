import { uploadResumable } from "./resumable-upload";

/**
 * The transport against a fake Appwrite that keeps real upload state: which
 * chunks it holds, and what `getFile` reports as `chunksUploaded`. Each test
 * then breaks one thing about the wire -- a refusal, a 5xx, a drop, a lost
 * response -- and checks what the caller is told.
 *
 * Chunks are shrunk to 4 bytes so a 10-byte blob is three chunks (0-3, 4-7,
 * 8-9) and every boundary is visible in the content-range headers.
 */

vi.mock("./chunks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chunks")>()),
  CHUNK_BYTES: 4,
}));

vi.mock("@/appwrite/env", () => ({
  publicAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    databaseId: "sticksnboulders",
  }),
}));

const server = vi.hoisted(() => ({
  /** Distinct chunk starts the server holds, which is what Appwrite counts. */
  held: new Set<number>(),
  total: 0,
  /** Per-call override, by the 1-based number of the chunk POST. */
  script: new Map<
    number,
    | "refuse"
    | "expired"
    | "timeout"
    | "throttled"
    | "error"
    | "drop"
    | "lose-response"
    | "unreadable"
    | "unreadable-unheld"
  >(),
  posts: [] as string[],
  /** The JWT each chunk POST carried, in order. */
  jwts: [] as string[],
  jwtFails: false,
  /** Mints succeed up to this many calls, then the session is gone. */
  jwtMintsLeft: Infinity,
  jwtCalls: 0,
}));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    storage: {
      async getFile() {
        if (server.held.size === 0) throw Object.assign(new Error("not found"), { code: 404 });
        return { chunksUploaded: server.held.size };
      },
    },
    account: {
      async createJWT() {
        server.jwtCalls += 1;
        if (server.jwtFails || server.jwtCalls > server.jwtMintsLeft) throw new Error("no session");
        return { jwt: `jwt-${server.jwtCalls}` };
      },
    },
  }),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fakeFetch = vi.fn(async (_url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
  const range = headers["content-range"];
  server.posts.push(range);
  server.jwts.push(headers["x-appwrite-jwt"]);
  const [, start, , size] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!.map(Number);
  server.total = Math.ceil(size / 4);

  switch (server.script.get(server.posts.length)) {
    case "refuse":
      return json(400, { message: "File extension not allowed" });
    case "expired":
      // The JWT ran out partway through a long upload on slow wifi.
      return json(401, { message: "Failed to verify JWT. Expired token", type: "user_jwt_invalid" });
    case "timeout":
      return json(408, { message: "Request timeout" });
    case "throttled":
      return json(429, { message: "Rate limit for the current endpoint has been exceeded" });
    case "error":
      return json(503, { message: "Service unavailable" });
    case "drop":
      throw new TypeError("Failed to fetch");
    case "lose-response":
      // The bytes landed; the connection died before the answer came back.
      server.held.add(start);
      throw new TypeError("Failed to fetch");
    case "unreadable":
      // A 200 whose body never arrived intact: the server may or may not
      // have finished, and the response cannot say which.
      server.held.add(start);
      return new Response("<truncated", { status: 200 });
    case "unreadable-unheld":
      // The same unreadable 200, but the chunk did not actually land.
      return new Response("<truncated", { status: 200 });
  }
  server.held.add(start);
  return json(201, { chunksUploaded: server.held.size, chunksTotal: server.total });
});

const blob = () => new Blob(["0123456789"]);
const target = { fileId: "file-1", athleteId: "joey", name: "clip.mp4" };

beforeEach(() => {
  server.held = new Set();
  server.total = 0;
  server.script = new Map();
  server.posts = [];
  server.jwts = [];
  server.jwtFails = false;
  server.jwtMintsLeft = Infinity;
  server.jwtCalls = 0;
  fakeFetch.mockClear();
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a clean upload", () => {
  it("sends every chunk in order at its absolute offset, and finishes", async () => {
    const progress: number[] = [];
    const result = await uploadResumable(blob(), target, { onProgress: (p) => progress.push(p) });

    expect(result).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual(["bytes 0-3/10", "bytes 4-7/10", "bytes 8-9/10"]);
    expect(progress).toEqual([0, 33, 67, 100]);
    // One JWT for the attempt, not one per chunk.
    expect(server.jwtCalls).toBe(1);
  });
});

describe("when the server says no", () => {
  /**
   * A 4xx is a decision, not a fault: wrong type, too big. (Not an expired
   * session, and not a timeout or a rate limit -- those are below.)
   * Reported as permanent so the caller drops it instead of re-sending the
   * same refused bytes on every app start until the attempt cap.
   */
  it("reports a 4xx as permanent and stops sending", async () => {
    server.script.set(2, "refuse");
    const result = await uploadResumable(blob(), target);

    expect(result).toEqual({
      ok: false,
      retryable: false,
      message: "File extension not allowed",
      uploadedCount: 1,
    });
    expect(server.posts).toHaveLength(2);
  });
});

describe("when the session runs out partway through", () => {
  /**
   * A JWT lasts 15 minutes and a 150MB clip on gym wifi can take longer. The
   * 401 is the token's age, not a verdict on the file, so the transport mints
   * one fresh JWT and carries on from the chunk that was refused.
   */
  it("mints one fresh JWT and resends the refused chunk, then finishes", async () => {
    server.script.set(2, "expired");
    const result = await uploadResumable(blob(), target);

    expect(result).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual(["bytes 0-3/10", "bytes 4-7/10", "bytes 4-7/10", "bytes 8-9/10"]);
    expect(server.jwts).toEqual(["jwt-1", "jwt-1", "jwt-2", "jwt-2"]);
    expect(server.jwtCalls).toBe(2);
  });

  it("keeps the upload resumable when the session itself is gone", async () => {
    server.script.set(2, "expired");
    server.jwtMintsLeft = 1;
    const result = await uploadResumable(blob(), target);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      authExpired: true,
      message: "Not signed in",
      uploadedCount: 1,
    });
    expect(server.posts).toHaveLength(2);
  });

  it("refreshes once, not in a loop, when the fresh JWT is refused too", async () => {
    server.script.set(2, "expired");
    server.script.set(3, "expired");
    const result = await uploadResumable(blob(), target);

    expect(result).toMatchObject({ ok: false, retryable: true, authExpired: true, uploadedCount: 1 });
    expect(server.jwtCalls).toBe(2);
    expect(server.posts).toHaveLength(3);
  });

  it("refreshes once per attempt, not once per chunk", async () => {
    server.script.set(2, "expired");
    server.script.set(4, "expired");
    const result = await uploadResumable(blob(), target);

    expect(result).toMatchObject({ ok: false, retryable: true, authExpired: true, uploadedCount: 2 });
    expect(server.jwtCalls).toBe(2);
  });

  it("can be resumed after signing back in, from the chunk it stopped at", async () => {
    server.script.set(2, "expired");
    server.jwtMintsLeft = 1;
    await uploadResumable(blob(), target);
    server.posts = [];
    server.script = new Map();
    server.jwtMintsLeft = Infinity;

    expect(await uploadResumable(blob(), target)).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual(["bytes 4-7/10", "bytes 8-9/10"]);
  });
});

describe("when the server or the connection fails", () => {
  it.each(["timeout", "throttled"] as const)("reports a %s (408, 429) as worth another go, not as a refusal", async (kind) => {
    server.script.set(2, kind);
    const result = await uploadResumable(blob(), target);

    expect(result).toMatchObject({ ok: false, retryable: true, uploadedCount: 1 });
    expect(result).not.toHaveProperty("authExpired");
  });

  it("reports a 5xx as worth another go, with what the server confirmed", async () => {
    server.script.set(2, "error");
    const result = await uploadResumable(blob(), target);

    expect(result).toMatchObject({ ok: false, retryable: true, uploadedCount: 1 });
    expect(server.posts).toHaveLength(2);
  });

  it("reports a dropped connection as worth another go", async () => {
    server.script.set(3, "drop");
    const result = await uploadResumable(blob(), target);

    expect(result).toMatchObject({ ok: false, retryable: true, uploadedCount: 2 });
  });

  it("reports a missing session as worth another go, before sending anything", async () => {
    server.jwtFails = true;
    expect(await uploadResumable(blob(), target)).toMatchObject({
      ok: false,
      retryable: true,
      authExpired: true,
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe("resuming", () => {
  /**
   * The reason the module exists: a drop costs the remaining chunks, not the
   * file. The second call asks the server where it got to.
   */
  it("starts from what the server already holds", async () => {
    server.script.set(3, "drop");
    await uploadResumable(blob(), target);
    server.posts = [];

    const result = await uploadResumable(blob(), target);
    expect(result).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual(["bytes 8-9/10"]);
  });

  it("sends nothing at all when the server already has every chunk", async () => {
    await uploadResumable(blob(), target);
    server.posts = [];

    // The final getFile is what says done; nothing is re-sent to find out.
    expect(await uploadResumable(blob(), target)).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual([]);
  });

  it("re-sends a chunk whose response was lost, rather than skipping it", async () => {
    server.script.set(2, "lose-response");
    expect(await uploadResumable(blob(), target)).toMatchObject({ ok: false, retryable: true });
    server.posts = [];

    // The server holds chunks 0 and 1, so the resume point is chunk 2.
    expect(await uploadResumable(blob(), target)).toEqual({ ok: true, fileId: "file-1" });
    expect(server.posts).toEqual(["bytes 8-9/10"]);
  });
});

describe("a final response that cannot be read", () => {
  /**
   * Every chunk went out, but the last answer was unreadable. Success is what
   * the server says, not what the loop assumes -- otherwise an incomplete
   * file is recorded on the set and the coach gets a broken player.
   */
  it("is success only when the server confirms it holds every chunk", async () => {
    server.script.set(3, "unreadable");
    expect(await uploadResumable(blob(), target)).toEqual({ ok: true, fileId: "file-1" });
  });

  it("is a retryable failure when the server does not", async () => {
    server.script.set(3, "unreadable-unheld");
    expect(await uploadResumable(blob(), target)).toEqual({
      ok: false,
      retryable: true,
      message: "Upload did not finish",
      uploadedCount: 2,
    });
  });
});
