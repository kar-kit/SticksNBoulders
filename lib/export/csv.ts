/**
 * CSV that opens cleanly in Excel and Google Sheets.
 *
 * Constraint 6: CSV export exists because the competition is Excel. So the bar
 * is not "valid RFC 4180", it is "Ruairi double-clicks it and it looks right".
 * That means four things, each of which Excel gets wrong by default:
 *
 *   1. A UTF-8 byte order mark. Without it Excel on Windows reads the file as
 *      the system code page, and an athlete called Siobhán becomes SiobhÃ¡n.
 *      Sheets ignores the BOM, so it costs nothing there.
 *   2. Quoting. A note reading `felt heavy, "grindy"` with a line break in it
 *      is one cell, not three columns and a new row.
 *   3. CRLF between rows. Excel copes with LF; RFC 4180 says CRLF, and it is
 *      the one Excel has never mis-read.
 *   4. No formula injection. A note or a typed exercise name starting with
 *      `=`, `+`, `-` or `@` is executed as a formula when the file is opened.
 *      An athlete's note is text somebody else wrote, landing in the coach's
 *      spreadsheet, which is exactly the shape of that attack.
 *
 * Pure, no DOM. Numbers are written as numbers and never neutralised: a load is
 * never negative (the schema's min is 0), and prefixing a number with an
 * apostrophe would turn it into text that SUM ignores.
 */

/** U+FEFF. Written once, at the very start of the file. */
export const BOM = "﻿";
export const ROW_SEPARATOR = "\r\n";

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Characters that make a spreadsheet treat a cell as a formula. Tab and CR are
 * on OWASP's list too: some importers strip a leading tab and then evaluate
 * what follows it.
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Prefixes a leading apostrophe to text a spreadsheet would evaluate.
 *
 * The apostrophe is OWASP's recommendation and the convention both Excel and
 * Sheets already use for "this is text". It stays visible in the cell, which
 * is the honest trade: `'-felt good` is readable, `=HYPERLINK(...)` executed
 * is not.
 */
export function neutraliseFormula(text: string): string {
  return text.length > 0 && FORMULA_TRIGGERS.has(text[0]) ? `'${text}` : text;
}

/** Quote when the cell holds anything that would end it early. */
const NEEDS_QUOTES = /[",\r\n]/;

/** One cell, ready to write. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // NaN and Infinity have no spreadsheet meaning; an empty cell is honest.
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const safe = neutraliseFormula(value);
  return NEEDS_QUOTES.test(safe) || safe !== safe.trim()
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

/** One row, without its line ending. */
export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(",");
}

/** A whole file as one string. For tests and small exports. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return BOM + lines.join(ROW_SEPARATOR) + ROW_SEPARATOR;
}

export interface ChunkOptions {
  /** Rows per chunk. Each chunk is followed by a yield to the event loop. */
  rowsPerChunk?: number;
  /** How to give the main thread back. Injected so tests do not wait. */
  yieldToMain?: () => Promise<void>;
}

/**
 * Hands the main thread back so a tap or a scroll can be handled.
 *
 * `scheduler.yield` where the browser has it, which resumes ahead of other
 * queued tasks; a zero-length timeout everywhere else, including Safari.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The same file as `toCsv`, as a list of string parts built a chunk at a time.
 *
 * Two reasons this exists rather than one big string. It yields between
 * chunks, so a two-year log on a mid-range phone never holds the main thread
 * long enough to drop a frame's worth of input. And the parts go straight into
 * a Blob, which concatenates them natively instead of JavaScript building one
 * multi-megabyte string and copying it on every `+=`.
 */
export async function toCsvParts(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  { rowsPerChunk = 500, yieldToMain: yieldFn = yieldToMain }: ChunkOptions = {},
): Promise<string[]> {
  const parts = [BOM + csvRow(header) + ROW_SEPARATOR];
  for (let start = 0; start < rows.length; start += rowsPerChunk) {
    const end = Math.min(start + rowsPerChunk, rows.length);
    let chunk = "";
    for (let i = start; i < end; i++) chunk += csvRow(rows[i]) + ROW_SEPARATOR;
    parts.push(chunk);
    if (end < rows.length) await yieldFn();
  }
  return parts;
}
