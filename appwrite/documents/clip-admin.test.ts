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
});
