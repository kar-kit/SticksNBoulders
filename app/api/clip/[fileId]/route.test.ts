// @vitest-environment node
import { clipJwts, JWT_REUSE_MS } from "@/lib/video/clip-jwt";
import { mintTicket, TICKET_TTL_MS } from "@/lib/video/ticket";

/**
 * The stream route with Appwrite replaced at its two edges: the admin call
 * that mints a JWT for the ticket's user, and the storage fetch made as them.
 * Tickets are minted for real, so these test what a URL actually opens.
 */

const SECRET = "a-test-secret-that-is-long-enough-to-pass";
const COACH = "coach_ruairi";
const ATHLETE = "athlete_joey";

/**
 * Every mint is a distinct JWT, `jwt-for-<user>.<n>`, so a test can tell a
 * reused JWT from a fresh one, and `refused` holds JWTs Appwrite has stopped
 * accepting (a deleted session).
 */
const appwrite = vi.hoisted(() => ({
  jwtFails: false,
  jwtFor: [] as string[],
  mints: 0,
  refused: new Set<string>(),
}));

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  class Users {
    async createJWT({ userId }: { userId: string }) {
      if (appwrite.jwtFails) throw new Error("user not found");
      appwrite.jwtFor.push(userId);
      appwrite.mints += 1;
      return { jwt: `jwt-for-${userId}.${appwrite.mints}` };
    }
  }
  return { ...actual, Users };
});

/** The user a JWT was minted for. */
const userOf = (jwt: string | undefined) => /^jwt-for-(.+)\.\d+$/.exec(jwt ?? "")?.[1];

/** The admin-key client. Spied, so a test can say when the key came into play. */
const createServerClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@/appwrite/server-client", () => ({ createServerClient }));

vi.mock("@/appwrite/env", () => ({
  serverAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    apiKey: "k",
    databaseId: "sticksnboulders",
  }),
}));

/**
 * Storage with permissions, the way Appwrite has them: the API key reads
 * every file, a user's JWT reads only the files that user may read, and
 * anything else is refused. A fake that serves any file to anyone cannot tell
 * "asked as the user" from "asked as the admin", which is the difference that
 * matters here (test audit C07).
 */
const OTHER_ATHLETES_CLIP = "clip-not-yours";
const readers: Record<string, string[]> = {
  "clip-a": [COACH, ATHLETE],
  "clip-b": [COACH],
  [OTHER_ATHLETES_CLIP]: ["athlete_somebody_else"],
  // v22: a proxy carries its clip's readers.
  "clip-a_proxy": [COACH],
  [`${OTHER_ATHLETES_CLIP}_proxy`]: ["athlete_somebody_else"],
};
/** Files that do not exist, as `bucket/id`. */
const absent = new Set<string>();

/**
 * The `mimeType` Appwrite stored, as `bucket/id`. Anything not listed comes
 * back `video/mp4`. The live bucket has `video/quicktime`,
 * `application/SIMH-tape-data` and `''` (2 Nov 2026).
 */
const storedType = new Map<string, string>();

const storage = vi.fn(async (url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
  const [, bucketId, rawId] = /\/buckets\/([^/]+)\/files\/([^/]+)\/view$/.exec(url)!;
  const fileId = decodeURIComponent(rawId);
  const asAdmin = Object.keys(headers).some((name) => name.toLowerCase() === "x-appwrite-key");
  const jwt = headers["x-appwrite-jwt"];
  const jwtUser = jwt && !appwrite.refused.has(jwt) ? userOf(jwt) : undefined;

  if (!asAdmin && !jwtUser) {
    return Response.json({ message: "missing scope", type: "user_unauthorized" }, { status: 401 });
  }
  // After the JWT check, as in Appwrite: a refused JWT is a 401 before the
  // file is ever looked up.
  if (absent.has(`${bucketId}/${fileId}`)) {
    return Response.json({ message: "The requested file could not be found.", type: "storage_file_not_found" }, { status: 404 });
  }
  if (!asAdmin && !(readers[fileId] ?? []).includes(jwtUser!)) {
    return Response.json(
      { message: "The requested file could not be found.", type: "storage_file_not_found" },
      { status: 404 },
    );
  }
  return new Response("video-bytes", {
    status: headers.range ? 206 : 200,
    headers: {
      "content-type": storedType.get(`${bucketId}/${fileId}`) ?? "video/mp4",
      "accept-ranges": "bytes",
      ...(headers.range ? { "content-range": "bytes 0-10/1000" } : {}),
    },
  });
});

const { GET } = await import("./route");

const ticket = (fileId: string, expiresAt = Date.now() + TICKET_TTL_MS, userId = COACH) =>
  mintTicket({ fileId, userId, expiresAt }, SECRET);

const get = (fileId: string, token: string | null, range?: string) =>
  GET(
    new Request(`http://localhost/api/clip/${fileId}${token === null ? "" : `?t=${encodeURIComponent(token)}`}`, {
      headers: range ? { range } : {},
    }),
    { params: Promise.resolve({ fileId }) },
  );

/** The JWT the storage read at `index` was made with. */
const jwtSent = (index: number) => (storage.mock.calls[index][1].headers as Record<string, string>)["x-appwrite-jwt"];

beforeEach(() => {
  absent.clear();
  storedType.clear();
  // One module instance across every test: without this, a JWT minted in one
  // test is reused in the next and every "minted once" assertion lies.
  clipJwts.clear();
  appwrite.jwtFails = false;
  appwrite.jwtFor = [];
  appwrite.mints = 0;
  appwrite.refused.clear();
  storage.mockClear();
  createServerClient.mockClear();
  vi.stubGlobal("fetch", storage);
  vi.stubEnv("VIDEO_TICKET_SECRET", SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/clip/[fileId] — a good ticket", () => {
  it("streams the file as the ticket's user, forwarding the range", async () => {
    const response = await get("clip-a", ticket("clip-a"), "bytes=0-10");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-10/1000");
    expect(await response.text()).toBe("video-bytes");
    expect(appwrite.jwtFor).toEqual([COACH]);

    const [url, init] = storage.mock.calls[0];
    expect(url).toBe("https://appwrite.test/v1/storage/buckets/set_videos/files/clip-a/view");
    expect(init.headers).toMatchObject({ "x-appwrite-jwt": `jwt-for-${COACH}.1`, range: "bytes=0-10" });
  });

  /**
   * The admin key mints the user's JWT and nothing else. Sent on the storage
   * read as well, the route stops being a pipe and becomes a gate-less admin
   * read: any ticket would stream any file. Exact equality, because
   * `toMatchObject` above ignores an extra header.
   */
  it("asks Appwrite as the user and never with the API key", async () => {
    await get("clip-a", ticket("clip-a"), "bytes=0-10");

    const headers = storage.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("x-appwrite-key");
    expect(headers).toEqual({
      "x-appwrite-project": "p",
      "x-appwrite-jwt": `jwt-for-${COACH}.1`,
      "accept-encoding": "identity",
      range: "bytes=0-10",
    });
  });

  it("is never cached and never sniffed", async () => {
    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("forwards only the range, type and length headers", async () => {
    storage.mockImplementationOnce(
      async () =>
        new Response("video-bytes", {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": "11",
            "set-cookie": "a_session_p=secret",
            "x-appwrite-session": "secret",
          },
        }),
    );

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-appwrite-session")).toBeNull();
  });
});

describe("GET /api/clip/[fileId] — a good ticket for a clip its holder may not read", () => {
  /**
   * `/api/clip` mints a ticket for any file id a signed-in user names, so a
   * valid ticket is no evidence of access. What stops it is that the bytes
   * are fetched as the ticket's user and Appwrite refuses them.
   */
  it("streams nothing, and says no more than 404", async () => {
    const response = await get(OTHER_ATHLETES_CLIP, ticket(OTHER_ATHLETES_CLIP));

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("video-bytes");
    expect(body).not.toContain("storage_file_not_found");
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("answers 404 with no upstream body when Appwrite refuses the JWT", async () => {
    storage.mockImplementationOnce(async () =>
      Response.json({ message: "Invalid token", type: "user_unauthorized" }, { status: 401 }),
    );

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("user_unauthorized");
  });
});

describe("GET /api/clip/[fileId] — a ticket that does not open this file", () => {
  /**
   * The ticket names one file. Without the comparison, one ticket for clip A
   * would open every clip in the bucket the holder can read, by editing the
   * path -- including ones never minted for them.
   */
  it("refuses a ticket for file A on the path of file B, without fetching anything", async () => {
    const response = await get("clip-b", ticket("clip-a"));

    expect(response.status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
    expect(appwrite.jwtFor).toEqual([]);
  });

  it("refuses an expired ticket", async () => {
    const response = await get("clip-a", ticket("clip-a", Date.now() - 1));
    expect(response.status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a request with no ticket", async () => {
    expect((await get("clip-a", null)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a ticket signed with another secret", async () => {
    const forged = mintTicket(
      { fileId: "clip-a", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS },
      "a-different-secret-also-long-enough-here",
    );
    expect((await get("clip-a", forged)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a ticket whose payload was edited to name another file", async () => {
    const [, signature] = ticket("clip-a").split(".");
    const payload = Buffer.from(
      JSON.stringify({ fileId: "clip-b", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS }),
    ).toString("base64url");

    expect((await get("clip-b", `${payload}.${signature}`)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  /**
   * The admin key comes into play only once the ticket has been verified for
   * the file on the path. A refused ticket costs nothing privileged: no admin
   * client, no JWT minted for anyone.
   */
  it.each([
    ["no ticket", () => get("clip-a", null)],
    ["an expired ticket", () => get("clip-a", ticket("clip-a", Date.now() - 1))],
    ["a ticket for another file", () => get("clip-b", ticket("clip-a"))],
    [
      "a forged ticket",
      () =>
        get(
          "clip-a",
          mintTicket(
            { fileId: "clip-a", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS },
            "a-different-secret-also-long-enough-here",
          ),
        ),
    ],
    ["a malformed ticket", () => get("clip-a", "not-a-ticket")],
  ])("never touches the admin key for %s", async (_name, request) => {
    expect((await request()).status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
    expect(appwrite.jwtFor).toEqual([]);
  });

  it("mints the JWT for the ticket's user, once, after the ticket checks out", async () => {
    await get("clip-a", ticket("clip-a"));

    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("takes the user from the signed ticket, never from the rest of the URL", async () => {
    const victim = "athlete_somebody_else";
    const token = encodeURIComponent(ticket(OTHER_ATHLETES_CLIP));
    const response = await GET(
      new Request(
        `http://localhost/api/clip/${OTHER_ATHLETES_CLIP}?t=${token}&u=${victim}&user=${victim}&userId=${victim}`,
      ),
      { params: Promise.resolve({ fileId: OTHER_ATHLETES_CLIP }) },
    );

    expect(response.status).toBe(404);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("answers 404 when a JWT cannot be minted for the ticket's user", async () => {
    appwrite.jwtFails = true;
    expect((await get("clip-a", ticket("clip-a"))).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });
});

describe("GET /api/clip/[fileId] — a missing VIDEO_TICKET_SECRET", () => {
  it("answers a clean 500 and names the variable in the log", async () => {
    vi.stubEnv("VIDEO_TICKET_SECRET", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("VIDEO_TICKET_SECRET");
  });
});

describe("GET /api/clip/[fileId] — which bucket (v22)", () => {
  const proxyTicket = (fileId: string, bucketId = "set_video_proxies") =>
    mintTicket({ fileId, userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS, bucketId }, SECRET);

  it("streams a proxy ticket from the proxy bucket, as the user, with the range", async () => {
    const response = await get("clip-a_proxy", proxyTicket("clip-a_proxy"), "bytes=0-10");
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("video-bytes");
    const [url, init] = storage.mock.calls[0];
    expect(url).toBe("https://appwrite.test/v1/storage/buckets/set_video_proxies/files/clip-a_proxy/view");
    expect(init.headers).toMatchObject({ "x-appwrite-jwt": `jwt-for-${COACH}.1`, range: "bytes=0-10" });
  });

  it("streams a ticket that names no bucket from the clip bucket, as before proxies", async () => {
    await get("clip-a", ticket("clip-a"));
    expect(storage.mock.calls[0][0]).toContain("/buckets/set_videos/");
  });

  it("refuses a signed ticket for a bucket off the allowlist without fetching anything", async () => {
    const response = await get("clip-a", proxyTicket("clip-a", "avatars"));
    expect(response.status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
    expect(appwrite.jwtFor).toEqual([]);
  });

  it("falls back to the original, as the same user, when the proxy file is gone", async () => {
    absent.add("set_video_proxies/clip-a_proxy");
    const response = await get("clip-a_proxy", proxyTicket("clip-a_proxy"), "bytes=0-10");
    expect(response.status).toBe(206);
    expect(storage.mock.calls.map((c) => c[0])).toEqual([
      "https://appwrite.test/v1/storage/buckets/set_video_proxies/files/clip-a_proxy/view",
      "https://appwrite.test/v1/storage/buckets/set_videos/files/clip-a/view",
    ]);
    expect((storage.mock.calls[1][1].headers as Record<string, string>)["x-appwrite-jwt"]).toBe(`jwt-for-${COACH}.1`);
  });

  it("does not fall back for a clip ticket, and the fallback still answers to Appwrite's permissions", async () => {
    absent.add("set_videos/clip-a");
    expect((await get("clip-a", ticket("clip-a"))).status).toBe(404);
    expect(storage).toHaveBeenCalledTimes(1);

    storage.mockClear();
    absent.add(`set_video_proxies/${OTHER_ATHLETES_CLIP}_proxy`);
    const response = await get(`${OTHER_ATHLETES_CLIP}_proxy`, proxyTicket(`${OTHER_ATHLETES_CLIP}_proxy`));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("video-bytes");
  });

  it("refuses a proxy ticket replayed against a different path", async () => {
    expect((await get("clip-a", proxyTicket("clip-a_proxy"))).status).toBe(404);
  });
});

describe("GET /api/clip/[fileId] — the content-type is what is being served, not what was stored", () => {
  /**
   * Appwrite sniffs a file's `mimeType` at upload and sometimes gets it
   * wrong: on 2 Nov 2026, 5 of the 27 live clips were `application/SIMH-tape-data`
   * and 2 were `''`. With nosniff the browser has to believe the header, so a
   * forwarded bad type is a clip that will not play.
   */
  it.each([
    ["a sniffed non-video type", "application/SIMH-tape-data"],
    ["an empty type", ""],
    ["a generic binary type", "application/octet-stream"],
    ["a type the browser would render", "text/html"],
    ["a bare video/ with no subtype", "video/"],
  ])("serves an original stored with %s as video/mp4", async (_name, stored) => {
    storedType.set("set_videos/clip-a", stored);
    const response = await get("clip-a", ticket("clip-a"), "bytes=0-10");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps an original's own video type, normalised", async () => {
    storedType.set("set_videos/clip-a", "video/quicktime");
    expect((await get("clip-a", ticket("clip-a"))).headers.get("content-type")).toBe("video/quicktime");

    storedType.set("set_videos/clip-a", "Video/QuickTime; charset=binary");
    expect((await get("clip-a", ticket("clip-a"))).headers.get("content-type")).toBe("video/quicktime");

    storedType.set("set_videos/clip-a", "video/webm");
    expect((await get("clip-a", ticket("clip-a"))).headers.get("content-type")).toBe("video/webm");
  });

  it("serves a proxy as video/mp4 whatever was stored", async () => {
    const proxyTicket = mintTicket(
      { fileId: "clip-a_proxy", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS, bucketId: "set_video_proxies" },
      SECRET,
    );
    for (const stored of ["", "application/SIMH-tape-data", "video/quicktime"]) {
      storedType.set("set_video_proxies/clip-a_proxy", stored);
      expect((await get("clip-a_proxy", proxyTicket)).headers.get("content-type")).toBe("video/mp4");
    }
  });

  /**
   * A proxy ticket that falls back is serving the original, so it gets the
   * original's type. `video/quicktime` tells the two rules apart: the proxy
   * rule would say mp4.
   */
  it("gives a proxy ticket that fell back to the original the original's type", async () => {
    absent.add("set_video_proxies/clip-a_proxy");
    const proxyTicket = mintTicket(
      { fileId: "clip-a_proxy", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS, bucketId: "set_video_proxies" },
      SECRET,
    );

    storedType.set("set_videos/clip-a", "video/quicktime");
    const response = await get("clip-a_proxy", proxyTicket, "bytes=0-10");
    expect(storage.mock.calls.at(-1)![0]).toContain("/buckets/set_videos/files/clip-a/view");
    expect(response.headers.get("content-type")).toBe("video/quicktime");

    storedType.set("set_videos/clip-a", "application/SIMH-tape-data");
    expect((await get("clip-a_proxy", proxyTicket)).headers.get("content-type")).toBe("video/mp4");
  });

  it("does not put a content-type on a 404", async () => {
    storedType.set("set_videos/clip-a", "video/quicktime");
    absent.add("set_videos/clip-a");
    const response = await get("clip-a", ticket("clip-a"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

describe("GET /api/clip/[fileId] — one JWT per user, reused across range requests", () => {
  it("mints once across a player's range requests for the same ticket", async () => {
    const token = ticket("clip-a");
    for (const range of ["bytes=0-", "bytes=500-", "bytes=900-", "bytes=100-200"]) {
      expect((await get("clip-a", token, range)).status).toBe(206);
    }

    expect(appwrite.jwtFor).toEqual([COACH]);
    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(storage.mock.calls.map((_, i) => jwtSent(i))).toEqual(Array(4).fill(`jwt-for-${COACH}.1`));
  });

  /** A player opens with several requests at once; they share one mint. */
  it("mints once for requests that arrive together", async () => {
    const token = ticket("clip-a");
    const responses = await Promise.all(["bytes=0-", "bytes=500-", "bytes=900-"].map((r) => get("clip-a", token, r)));

    expect(responses.map((r) => r.status)).toEqual([206, 206, 206]);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("reuses it across the same user's tickets for different clips", async () => {
    await get("clip-a", ticket("clip-a"));
    await get("clip-b", ticket("clip-b"));
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  /**
   * The security property. The cache is keyed on the signed ticket's user, so
   * a warm instance holding the coach's JWT never hands it to the athlete's
   * ticket, or the reverse -- even interleaved, even for the same clip.
   */
  it("mints separately per user and never crosses them", async () => {
    await get("clip-a", ticket("clip-a"), "bytes=0-");
    await get("clip-a", ticket("clip-a", undefined, ATHLETE), "bytes=0-");
    await get("clip-a", ticket("clip-a"), "bytes=500-");
    await get("clip-a", ticket("clip-a", undefined, ATHLETE), "bytes=500-");

    expect(appwrite.jwtFor).toEqual([COACH, ATHLETE]);
    expect(storage.mock.calls.map((_, i) => userOf(jwtSent(i)))).toEqual([COACH, ATHLETE, COACH, ATHLETE]);
  });

  it("does not let a cached JWT open a clip the ticket's user may not read", async () => {
    await get("clip-a", ticket("clip-a"));
    const response = await get(OTHER_ATHLETES_CLIP, ticket(OTHER_ATHLETES_CLIP));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("video-bytes");
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  /**
   * Reuse must not weaken revocation: Appwrite checks permissions per read,
   * not per JWT, so a coach unlinked between two seeks 404s on the second
   * with no new mint involved.
   */
  it("still honours revocation mid-scrub with a reused JWT", async () => {
    const token = ticket("clip-b");
    expect((await get("clip-b", token, "bytes=0-")).status).toBe(206);

    const before = readers["clip-b"];
    readers["clip-b"] = [];
    try {
      expect((await get("clip-b", token, "bytes=500-")).status).toBe(404);
    } finally {
      readers["clip-b"] = before;
    }
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("still refuses an expired ticket while the user's JWT is cached", async () => {
    await get("clip-a", ticket("clip-a"));
    storage.mockClear();

    expect((await get("clip-a", ticket("clip-a", Date.now() - 1))).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("sits inside both the JWT's 15-minute default and the ticket's lifetime", () => {
    expect(JWT_REUSE_MS).toBeGreaterThan(0);
    expect(JWT_REUSE_MS).toBeLessThan(TICKET_TTL_MS);
    expect(JWT_REUSE_MS).toBeLessThanOrEqual(15 * 60 * 1000 - 10 * 60 * 1000);
  });

  it("mints afresh once the reuse window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));

    await get("clip-a", ticket("clip-a"));
    vi.advanceTimersByTime(JWT_REUSE_MS - 1);
    await get("clip-a", ticket("clip-a"));
    expect(appwrite.jwtFor).toEqual([COACH]);

    vi.advanceTimersByTime(1);
    await get("clip-a", ticket("clip-a"));
    expect(appwrite.jwtFor).toEqual([COACH, COACH]);
    expect(jwtSent(2)).toBe(`jwt-for-${COACH}.2`);
  });

  it("does not cache a failed mint", async () => {
    appwrite.jwtFails = true;
    expect((await get("clip-a", ticket("clip-a"))).status).toBe(404);

    appwrite.jwtFails = false;
    expect((await get("clip-a", ticket("clip-a"))).status).toBe(200);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });
});

describe("GET /api/clip/[fileId] — a cached JWT Appwrite no longer accepts", () => {
  /** A JWT dies with the session it was cut from, e.g. when the user signs out everywhere. */
  it("evicts it, mints a fresh one and retries once", async () => {
    const token = ticket("clip-a");
    await get("clip-a", token, "bytes=0-");
    appwrite.refused.add(`jwt-for-${COACH}.1`);

    const response = await get("clip-a", token, "bytes=500-");

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("video-bytes");
    expect(storage.mock.calls.map((_, i) => jwtSent(i))).toEqual([
      `jwt-for-${COACH}.1`,
      `jwt-for-${COACH}.1`,
      `jwt-for-${COACH}.2`,
    ]);

    // And the fresh one is what the next seek reuses.
    await get("clip-a", token, "bytes=900-");
    expect(jwtSent(3)).toBe(`jwt-for-${COACH}.2`);
    expect(appwrite.jwtFor).toEqual([COACH, COACH]);
  });

  it("retries only once, and answers 404 when the fresh JWT is refused too", async () => {
    const token = ticket("clip-a");
    await get("clip-a", token);
    storage.mockClear();
    // Once per attempt, not mockImplementation: that would outlive this test.
    const refused = async () => Response.json({ message: "Invalid token", type: "user_unauthorized" }, { status: 401 });
    storage.mockImplementationOnce(refused).mockImplementationOnce(refused);

    const response = await get("clip-a", token);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("user_unauthorized");
    expect(storage).toHaveBeenCalledTimes(2);
    expect(appwrite.jwtFor).toEqual([COACH, COACH]);
  });

  it("does not retry a 401 on a JWT it has just minted", async () => {
    storage.mockImplementationOnce(async () =>
      Response.json({ message: "Invalid token", type: "user_unauthorized" }, { status: 401 }),
    );

    expect((await get("clip-a", ticket("clip-a"))).status).toBe(404);
    expect(storage).toHaveBeenCalledTimes(1);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("retries the proxy fallback with the fresh JWT as well", async () => {
    absent.add("set_video_proxies/clip-a_proxy");
    const proxyTicket = mintTicket(
      { fileId: "clip-a_proxy", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS, bucketId: "set_video_proxies" },
      SECRET,
    );
    await get("clip-a_proxy", proxyTicket);
    storage.mockClear();
    appwrite.refused.add(`jwt-for-${COACH}.1`);

    const response = await get("clip-a_proxy", proxyTicket);

    // The refused JWT 401s on the proxy before it can learn the proxy is
    // absent; the fresh one finds it absent and falls back.
    expect(response.status).toBe(200);
    expect(storage.mock.calls.map((c, i) => [c[0].replace(/^.*\/buckets\//, ""), jwtSent(i)])).toEqual([
      ["set_video_proxies/files/clip-a_proxy/view", `jwt-for-${COACH}.1`],
      ["set_video_proxies/files/clip-a_proxy/view", `jwt-for-${COACH}.2`],
      ["set_videos/files/clip-a/view", `jwt-for-${COACH}.2`],
    ]);
  });
});
