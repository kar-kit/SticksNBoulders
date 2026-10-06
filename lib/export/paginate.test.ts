import { chunk, fetchAllPages } from "./paginate";

const rowsNamed = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ $id: `r${String(i).padStart(6, "0")}` }));

/** A fake table that honours limit and cursorAfter the way Appwrite does. */
function fakeTable(total: number) {
  const all = rowsNamed(total);
  const calls: Array<{ cursor: string | null; limit: number }> = [];
  const fetchPage = async (cursor: string | null, limit: number) => {
    calls.push({ cursor, limit });
    const start = cursor ? all.findIndex((row) => row.$id === cursor) + 1 : 0;
    return { rows: all.slice(start, start + limit) };
  };
  return { all, calls, fetchPage };
}

describe("fetchAllPages", () => {
  it("reads past the first page -- the bug an export must not have", async () => {
    const table = fakeTable(1234);
    const rows = await fetchAllPages(table.fetchPage, { pageSize: 500 });
    expect(rows).toHaveLength(1234);
    expect(rows).toEqual(table.all);
  });

  it("moves the cursor to the last row of each page", async () => {
    const table = fakeTable(1234);
    await fetchAllPages(table.fetchPage, { pageSize: 500 });
    expect(table.calls.map((c) => c.cursor)).toEqual([null, "r000499", "r000999"]);
  });

  it("stops on a short page without an extra empty round trip", async () => {
    const table = fakeTable(1234);
    await fetchAllPages(table.fetchPage, { pageSize: 500 });
    expect(table.calls).toHaveLength(3);
  });

  it("pays one empty round trip when the total is an exact multiple", async () => {
    const table = fakeTable(1000);
    const rows = await fetchAllPages(table.fetchPage, { pageSize: 500 });
    expect(rows).toHaveLength(1000);
    expect(table.calls).toHaveLength(3);
  });

  it("returns nothing for an empty table in one call", async () => {
    const table = fakeTable(0);
    expect(await fetchAllPages(table.fetchPage)).toEqual([]);
    expect(table.calls).toHaveLength(1);
  });

  it("throws rather than looping when the cursor does not advance", async () => {
    const stuck = async () => ({ rows: rowsNamed(10) });
    await expect(fetchAllPages(stuck, { pageSize: 10 })).rejects.toThrow(/did not advance/);
  });

  it("throws at the page ceiling rather than running forever", async () => {
    let n = 0;
    const endless = async () => ({ rows: [{ $id: `x${n++}` }] });
    await expect(fetchAllPages(endless, { pageSize: 1, maxPages: 5 })).rejects.toThrow(/5 pages/);
  });

  it("propagates a failed page instead of returning a partial log", async () => {
    let calls = 0;
    const flaky = async () => {
      if (calls++ === 1) throw new Error("network");
      return { rows: rowsNamed(2) };
    };
    await expect(fetchAllPages(flaky, { pageSize: 2 })).rejects.toThrow("network");
  });
});

describe("chunk", () => {
  it("splits into runs of at most the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("refuses a size below one", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
