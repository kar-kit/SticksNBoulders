import type { ClearedOrphan } from "../backup/orphans";
import type { PrunableOriginal } from "../backup/prune";
import { deleteOrphanClip, deletePrunedOriginal, deleteWorkerProxy, type ClipStore } from "./clip-admin";

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

describe("the proxy worker's deletes (v22)", () => {
  it("deletes a pruned original in the clip bucket, from a PrunableOriginal only", async () => {
    const { store, deleted } = recordingStore();
    // By hand for the same reason as above: clearForPrune is the one source.
    const original = { bucketId: "set_videos", $id: "clipA", proxyId: "clipA_proxy", setId: "s1" } as PrunableOriginal;
    await deletePrunedOriginal(store, original);
    expect(deleted).toEqual([{ bucketId: "set_videos", fileId: "clipA" }]);
  });

  it("deletes a rejected proxy only in the proxy bucket, and only the named clip's", async () => {
    const { store, deleted } = recordingStore();
    await deleteWorkerProxy(store, { clipFileId: "clipA", proxyId: "clipA_proxy" });
    expect(deleted).toEqual([{ bucketId: "set_video_proxies", fileId: "clipA_proxy" }]);

    await expect(deleteWorkerProxy(store, { clipFileId: "clipA", proxyId: "clipB_proxy" })).rejects.toThrow(/not the proxy/);
    await expect(deleteWorkerProxy(store, { clipFileId: "clipA", proxyId: "clipA" })).rejects.toThrow(/not the proxy/);
    expect(deleted).toHaveLength(1);
  });
});
