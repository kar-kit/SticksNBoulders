import { createHmac } from "node:crypto";
import { clipUrl, mintTicket, readTicket, ticketSecret, TICKET_TTL_MS } from "./ticket";

const SECRET = "a-test-secret-that-is-long-enough-to-pass";
const OTHER = "a-different-secret-also-long-enough-here";

const claims = { fileId: "clip123", userId: "ruairi", expiresAt: Date.now() + TICKET_TTL_MS };

describe("mint and read", () => {
  it("round-trips the claims", () => {
    expect(readTicket(mintTicket(claims, SECRET), SECRET)).toEqual(claims);
  });

  it("survives ids that need escaping", () => {
    const awkward = { ...claims, fileId: "a/b+c=", userId: "user.with-dots" };
    expect(readTicket(mintTicket(awkward, SECRET), SECRET)).toEqual(awkward);
  });
});

describe("a ticket that is not exactly right", () => {
  it("refuses one signed with another secret", () => {
    expect(readTicket(mintTicket(claims, OTHER), SECRET)).toBeNull();
  });

  it("refuses one whose payload was edited after signing", () => {
    // The whole point: swapping the file id in a URL must not open another
    // athlete's clip.
    const token = mintTicket(claims, SECRET);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = Buffer.from(
      JSON.stringify({ ...claims, fileId: "somebody-elses" }),
      "utf8",
    ).toString("base64url");
    expect(readTicket(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it("refuses one that has expired", () => {
    const stale = mintTicket({ ...claims, expiresAt: Date.now() - 1 }, SECRET);
    expect(readTicket(stale, SECRET)).toBeNull();
  });

  it("treats the expiry as exclusive, so a ticket is not valid at its own deadline", () => {
    const at = 1_800_000_000_000;
    expect(readTicket(mintTicket({ ...claims, expiresAt: at }, SECRET), SECRET, at)).toBeNull();
    expect(readTicket(mintTicket({ ...claims, expiresAt: at }, SECRET), SECRET, at - 1)).not.toBeNull();
  });

  it("refuses rubbish without throwing", () => {
    // A 500 on a malformed token would turn a bad URL into a pageable error.
    for (const bad of ["", ".", "no-dot", "a.", ".b", "a.b", "{}.{}", "x".repeat(400)]) {
      expect(() => readTicket(bad, SECRET)).not.toThrow();
      expect(readTicket(bad, SECRET)).toBeNull();
    }
  });

  it("refuses a correctly signed payload that is missing a claim", () => {
    const partial = Buffer.from(JSON.stringify({ fileId: "clip123" }), "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(partial).digest("base64url");
    expect(readTicket(`${partial}.${signature}`, SECRET)).toBeNull();
  });
});

describe("ticketSecret", () => {
  it("throws rather than falling back when it is missing", () => {
    // A missing secret must break playback loudly, never quietly downgrade to
    // URLs anyone can mint.
    expect(() => ticketSecret({})).toThrow(/VIDEO_TICKET_SECRET/);
  });

  it("throws on a secret short enough to guess", () => {
    expect(() => ticketSecret({ VIDEO_TICKET_SECRET: "short" })).toThrow();
  });

  it("returns a real one", () => {
    expect(ticketSecret({ VIDEO_TICKET_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("clipUrl", () => {
  it("escapes both halves, so an id with a slash cannot change the path", () => {
    const url = clipUrl("a/b", "tok+en/=");
    expect(url).toBe("/api/clip/a%2Fb?t=tok%2Ben%2F%3D");
  });

  it("is same-origin and relative", () => {
    expect(clipUrl("clip123", "tok")).toBe("/api/clip/clip123?t=tok");
  });
});
