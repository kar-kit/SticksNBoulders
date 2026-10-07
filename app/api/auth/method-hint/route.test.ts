// @vitest-environment node
import { appwrite, resetAppwrite, routeRequest } from "../../route-test-kit";

/**
 * The sign-in method hint. The route and lib/auth/method-hint.ts are real; the
 * admin Users API is the in-memory one in route-test-kit.ts.
 *
 * No JWT here by design: it is asked before anyone is signed in. What stands
 * between it and an enumeration oracle is that it answers only for accounts
 * with no password, and the two rate limits.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST } = await import("./route");

const ask = (email: string, ip?: string) => POST(routeRequest("/api/auth/method-hint", { body: { email }, ip }));
const hintFor = async (email: string, ip?: string) => (await (await ask(email, ip)).json()) as { hint: string };

/** The per-address limiter outlives each test, so every test asks about its own addresses. */
let n = 0;
const googleUser = () => {
  const id = `google_${++n}`;
  appwrite.users.push({ $id: id, email: `${id}@example.com` });
  appwrite.identities.push({ userId: id, provider: "google" });
  return `${id}@example.com`;
};

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/auth/method-hint: what it says", () => {
  it("names the provider for an account with no password", async () => {
    expect(await hintFor(googleUser())).toEqual({ hint: "use-provider", provider: "google" });
  });

  it("says nothing about an account that has a password", async () => {
    appwrite.users.push({ $id: "pw", email: "pw@example.com", password: "$argon2id$v=19$..." });
    appwrite.identities.push({ userId: "pw", provider: "google" });
    expect(await hintFor("pw@example.com")).toEqual({ hint: "none" });
  });

  it("says nothing about an address with no account", async () => {
    expect(await hintFor("nobody@example.com")).toEqual({ hint: "none" });
  });

  it("answers about the address asked, not the first account in the directory", async () => {
    // A dropped email filter would read whichever user came back first.
    googleUser();
    appwrite.users.push({ $id: "pw2", email: "pw2@example.com", password: "$argon2id$v=19$..." });
    expect(await hintFor("pw2@example.com")).toEqual({ hint: "none" });
  });
});

describe("POST /api/auth/method-hint: rate limits", () => {
  it("refuses the sixth question about one address in ten minutes, from any caller", async () => {
    const email = googleUser();
    for (let i = 0; i < 5; i++) expect((await ask(email)).status).toBe(200);
    const blocked = await ask(email);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Refused in the same shape as an answer, so a 429 body leaks nothing.
    expect(await blocked.json()).toEqual({ hint: "none" });
  });

  it("refuses the eleventh question from one caller in a minute, across addresses", async () => {
    for (let i = 0; i < 10; i++) expect((await ask(`probe${i}@example.com`, "203.0.113.20")).status).toBe(200);
    expect((await ask(googleUser(), "203.0.113.20")).status).toBe(429);
  });

  it("spends no budget on input that is not an address", async () => {
    for (let i = 0; i < 12; i++) await ask("not-an-email", "203.0.113.21");
    expect((await ask(googleUser(), "203.0.113.21")).status).toBe(200);
  });
});
