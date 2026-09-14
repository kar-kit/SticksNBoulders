import { resolveOrCreateExercise } from "./library";
import type { Exercise } from "./match";

const createExercise = vi.hoisted(() => vi.fn());

vi.mock("@/appwrite/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/appwrite/documents")>()),
  createExercise,
}));
vi.mock("@/lib/auth/circle", () => ({ ensureMyCircle: async () => {} }));
vi.mock("@/appwrite/documents/browser-writer", () => ({
  browserWriteDeps: () => ({ writer: {}, databaseId: "db", newId: () => "id", now: () => new Date() }),
}));

// A new exercise is written the same way a set is: onto the queue, never
// straight at Appwrite. What the test cares about is what got queued.
const enqueue = vi.hoisted(() =>
  vi.fn<(kind: string, payload: Record<string, unknown>) => Promise<void>>(),
);
vi.mock("@/lib/offline/client", () => ({ enqueue }));

const LIBRARY: Exercise[] = [
  { id: "row-global", name: "Barbell Row", normalisedName: "barbell row", isGlobal: true },
  { id: "mine", name: "Joey's Thing", normalisedName: "joeys thing", isGlobal: false, ownerId: "joey" },
];

const actor = { userId: "joey" };

beforeEach(() => {
  createExercise.mockReset();
  enqueue.mockReset();
  enqueue.mockResolvedValue(undefined);
});

describe("resolving a typed name to an exercise", () => {
  it("writes nothing when the library already holds the name", async () => {
    // idx_normalised is a key index, not unique, so Appwrite would accept a
    // second "Barbell Row" -- and that lift's history would then split across
    // two ids, half under each.
    const result = await resolveOrCreateExercise("  barbell   ROW ", LIBRARY, actor);

    expect(result).toEqual({ exercise: LIBRARY[0], created: false });
    expect(createExercise).not.toHaveBeenCalled();
  });

  it("creates one when the name is genuinely new, without waiting for Appwrite", async () => {
    const result = await resolveOrCreateExercise("  Zercher Squat  ", LIBRARY, actor);

    expect(result.created).toBe(true);
    expect(result.exercise).toMatchObject({
      name: "Zercher Squat",
      normalisedName: "zercher squat",
      isGlobal: false,
      ownerId: "joey",
    });
    // The id is generated here and is the Appwrite row id, so the set logged
    // straight afterwards can reference it before the row exists.
    expect(result.exercise.id).toMatch(/^ex-/);
    expect(enqueue).toHaveBeenCalledWith("exercise.create", {
      exerciseId: result.exercise.id,
      name: "Zercher Squat",
    });
  });

  it("gives every new exercise its own id", async () => {
    const one = await resolveOrCreateExercise("Zercher Squat", LIBRARY, actor);
    const two = await resolveOrCreateExercise("Jefferson Curl", LIBRARY, actor);
    expect(one.exercise.id).not.toBe(two.exercise.id);
  });
});
