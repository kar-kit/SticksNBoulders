import { MAX_UPLOAD_ATTEMPTS, resumeInterruptedUploads } from "./upload";
import type { PendingUpload } from "./pending-store";

const store = vi.hoisted(() => ({
  pendingUploads: vi.fn(),
  forgetUpload: vi.fn(),
  recordAttempt: vi.fn(),
  rememberUpload: vi.fn(),
}));
vi.mock("./pending-store", () => store);

const transport = vi.hoisted(() => ({ uploadResumable: vi.fn() }));
vi.mock("./resumable-upload", () => transport);

const offline = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/offline/client", () => offline);

const pending = (over: Partial<PendingUpload> = {}): PendingUpload => ({
  fileId: "file-1",
  setId: "set-1",
  athleteId: "joey",
  name: "clip.mp4",
  type: "video/mp4",
  size: 20_000_000,
  blob: new Blob(["x"]),
  startedAt: Date.now(),
  attempts: 1,
  ...over,
});

beforeEach(() => {
  // Braced: a concise arrow returns the mock, and Vitest calls a hook's
  // return value as teardown.
  vi.clearAllMocks();
  store.pendingUploads.mockResolvedValue([]);
  store.forgetUpload.mockResolvedValue(undefined);
  store.recordAttempt.mockResolvedValue(undefined);
  offline.enqueue.mockResolvedValue(undefined);
});

describe("picking up an interrupted upload", () => {
  it("does nothing when there is nothing pending", async () => {
    expect(await resumeInterruptedUploads()).toEqual({ resumed: 0, failed: 0 });
    expect(transport.uploadResumable).not.toHaveBeenCalled();
  });

  /**
   * The whole point: a locked phone or a killed tab costs the remaining
   * chunks, not the file. The transport asks the server where it got to.
   */
  it("finishes the clip and records it on the set", async () => {
    store.pendingUploads.mockResolvedValue([pending()]);
    transport.uploadResumable.mockResolvedValue({ ok: true, fileId: "file-1" });

    expect(await resumeInterruptedUploads()).toEqual({ resumed: 1, failed: 0 });
    expect(offline.enqueue).toHaveBeenCalledWith("set.attachVideo", {
      setId: "set-1",
      videoFileId: "file-1",
    });
    expect(store.forgetUpload).toHaveBeenCalledWith("file-1");
  });

  it("counts the attempt before trying, so a crash mid-upload still counts", async () => {
    store.pendingUploads.mockResolvedValue([pending()]);
    transport.uploadResumable.mockResolvedValue({ ok: true, fileId: "file-1" });

    await resumeInterruptedUploads();
    expect(store.recordAttempt).toHaveBeenCalledWith("file-1");
    expect(store.recordAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      transport.uploadResumable.mock.invocationCallOrder[0],
    );
  });

  it("keeps a clip that failed for a retryable reason, for next time", async () => {
    store.pendingUploads.mockResolvedValue([pending()]);
    transport.uploadResumable.mockResolvedValue({
      ok: false,
      retryable: true,
      message: "network",
      uploadedCount: 2,
    });

    expect(await resumeInterruptedUploads()).toEqual({ resumed: 0, failed: 1 });
    expect(store.forgetUpload).not.toHaveBeenCalled();
    expect(offline.enqueue).not.toHaveBeenCalled();
  });

  /**
   * A file the server will never accept must not sit in a phone's quota being
   * retried forever. Retrying a 4xx is a loop, not resilience.
   */
  it("drops a clip the server rejected permanently", async () => {
    store.pendingUploads.mockResolvedValue([pending()]);
    transport.uploadResumable.mockResolvedValue({
      ok: false,
      retryable: false,
      message: "File size not allowed",
      uploadedCount: 0,
    });

    expect(await resumeInterruptedUploads()).toEqual({ resumed: 0, failed: 1 });
    expect(store.forgetUpload).toHaveBeenCalledWith("file-1");
  });

  it("abandons a clip that has already failed too many times", async () => {
    store.pendingUploads.mockResolvedValue([pending({ attempts: MAX_UPLOAD_ATTEMPTS })]);

    expect(await resumeInterruptedUploads()).toEqual({ resumed: 0, failed: 1 });
    // Not even attempted -- tens of megabytes should not be re-sent forever.
    expect(transport.uploadResumable).not.toHaveBeenCalled();
    expect(store.forgetUpload).toHaveBeenCalledWith("file-1");
  });

  it("carries on through the rest when one clip fails", async () => {
    store.pendingUploads.mockResolvedValue([
      pending({ fileId: "bad", setId: "set-a" }),
      pending({ fileId: "good", setId: "set-b" }),
    ]);
    transport.uploadResumable
      .mockResolvedValueOnce({ ok: false, retryable: true, message: "x", uploadedCount: 1 })
      .mockResolvedValueOnce({ ok: true, fileId: "good" });

    expect(await resumeInterruptedUploads()).toEqual({ resumed: 1, failed: 1 });
    expect(offline.enqueue).toHaveBeenCalledWith("set.attachVideo", {
      setId: "set-b",
      videoFileId: "good",
    });
  });
});
