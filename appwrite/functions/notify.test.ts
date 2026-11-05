import main from "../../functions/notify/src/main";
import { POLICIES } from "../documents/policy";
import { FUNCTIONS } from "./index";

const A = "athlete_a";
const C = "coach_c";

const spec = () => FUNCTIONS.find((f) => f.id === "notify")!;

describe("the notify Function's spec", () => {
  it("hears sets created and updated and comments created, in both spellings, and nothing else", () => {
    const events = [...spec().events].sort();
    expect(events).toEqual(
      [
        "databases.sticksnboulders.collections.set_comments.documents.*.create",
        "databases.sticksnboulders.collections.sets.documents.*.create",
        "databases.sticksnboulders.collections.sets.documents.*.update",
        "databases.sticksnboulders.tables.set_comments.rows.*.create",
        "databases.sticksnboulders.tables.sets.rows.*.create",
        "databases.sticksnboulders.tables.sets.rows.*.update",
      ].sort(),
    );
    expect(events.some((e) => e.includes("comment_reactions") || e.includes("set_reviews"))).toBe(false);
  });

  it("comes after validate-row, which must never depend on it", () => {
    const ids = FUNCTIONS.map((f) => f.id);
    expect(ids.indexOf("notify")).toBeGreaterThan(ids.indexOf("validate-row"));
  });

  it("names its secrets and never values them", () => {
    expect(spec().secrets).toEqual(["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    for (const key of spec().secrets ?? []) expect(Object.keys(spec().variables)).not.toContain(key);
  });

  it("can read a clip's file but not write one, and touches no team or user", () => {
    expect(spec().scopes).toContain("files.read");
    expect(spec().scopes.some((s) => s.startsWith("files.write") || s.startsWith("users") || s.startsWith("teams"))).toBe(false);
  });
});

function run(body: unknown, headers: Record<string, string> = { "x-appwrite-trigger": "event", "x-appwrite-key": "k", "x-appwrite-event": "databases.sticksnboulders.tables.set_comments.rows.c1.create" }) {
  const logs: string[] = [];
  const errors: string[] = [];
  let result: { body: unknown; status?: number } | undefined;
  const ctx = {
    req: { headers, body },
    res: { json: (b: unknown, status?: number) => (result = { body: b, status }) },
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  };
  return { ctx, logs, errors, result: () => result };
}

const reply = {
  $id: "c1",
  $tableId: "set_comments",
  $databaseId: "sticksnboulders",
  set_id: "set1",
  athlete_id: A,
  author_id: A,
  body: "Felt good",
  $permissions: POLICIES.set_comments({ athleteId: A, authorId: A }),
};

describe("the notify Function", () => {
  const routes: Array<{ url: string; method: string }> = [];
  beforeEach(() => {
    routes.length = 0;
    vi.stubEnv("APPWRITE_FUNCTION_API_ENDPOINT", "http://appwrite/v1");
    vi.stubEnv("APPWRITE_FUNCTION_PROJECT_ID", "p");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:coach@example.com");
    vi.stubEnv("NOTIFY_DRY_RUN", "true");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      routes.push({ url, method: init.method ?? "GET" });
      if (url.includes("/tables/coach_athlete_links/rows?")) return Response.json({ rows: [{ $id: "l", coach_id: C, athlete_id: A, status: "active" }] });
      if (url.includes("/tables/push_subscriptions/rows?"))
        return Response.json({ rows: [{ $id: "push_1", user_id: C, endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }] });
      if (url.endsWith(`/tables/profiles/rows/${A}`)) return Response.json({ $id: A, display_name: "Joey" });
      return Response.json({ type: "row_not_found" }, { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("ignores anything but an event", async () => {
    const t = run(reply, { "x-appwrite-trigger": "http" });
    await main(t.ctx);
    expect(t.result()?.body).toMatchObject({ action: "skip" });
    expect(routes).toEqual([]);
  });

  it("in a dry run, resolves recipients and writes nothing", async () => {
    const t = run(reply);
    await main(t.ctx);
    expect(t.result()?.body).toMatchObject({ action: "sent", kind: "reply", devices: 1, delivered: 1, dryRun: true });
    expect(routes.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("sends nothing and says why when the VAPID keys are missing", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const t = run(reply);
    await main(t.ctx);
    expect(t.result()?.body).toEqual({ action: "skip", reason: "not configured" });
    expect(t.errors.join(" ")).toMatch(/VAPID/);
    expect(t.errors.join(" ")).not.toContain("pub");
  });

  it("never fails an execution, so it can never take another Function on the same event down", async () => {
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    const t = run(reply);
    await main(t.ctx);
    expect(t.result()?.status ?? 200).toBe(200);
    expect(t.result()?.body).toMatchObject({ action: "skip" });
    expect(t.errors).toHaveLength(1);
  });
});
