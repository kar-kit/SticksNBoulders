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

const LIBRARY: Exercise[] = [
  { id: "row-global", name: "Barbell Row", normalisedName: "barbell row", isGlobal: true },
  { id: "mine", name: "Joey's Thing", normalisedName: "joeys thing", isGlobal: false, ownerId: "joey" },
];

const actor = { userId: "joey" };

beforeEach(() => createExercise.mockReset());

describe("resolving a typed name to an exercise", () => {
  it("writes nothing when the library already holds the name", async () => {
    // idx_normalised is a key index, not unique, so Appwrite would accept a
    // second "Barbell Row" -- and that lift's history would then split across
    // two ids, half under each.
    const result = await resolveOrCreateExercise("  barbell   ROW ", LIBRARY, actor);

    expect(result).toEqual({ exercise: LIBRARY[0], created: false });
    expect(createExercise).not.toHaveBeenCalled();
  });

  it("creates one when the name is genuinely new", async () => {
    createExercise.mockResolvedValue({
      $id: "new-id",
      name: "Zercher Squat",
      normalised_name: "zercher squat",
      is_global: false,
      owner_id: "joey",
    });

    const result = await resolveOrCreateExercise("Zercher Squat", LIBRARY, actor);

    expect(createExercise).toHaveBeenCalledWith(expect.anything(), actor, { name: "Zercher Squat" });
    expect(result).toEqual({
      exercise: {
        id: "new-id",
        name: "Zercher Squat",
        normalisedName: "zercher squat",
        isGlobal: false,
        ownerId: "joey",
      },
      created: true,
    });
  });

  it("fails loudly if Appwrite returns a row it cannot use", async () => {
    createExercise.mockResolvedValue({ $id: "broken" });
    await expect(resolveOrCreateExercise("Zercher Squat", LIBRARY, actor)).rejects.toThrow(
      /unusable exercise row/,
    );
  });
});
