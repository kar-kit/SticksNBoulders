import { chunkFileIds, loadClipUrlBatches, type BatchOutcome } from "./clip-url-batches";
import { MAX_FILES } from "@/lib/video/clip-limits";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `file-${i}`);

/** A stand-in for fetchClipUrls that, like the route, refuses an oversized batch. */
const route = () =>
  vi.fn(async (batch: readonly string[]) => {
    if (batch.length > MAX_FILES) throw new Error("clip urls failed: 400");
    return new Map(batch.map((id) => [id, `/api/clip/${id}`]));
  });

describe("chunkFileIds", () => {
  it("keeps exactly MAX_FILES ids in one batch", () => {
    const batches = chunkFileIds(ids(MAX_FILES));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(MAX_FILES);
  });

  it("splits one over the limit into 60 and 1", () => {
    expect(chunkFileIds(ids(MAX_FILES + 1)).map((batch) => batch.length)).toEqual([60, 1]);
  });

  it("splits 130 into 60, 60 and 10, in queue order", () => {
    const batches = chunkFileIds(ids(130));
    expect(batches.map((batch) => batch.length)).toEqual([60, 60, 10]);
    expect(batches.flat()).toEqual(ids(130));
  });

  it("drops empty and repeated ids before counting", () => {
    expect(chunkFileIds(["a", "", "a", "b"])).toEqual([["a", "b"]]);
    expect(chunkFileIds([])).toEqual([]);
  });
});

describe("loadClipUrlBatches", () => {
  async function run(count: number, fetchBatch = route()) {
    const outcomes: BatchOutcome[] = [];
    await loadClipUrlBatches(ids(count), fetchBatch, (outcome) => outcomes.push(outcome));
    return { outcomes, fetchBatch };
  }

  it("makes one request for exactly 60 ids", async () => {
    const { outcomes, fetchBatch } = await run(60);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ ok: true });
  });

  it("makes two requests for 61 ids, neither over the limit, and returns every url", async () => {
    const { outcomes, fetchBatch } = await run(61);
    expect(fetchBatch).toHaveBeenCalledTimes(2);
    for (const [batch] of fetchBatch.mock.calls) expect(batch.length).toBeLessThanOrEqual(MAX_FILES);
    const merged = new Map(outcomes.flatMap((o) => (o.ok ? [...o.urls] : [])));
    expect(merged.size).toBe(61);
  });

  it("makes three requests for 130 ids and returns every url", async () => {
    const { outcomes, fetchBatch } = await run(130);
    expect(fetchBatch).toHaveBeenCalledTimes(3);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const merged = new Map(outcomes.flatMap((o) => (o.ok ? [...o.urls] : [])));
    expect([...merged.keys()].sort()).toEqual(ids(130).sort());
  });

  it("reports a failing batch with the ids it covered, and still delivers the others", async () => {
    const fetchBatch = vi.fn(async (batch: readonly string[]) => {
      if (batch.includes("file-60")) throw new Error("clip urls failed: 500");
      return new Map(batch.map((id) => [id, `/api/clip/${id}`]));
    });
    const { outcomes } = await run(130, fetchBatch);

    const failed = outcomes.filter((o) => !o.ok);
    const landed = outcomes.filter((o) => o.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].ids).toEqual(ids(120).slice(60));
    expect(failed[0]).toMatchObject({ error: expect.any(Error) });
    expect(landed.map((o) => o.ids.length).sort()).toEqual([10, 60]);
  });

  it("delivers the first batch without waiting for the last", async () => {
    let release: (urls: Map<string, string>) => void = () => {};
    const fetchBatch = vi.fn((batch: readonly string[]) =>
      batch[0] === "file-0"
        ? Promise.resolve(new Map(batch.map((id) => [id, `/api/clip/${id}`])))
        : new Promise<Map<string, string>>((resolve) => (release = resolve)),
    );
    const seen: BatchOutcome[] = [];
    const done = loadClipUrlBatches(ids(61), fetchBatch, (outcome) => seen.push(outcome));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].ids[0]).toBe("file-0");

    release(new Map([["file-60", "/api/clip/file-60"]]));
    await done;
    expect(seen).toHaveLength(2);
  });
});
