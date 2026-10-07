import { renderHook, waitFor } from "@testing-library/react";
import { useMyProgram } from "./use-my-program";
import { cacheProgram, cachedProgram } from "./my-program-cache";
import type { ProgramTree } from "./program";

const store = vi.hoisted(() => ({
  program: vi.fn(),
  maxes: vi.fn(),
  estimated: vi.fn(),
}));
vi.mock("./program-store", () => ({ fetchMyProgram: store.program }));
vi.mock("@/lib/strength/reference-max-store", () => ({
  fetchReferenceMaxes: store.maxes,
  fetchEstimatedMaxes: store.estimated,
}));

const tree = (name = "Block 1"): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name,
  status: "published",
  startOn: null,
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [],
});
const max = { id: "m", exerciseId: "squat", kind: "training" as const, valueKg: 200, effectiveFrom: "2026-09-01T00:00:00Z", recordedBy: "r" };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  store.maxes.mockResolvedValue([max]);
  store.estimated.mockResolvedValue(new Map());
});

describe("useMyProgram", () => {
  it("loads, then caches for the next visit", async () => {
    store.program.mockResolvedValue(tree());
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(cachedProgram("joey")?.program.name).toBe("Block 1");
    expect(cachedProgram("joey")?.maxes.entries).toHaveLength(1);
  });

  it("offline with a cache: shows it, quietly, with its maxes", async () => {
    cacheProgram("joey", tree("Cached"), { entries: [max], estimated: [] });
    store.program.mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.program?.name).toBe("Cached"));
    // Let the failed refresh settle: it must not replace the cache with an error.
    await waitFor(() => expect(store.program).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current.status).toBe("ready");
    expect(result.current.maxes.entries).toHaveLength(1);
  });

  it("offline with nothing cached is 'failed', which the screen words gently", async () => {
    store.program.mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });

  it("keeps cached maxes when only the max read fails", async () => {
    cacheProgram("joey", tree(), { entries: [max], estimated: [] });
    store.program.mockResolvedValue(tree("Fresh"));
    store.maxes.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.program?.name).toBe("Fresh"));
    expect(result.current.maxes.entries).toEqual([max]);
  });

  it("an unpublished program clears the cache", async () => {
    cacheProgram("joey", tree(), { entries: [], estimated: [] });
    store.program.mockResolvedValue(null);
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.status).toBe("none"));
    expect(cachedProgram("joey")).toBeNull();
  });

  /**
   * The same rule as the cache, for what is already on screen: a phone handed
   * from one athlete to the next must not keep the first one's block because
   * the second one's fetch failed.
   */
  it("drops the previous athlete's program when the athlete changes and the new read fails", async () => {
    store.program.mockResolvedValueOnce(tree("Joey's block"));
    const { result, rerender } = renderHook(({ id }) => useMyProgram(id), { initialProps: { id: "joey" } });
    await waitFor(() => expect(result.current.program?.name).toBe("Joey's block"));

    store.program.mockRejectedValueOnce(new Error("offline"));
    rerender({ id: "sam" });
    expect(result.current.program).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.program).toBeNull();
    expect(result.current.maxes.entries).toEqual([]);
  });

  it("shows nothing once the athlete id goes away", async () => {
    store.program.mockResolvedValueOnce(tree("Joey's block"));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useMyProgram(id), {
      initialProps: { id: "joey" as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ id: null });
    expect(result.current).toMatchObject({ status: "loading", program: null });
  });

  it("never shows another athlete's cached block", async () => {
    cacheProgram("someone", tree("Theirs"), { entries: [], estimated: [] });
    store.program.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMyProgram("joey"));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.program).toBeNull();
  });
});
