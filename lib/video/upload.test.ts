import { MAX_UPLOAD_ATTEMPTS, attachClipToSet, resumeInterruptedUploads } from "./upload";
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
  store.rememberUpload.mockResolvedValue(undefined);
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

describe("attaching a fresh clip to a set", () => {
  const clip = (name = "squat.mp4", bytes = 1024) =>
    new File([new Uint8Array(bytes)], name, { type: "video/mp4" });

  /** The id the upload chose, read from what was remembered before it began. */
  const rememberedId = (): string => store.rememberUpload.mock.calls[0][0].fileId;

  it("records the clip on the set once the upload lands", async () => {
    transport.uploadResumable.mockImplementation(async (_blob, { fileId }) => ({ ok: true, fileId }));

    const result = await attachClipToSet("set-1", "joey", clip());

    const fileId = rememberedId();
    expect(result).toEqual({ ok: true, fileId });
    // Through the queue, keyed to the same id the upload used.
    expect(offline.enqueue).toHaveBeenCalledWith("set.attachVideo", { setId: "set-1", videoFileId: fileId });
    expect(transport.uploadResumable.mock.calls[0][1]).toMatchObject({ fileId, athleteId: "joey" });
    expect(store.forgetUpload).toHaveBeenCalledWith(fileId);
  });

  /**
   * Remembered before the first byte, so a phone locked mid-upload leaves
   * something for the next app start to find.
   */
  it("remembers the upload before sending anything", async () => {
    transport.uploadResumable.mockImplementation(async (_blob, { fileId }) => ({ ok: true, fileId }));
    await attachClipToSet("set-1", "joey", clip());

    expect(store.rememberUpload.mock.calls[0][0]).toMatchObject({ setId: "set-1", athleteId: "joey", attempts: 1 });
    expect(store.rememberUpload.mock.invocationCallOrder[0]).toBeLessThan(
      transport.uploadResumable.mock.invocationCallOrder[0],
    );
  });

  it("keeps a clip that failed for a retryable reason, and does not record it yet", async () => {
    transport.uploadResumable.mockResolvedValue({ ok: false, retryable: true, message: "network", uploadedCount: 2 });

    const result = await attachClipToSet("set-1", "joey", clip());

    expect(result).toMatchObject({ ok: false, reason: "failed" });
    // Said as reassurance, not the raw transport error: the set is saved.
    expect((result as { message: string }).message).toContain("carry on by itself");
    expect(store.forgetUpload).not.toHaveBeenCalled();
    expect(offline.enqueue).not.toHaveBeenCalled();
  });

  it("drops a clip the server refused, and passes on why", async () => {
    transport.uploadResumable.mockResolvedValue({
      ok: false,
      retryable: false,
      message: "File extension not allowed",
      uploadedCount: 0,
    });

    const result = await attachClipToSet("set-1", "joey", clip());

    expect(result).toEqual({ ok: false, reason: "failed", message: "File extension not allowed" });
    expect(store.forgetUpload).toHaveBeenCalledWith(rememberedId());
    expect(offline.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a video without remembering or sending it", async () => {
    const result = await attachClipToSet("set-1", "joey", clip("program.pdf"));

    expect(result).toMatchObject({ ok: false, reason: "type" });
    expect(store.rememberUpload).not.toHaveBeenCalled();
    expect(transport.uploadResumable).not.toHaveBeenCalled();
  });
});
