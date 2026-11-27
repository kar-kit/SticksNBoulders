import { sickDayPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchSickDays, newClientSickId } from "./sick-store";

const db = vi.hoisted(() => ({ current: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.current! }),
}));
vi.mock("@/lib/offline/client", () => ({ enqueue: vi.fn() }));

const row = (id: string, athleteId: string, startsOn: string, endsOn: string, over: Record<string, unknown> = {}): FakeRow => ({
  $id: id,
  $permissions: sickDayPermissions({ athleteId }),
  athlete_id: athleteId,
  starts_on: startsOn,
  ends_on: endsOn,
  note: null,
  created_at: "2026-11-27T08:00:00.000Z",
  client_sick_id: id,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
});

describe("fetchSickDays", () => {
  it("asks only for the athletes it was given, and only call-ins that have not finished before the day", async () => {
    db.current!.seed("sick_days", [
      row("a", "joey", "2026-11-20", "2026-11-22"),
      row("b", "joey", "2026-11-27", "2026-11-28", { note: "Flu" }),
      row("c", "sam", "2026-11-27", "2026-11-28"),
      row("d", "joey", "2026-12-04", "2026-12-04"),
    ]);
    const found = await fetchSickDays(["joey"], "2026-11-27");
    expect(found.map((s) => s.id)).toEqual(["b", "d"]);
    expect(found[0]).toMatchObject({ athleteId: "joey", startsOn: "2026-11-27", endsOn: "2026-11-28", note: "Flu" });
  });

  it("reads several athletes in one query, as the Roster needs", async () => {
    db.current!.seed("sick_days", [row("a", "joey", "2026-11-27", "2026-11-27"), row("b", "sam", "2026-11-27", "2026-11-28")]);
    const found = await fetchSickDays(["joey", "sam"], "2026-11-27");
    expect(found.map((s) => s.athleteId).sort()).toEqual(["joey", "sam"]);
    expect(db.current!.callsTo("sick_days")).toHaveLength(1);
  });

  it("asks nothing for nobody", async () => {
    expect(await fetchSickDays([], "2026-11-27")).toEqual([]);
    expect(db.current!.calls).toEqual([]);
  });

  it("drops a call-in somebody else wrote in the athlete's name, which would put them off sick", async () => {
    db.current!.seed("sick_days", [
      row("real", "joey", "2026-11-27", "2026-11-27"),
      row("forged", "joey", "2026-11-27", "2026-11-27", { $permissions: ['read("users")'] }),
    ]);
    expect((await fetchSickDays(["joey"], "2026-11-27")).map((s) => s.id)).toEqual(["real"]);
  });

  it("drops one that is not a range, as validate-row would delete it", async () => {
    db.current!.seed("sick_days", [
      row("ok", "joey", "2026-11-27", "2026-11-28"),
      row("backwards", "joey", "2026-11-29", "2026-11-28"),
      row("forever", "joey", "2026-11-27", "2062-11-28"),
    ]);
    expect((await fetchSickDays(["joey"], "2026-11-01")).map((s) => s.id)).toEqual(["ok"]);
  });

  it("pages past a hundred rows rather than stopping there", async () => {
    const many = Array.from({ length: 130 }, (_, i) => row(`r${String(i).padStart(3, "0")}`, "joey", "2026-11-27", "2026-11-28"));
    db.current!.seed("sick_days", many);
    expect(await fetchSickDays(["joey"], "2026-11-27")).toHaveLength(130);
    expect(db.current!.callsTo("sick_days")).toHaveLength(2);
  });
});

describe("newClientSickId", () => {
  it("is a legal Appwrite row id, 23 characters like a set's, and different each time", () => {
    const id = newClientSickId();
    expect(id).toMatch(/^sk-[a-z0-9]{20}$/);
    expect(id).toHaveLength(23);
    expect(newClientSickId()).not.toBe(id);
  });
});
