import type { ClearedOrphan } from "../backup/orphans";
import { deleteOrphanClip, type ClipStore } from "./clip-admin";

function recordingStore() {
  const deleted: Array<{ bucketId: string; fileId: string }> = [];
  const store: ClipStore = {
    async deleteFile(params) {
      deleted.push(params);
      return {};
    },
  };
  return { store, deleted };
}

describe("deleting an orphaned clip", () => {
  it("deletes exactly the cleared file", async () => {
    const { store, deleted } = recordingStore();
    // Built by hand here only because the test is about this function; in the
    // product, clearForDeletion is the one place a ClearedOrphan comes from.
    const orphan = { bucketId: "set_videos", $id: "clipA", sizeOriginal: 4, coveredBy: "dump" } as ClearedOrphan;

    await deleteOrphanClip(store, orphan);

    expect(deleted).toEqual([{ bucketId: "set_videos", fileId: "clipA" }]);
  });

  it("will not take a bare file id, only something a backup has cleared", async () => {
    const { store, deleted } = recordingStore();
    // @ts-expect-error -- the point of the ClearedOrphan type.
    await deleteOrphanClip(store, { bucketId: "set_videos", $id: "clipA", sizeOriginal: 4, coveredBy: "dump" });
    // It would still run if forced past the compiler; the guarantee is the type.
    expect(deleted).toHaveLength(1);
  });
});
