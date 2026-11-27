import { act, renderHook, waitFor } from "@testing-library/react";
import { newOp, type QueuedOp } from "@/lib/offline/queue";
import { cacheSick, cachedSick } from "./sick-cache";
import type { SickSpell } from "./sick";
import { useMySick } from "./use-my-sick";

const fetchSickDays = vi.hoisted(() => vi.fn<(ids: readonly string[], since: string) => Promise<SickSpell[]>>());
vi.mock("./sick-store", () => ({
  fetchSickDays,
  newClientSickId: () => "sk-new",
}));

const queued = vi.hoisted(() => ({ create: vi.fn(), end: vi.fn() }));
vi.mock("./sick-queue", () => ({
  queueCallInSick: (input: unknown) => queued.create(input),
  queueEndSick: (id: string, endsOn: string | null) => queued.end(id, endsOn),
}));

const queue = vi.hoisted(() => ({ listener: null as ((ops: QueuedOp[]) => void) | null }));
vi.mock("@/lib/offline/client", () => ({
  subscribeToQueue: (listener: (ops: QueuedOp[]) => void) => {
    queue.listener = listener;
    listener([]);
    return () => {
      queue.listener = null;
    };
  },
}));

const spell = (over: Partial<SickSpell> = {}): SickSpell => ({
  id: "sk-1",
  athleteId: "joey",
  startsOn: "2026-11-25",
  endsOn: "2026-11-29",
  note: null,
  createdAt: "2026-11-25T08:00:00.000Z",
  ...over,
});

const sickOp = (kind: "sick.create" | "sick.end") => newOp(kind, { sickId: "sk-new" }, 0, "op-1");

beforeEach(() => {
  localStorage.clear();
  fetchSickDays.mockReset();
  queued.create.mockReset();
  queued.end.mockReset();
});

describe("useMySick", () => {
  it("knows nothing until something answers, then holds what the network said", async () => {
    fetchSickDays.mockResolvedValue([spell()]);
    const { result } = renderHook(() => useMySick("joey"));
    expect(result.current.known).toBe(false);
    expect(result.current.spells).toEqual([]);
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.spells).toEqual([spell()]);
    expect(cachedSick("joey")).toEqual([spell()]);
  });

  it("paints the cache while offline and never claims to know what it was not told", async () => {
    cacheSick("joey", [spell()]);
    fetchSickDays.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMySick("joey"));
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.spells).toEqual([spell()]);
  });

  it("is unknown, not empty, with no signal and nothing cached", async () => {
    fetchSickDays.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMySick("joey"));
    await act(async () => {});
    expect(result.current.known).toBe(false);
  });

  it("never shows another athlete's cache on a shared phone", async () => {
    cacheSick("sam", [spell({ athleteId: "sam" })]);
    fetchSickDays.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMySick("joey"));
    await act(async () => {});
    expect(result.current.spells).toEqual([]);
    expect(result.current.known).toBe(false);
  });

  it("calls in at once on screen and in the cache, and queues the write", async () => {
    fetchSickDays.mockResolvedValue([]);
    const { result } = renderHook(() => useMySick("joey"));
    await waitFor(() => expect(result.current.known).toBe(true));

    await act(async () => {
      await result.current.callIn({ startsOn: "2026-11-27", endsOn: "2026-11-28", note: "  Flu,  back Monday " });
    });

    expect(result.current.spells).toHaveLength(1);
    expect(result.current.spells[0]).toMatchObject({ id: "sk-new", athleteId: "joey", startsOn: "2026-11-27", endsOn: "2026-11-28", note: "Flu, back Monday" });
    expect(cachedSick("joey")).toHaveLength(1);
    expect(queued.create).toHaveBeenCalledWith({ sickId: "sk-new", startsOn: "2026-11-27", endsOn: "2026-11-28", note: "Flu, back Monday" });
  });

  it("ends at once on screen and queues one write per call-in it touches", async () => {
    fetchSickDays.mockResolvedValue([spell({ id: "a", startsOn: "2026-11-25", endsOn: "2026-11-29" }), spell({ id: "b", startsOn: "2026-12-03", endsOn: "2026-12-04" })]);
    const { result } = renderHook(() => useMySick("joey"));
    await waitFor(() => expect(result.current.known).toBe(true));

    await act(async () => {
      await result.current.end("2026-11-27");
    });

    expect(result.current.spells.map((s) => [s.id, s.endsOn])).toEqual([["a", "2026-11-26"]]);
    expect(queued.end).toHaveBeenCalledTimes(2);
    expect(queued.end).toHaveBeenCalledWith("a", "2026-11-26");
    expect(queued.end).toHaveBeenCalledWith("b", null);
  });

  it("queues nothing when there is nothing to end", async () => {
    fetchSickDays.mockResolvedValue([spell({ startsOn: "2026-11-01", endsOn: "2026-11-02" })]);
    const { result } = renderHook(() => useMySick("joey"));
    await waitFor(() => expect(result.current.known).toBe(true));
    await act(async () => {
      await result.current.end("2026-11-27");
    });
    expect(queued.end).not.toHaveBeenCalled();
  });

  it("lets a read that lands while a write is still queued go by: the screen is newer than it", async () => {
    let release: (spells: SickSpell[]) => void = () => {};
    fetchSickDays.mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { result, rerender } = renderHook(({ id }) => useMySick(id), { initialProps: { id: "joey" } });
    await waitFor(() => expect(result.current.known).toBe(true));

    // A call-in goes on the queue; the queue says so; a slower read lands behind it.
    await act(async () => {
      await result.current.callIn({ startsOn: "2026-11-27", endsOn: "2026-11-27", note: "" });
      queue.listener?.([sickOp("sick.create")]);
    });
    expect(result.current.pending).toBe(true);
    // The next read is the one the queue emptying triggers; first prove a stale one is ignored.
    rerender({ id: "joey" });
    await act(async () => release([]));
    expect(result.current.spells).toHaveLength(1);
  });

  it("reads again once the queue empties, because the server then has the change", async () => {
    fetchSickDays.mockResolvedValueOnce([]).mockResolvedValue([spell({ id: "sk-new", startsOn: "2026-11-27", endsOn: "2026-11-27" })]);
    const { result } = renderHook(() => useMySick("joey"));
    await waitFor(() => expect(result.current.known).toBe(true));
    await act(async () => queue.listener?.([sickOp("sick.create")]));
    expect(result.current.pending).toBe(true);
    await act(async () => queue.listener?.([]));
    await waitFor(() => expect(result.current.spells.map((s) => s.id)).toEqual(["sk-new"]));
    expect(result.current.pending).toBe(false);
  });

  it("is pending only for call-in ops: a set waiting to send says nothing about it", async () => {
    fetchSickDays.mockResolvedValue([]);
    const { result } = renderHook(() => useMySick("joey"));
    await act(async () => queue.listener?.([newOp("set.create", {}, 0, "op-2")]));
    expect(result.current.pending).toBe(false);
  });

  it("does nothing without an athlete", async () => {
    const { result } = renderHook(() => useMySick(null));
    await act(async () => {
      await result.current.callIn({ startsOn: "2026-11-27", endsOn: "2026-11-27", note: "" });
      await result.current.end("2026-11-27");
    });
    expect(queued.create).not.toHaveBeenCalled();
    expect(fetchSickDays).not.toHaveBeenCalled();
    expect(result.current.known).toBe(false);
  });
});
