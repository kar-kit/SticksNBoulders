/**
 * Reading every row, not the first page of them.
 *
 * Appwrite returns 25 rows unless told otherwise and caps what it will return
 * in one call, so an export that forgets to page silently ships the first few
 * weeks of somebody's training and looks complete. That is the worst kind of
 * bug for an export: nobody notices until the spreadsheet disagrees with the
 * app.
 *
 * Cursor pagination, not offset. An offset re-scans every row it skips, which
 * gets slower the further back an athlete's history goes; a cursor is an index
 * seek, and it does not skip or repeat a row if a set lands mid-export.
 */

export interface Page<Row> {
  rows: Row[];
}

/** Anything with an id to put the cursor on. */
export interface Identified {
  $id: string;
}

export interface PaginateOptions {
  pageSize?: number;
  /**
   * A ceiling on round trips, so a bug that returned the same page forever
   * ends in an error rather than a phone that never finishes. At 500 rows a
   * page this is five million rows.
   */
  maxPages?: number;
}

/**
 * Calls `fetchPage` until a short page comes back, and returns every row.
 *
 * `fetchPage(cursor, limit)` gets the id of the last row it returned, or null
 * for the first call, and must order by something stable (the callers order by
 * `$id`). A page shorter than the limit is the last one, which saves the empty
 * round trip that a "stop when zero rows" loop always pays.
 */
export async function fetchAllPages<Row extends Identified>(
  fetchPage: (cursor: string | null, limit: number) => Promise<Page<Row>>,
  { pageSize = 500, maxPages = 10_000 }: PaginateOptions = {},
): Promise<Row[]> {
  const all: Row[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { rows } = await fetchPage(cursor, pageSize);
    all.push(...rows);
    if (rows.length < pageSize) return all;

    const last = rows[rows.length - 1].$id;
    if (last === cursor) throw new Error("Pagination did not advance: the same cursor came back twice.");
    cursor = last;
  }
  throw new Error(`Pagination stopped after ${maxPages} pages without reaching the end.`);
}

/** Splits a list into runs of at most `size`, for IN queries with a length cap. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk: size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
