import { fetchExerciseLibrary } from "./library";

const listRows = vi.hoisted(() => vi.fn());

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ tables: { listRows }, databaseId: "db" }),
}));
// Provenance is tested in appwrite/documents; this file is about the mapping.
vi.mock("@/appwrite/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/appwrite/documents")>()),
  authenticRows: (_table: string, rows: unknown[]) => rows,
}));
vi.mock("@/lib/offline/client", () => ({ enqueue: vi.fn() }));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  $id: id,
  name: id,
  normalised_name: id.toLowerCase(),
  is_global: true,
  ...over,
});

describe("loading the library", () => {
  it("reads a null or missing video default as false, and only true as true", async () => {
    listRows.mockResolvedValueOnce({
      rows: [
        row("Squat", { video_default: true }),
        row("Leg Curl", { video_default: null }),
        row("Plank"),
        row("Dip", { video_default: false }),
      ],
    });
    listRows.mockResolvedValueOnce({ rows: [] });

    const library = await fetchExerciseLibrary("joey");

    expect(library.map((e) => [e.name, e.videoDefault])).toEqual([
      ["Squat", true],
      ["Leg Curl", false],
      ["Plank", false],
      ["Dip", false],
    ]);
  });
});
