import { reviewPermissions } from "./policy";
import { requeueReview, stampReviewClip } from "./review-admin";
import type { RowWriter } from "./row-writer";

function fake() {
  const calls: Array<{ op: string; params: unknown }> = [];
  const writer: RowWriter = {
    createRow: async (params) => (calls.push({ op: "create", params }), { $id: params.rowId }),
    updateRow: async (params) => (calls.push({ op: "update", params }), { $id: params.rowId }),
    deleteRow: async (params) => (calls.push({ op: "delete", params }), {}),
  };
  return { writer, calls };
}

describe("the v18 review backfill's writes", () => {
  it("stamps only the clip id, restating the review's own permissions", async () => {
    const { writer, calls } = fake();
    await stampReviewClip(writer, "db", { rowId: "r1", athleteId: "joey", coachId: "ruairi", videoFileId: "take-1" });
    expect(calls).toEqual([
      {
        op: "update",
        params: {
          databaseId: "db",
          tableId: "set_reviews",
          rowId: "r1",
          data: { video_file_id: "take-1" },
          permissions: reviewPermissions({ athleteId: "joey", coachId: "ruairi" }),
        },
      },
    ]);
  });

  it("refuses to stamp without every id", async () => {
    const { writer, calls } = fake();
    await expect(
      stampReviewClip(writer, "db", { rowId: "r1", athleteId: "joey", coachId: "", videoFileId: "take-1" }),
    ).rejects.toThrow(/required/);
    expect(calls).toEqual([]);
  });

  it("re-queues by deleting the review row, as the coach's Undo does", async () => {
    const { writer, calls } = fake();
    await requeueReview(writer, "db", "r2");
    expect(calls).toEqual([{ op: "delete", params: { databaseId: "db", tableId: "set_reviews", rowId: "r2" } }]);
  });
});
