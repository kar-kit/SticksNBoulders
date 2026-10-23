import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteClipIfUnused } from "./clip-cleanup";

const appwrite = vi.hoisted(() => ({
  getRow: vi.fn<(p: { tableId: string; rowId: string }) => Promise<unknown>>(),
  deleteFile: vi.fn<(p: { bucketId: string; fileId: string }) => Promise<unknown>>(),
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: { getRow: appwrite.getRow },
    storage: { deleteFile: appwrite.deleteFile },
  }),
}));

const notFound = { code: 404, message: "not found" };

beforeEach(() => {
  appwrite.getRow.mockReset();
  appwrite.deleteFile.mockReset().mockResolvedValue({});
});

describe("deleteClipIfUnused", () => {
  it("deletes the file once its set has gone", async () => {
    appwrite.getRow.mockRejectedValue(notFound);
    await deleteClipIfUnused("st-1", "vid-1");
    expect(appwrite.getRow).toHaveBeenCalledWith({ databaseId: "db", tableId: "sets", rowId: "st-1" });
    expect(appwrite.deleteFile).toHaveBeenCalledWith({ bucketId: "set_videos", fileId: "vid-1" });
  });

  it("takes the clip's poster with it, and a clip with no poster is not an error (F12)", async () => {
    appwrite.getRow.mockRejectedValue(notFound);
    appwrite.deleteFile.mockImplementation(async (p) => {
      if (p.bucketId === "set_video_posters") throw notFound;
      return {};
    });
    await expect(deleteClipIfUnused("st-1", "vid-1")).resolves.toBeUndefined();
    expect(appwrite.deleteFile.mock.calls.map(([p]) => p)).toEqual([
      { bucketId: "set_videos", fileId: "vid-1" },
      { bucketId: "set_video_posters", fileId: "vid-1_poster" },
    ]);
  });

  it("keeps the clip of a set whose delete was refused -- the coach is still watching it", async () => {
    appwrite.getRow.mockResolvedValue({ $id: "st-1" });
    await deleteClipIfUnused("st-1", "vid-1");
    expect(appwrite.deleteFile).not.toHaveBeenCalled();
  });

  it("keeps the clip while the set still names it -- the detach in front has not landed", async () => {
    appwrite.getRow.mockResolvedValue({ $id: "st-1", video_file_id: "vid-1" });
    await deleteClipIfUnused("st-1", "vid-1");
    expect(appwrite.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes a clip the athlete deleted once the set no longer names it, poster too (F13)", async () => {
    appwrite.getRow.mockResolvedValue({ $id: "st-1", video_file_id: null });
    await deleteClipIfUnused("st-1", "vid-1");
    expect(appwrite.deleteFile.mock.calls.map(([p]) => p)).toEqual([
      { bucketId: "set_videos", fileId: "vid-1" },
      { bucketId: "set_video_posters", fileId: "vid-1_poster" },
    ]);
  });

  it("deletes a replaced clip once the set names the new one (F13)", async () => {
    appwrite.getRow.mockResolvedValue({ $id: "st-1", video_file_id: "vid-2" });
    await deleteClipIfUnused("st-1", "vid-1");
    expect(appwrite.deleteFile).toHaveBeenCalledWith({ bucketId: "set_videos", fileId: "vid-1" });
    expect(appwrite.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ fileId: "vid-2" }));
  });

  it("retries rather than guesses when the set cannot be read", async () => {
    appwrite.getRow.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(deleteClipIfUnused("st-1", "vid-1")).rejects.toThrow("Failed to fetch");
    expect(appwrite.deleteFile).not.toHaveBeenCalled();
  });

  it("counts a file already gone as done", async () => {
    appwrite.getRow.mockRejectedValue(notFound);
    appwrite.deleteFile.mockRejectedValue(notFound);
    await expect(deleteClipIfUnused("st-1", "vid-1")).resolves.toBeUndefined();
  });
});
