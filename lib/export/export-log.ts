import { toCsvParts, type ChunkOptions } from "./csv";
import { buildLogRows, exportFileName, LOG_COLUMNS } from "./training-log";
import { fetchTrainingLog, type RowReader } from "./training-log-store";

/**
 * Fetch, shape, serialise: the whole export short of handing the file over.
 *
 * Separate from the download step so the e2e script can run it end to end in
 * Node and read the bytes a coach would get.
 */

export interface BuiltExport {
  fileName: string;
  /** Pass straight to `new Blob(parts)`. The first part starts with the BOM. */
  parts: string[];
  setCount: number;
  sessionCount: number;
  skipped: number;
}

export async function buildTrainingLogExport(
  reader: RowReader,
  databaseId: string,
  athlete: { id: string; name: string | null },
  options: ChunkOptions & { today?: Date } = {},
): Promise<BuiltExport> {
  const log = await fetchTrainingLog(reader, databaseId, athlete.id);
  const rows = buildLogRows(log.sessions, log.sets, log.exerciseNames);
  const parts = await toCsvParts(LOG_COLUMNS, rows, options);
  const sessionCount = new Set(log.sets.map((set) => set.sessionId)).size;
  return {
    fileName: exportFileName(athlete.name, options.today),
    parts,
    setCount: rows.length,
    sessionCount,
    skipped: log.skipped,
  };
}

/**
 * Hands the file to the person.
 *
 * On a phone, the share sheet when it can take a file: an iPhone PWA opened
 * from the home screen ignores `<a download>` for blobs and shows the CSV as a
 * page of text, and the share sheet is where "Save to Files", Mail and Drive
 * live. On a laptop, a plain download, because a coach at his desk expects a
 * file in Downloads, not a share dialog.
 *
 * Returns false if the person dismissed the share sheet, which is not an error.
 */
export async function deliverFile(
  fileName: string,
  parts: readonly string[],
  { preferShare }: { preferShare: boolean },
): Promise<boolean> {
  const type = "text/csv;charset=utf-8";
  const blob = new Blob([...parts], { type });

  if (preferShare && typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    const file = new File([blob], fileName, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName });
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false;
        // Anything else -- a browser that claims support and then refuses --
        // falls through to the plain download rather than failing the export.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay: some browsers start the download asynchronously and
  // a URL revoked in the same tick downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
