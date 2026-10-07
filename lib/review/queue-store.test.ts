import { reviewPermissions, setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchClips, fetchReviewedSetIds, subscribeToClips } from "./queue-store";

/**
 * The Review Queue's reads against a fake Appwrite that applies the queries,
 * so the athlete filter, the newest-first order and the forgery filter are
 * each something a test can see go missing.
 */

type Listener = (message: { events?: string[] }) => void;

const db = vi.hoisted(() => ({
  current: null as FakeTables | null,
  channels: [] as { channel: string; listener: Listener }[],
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: db.current!,
    client: {
      subscribe: (channel: string, listener: Listener) => {
        db.channels.push({ channel, listener });
        return () => {};
      },
    },
  }),
}));

const pad = (i: number) => String(i).padStart(4, "0");

/** A filmed set, stamped as the athlete's own write would be. */
const clip = (id: string, athleteId: string, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: id,
  $permissions: setPermissions({ athleteId }),
  athlete_id: athleteId,
  exercise_id: "squat",
  session_id: "s1",
  set_index: 1,
  load_kg: 180,
  reps: 3,
  rpe: 8,
  e1rm_kg: 196,
  logged_at: "2026-10-06T18:00:00.000Z",
  video_file_id: `file-${id}`,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
  db.channels = [];
});

describe("fetchClips", () => {
  it("returns filmed sets of the requested athletes only", async () => {
    db.current!.seed("sets", [
      clip("a1", "joey"),
      clip("a2", "brandon"),
      clip("a3", "stranger"),
      // Logged without a video: not a clip.
      clip("a4", "joey", { video_file_id: null }),
    ]);

    const clips = await fetchClips(["joey", "brandon"]);
    expect(clips.map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });

  it("leaves out a forged set carrying the athlete's id", async () => {
    // A stranger's row under Joey's id, stamped read("users"). In the queue it
    // would sit as Joey's lift with the stranger's video.
    const forged = clip("forged", "joey", { $permissions: ['read("users")'] });
    db.current!.seed("sets", [clip("real", "joey"), forged]);

    const clips = await fetchClips(["joey"]);
    expect(clips.map((c) => c.id)).toEqual(["real"]);
  });

  it("keeps the newest 300 clips when there are more, not the oldest", async () => {
    // Ids rise with time, as Appwrite's unique ids do.
    db.current!.seed(
      "sets",
      Array.from({ length: 350 }, (_, i) => clip(`set-${pad(i)}`, "joey")),
    );

    const ids = new Set((await fetchClips(["joey"])).map((c) => c.id));
    expect(ids.size).toBe(300);
    expect(ids.has("set-0349")).toBe(true);
    expect(ids.has("set-0050")).toBe(true);
    expect(ids.has("set-0049")).toBe(false);
    expect(ids.has("set-0000")).toBe(false);
  });

  it("has the server skip unfilmed sets rather than paging through them", async () => {
    // Most sets have no video. Handing them back for the store to discard
    // costs a round trip per hundred sets on the screen measured by how fast
    // it clears.
    db.current!.seed("sets", [
      clip("set-0000", "joey"),
      ...Array.from({ length: 400 }, (_, i) => clip(`set-${pad(i + 1)}`, "joey", { video_file_id: null })),
    ]);

    expect((await fetchClips(["joey"])).map((c) => c.id)).toEqual(["set-0000"]);
    expect(db.current!.callsTo("sets")).toHaveLength(1);
  });

  it("carries the prescription snapshot through to the clip", async () => {
    db.current!.seed("sets", [clip("p", "joey", { prescription_id: "line1", prescribed: "3 x 180 kg @ RPE 8" })]);
    const [only] = await fetchClips(["joey"]);
    expect(only).toMatchObject({ prescriptionId: "line1", prescribed: "3 x 180 kg @ RPE 8", loadKg: 180, rpe: 8 });
  });
});

describe("fetchReviewedSetIds", () => {
  const review = (id: string, coachId: string, setId: string, over: Partial<FakeRow> = {}): FakeRow => ({
    $id: id,
    $permissions: reviewPermissions({ athleteId: "joey", coachId }),
    coach_id: coachId,
    athlete_id: "joey",
    set_id: setId,
    ...over,
  });

  it("is this coach's own clears, not another coach's and not a forgery", async () => {
    db.current!.seed("set_reviews", [
      review("r1", "ruairi", "s1"),
      // Louis cleared s2 for himself. Ruairi still has it to watch.
      review("r2", "louis", "s2"),
      // The athlete writing a review row as Ruairi to empty his queue.
      review("r3", "ruairi", "s3", { $permissions: ['read("users")', 'update("user:joey")'] }),
    ]);

    expect([...(await fetchReviewedSetIds("ruairi"))]).toEqual(["s1"]);
  });
});

describe("subscribeToClips", () => {
  const fire = (event: string) => db.channels[0].listener({ events: [event] });

  it("refreshes when a set row is updated, which is how an upload lands", async () => {
    const onChange = vi.fn();
    subscribeToClips("db", onChange);
    expect(db.channels[0].channel).toBe("databases.db.tables.sets.rows");

    fire("databases.db.tables.sets.rows.abc.update");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a set row is created", async () => {
    const onChange = vi.fn();
    subscribeToClips("db", onChange);
    fire("databases.db.tables.sets.rows.abc.create");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
