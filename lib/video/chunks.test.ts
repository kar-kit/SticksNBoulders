import { describe, expect, it } from "vitest";
import {
  CHUNK_BYTES,
  chunkRanges,
  contentRange,
  isComplete,
  percentDone,
  remainingChunks,
} from "./chunks";

const MB = 1024 * 1024;

describe("splitting a file into chunks", () => {
  it("uses the size Appwrite validates against", () => {
    expect(CHUNK_BYTES).toBe(5 * MB);
  });

  it("gives one chunk for a file under the limit", () => {
    expect(chunkRanges(1000)).toEqual([{ index: 0, start: 0, end: 999 }]);
  });

  it("covers every byte exactly once, with no gap and no overlap", () => {
    const size = 42 * MB + 137;
    const ranges = chunkRanges(size);
    expect(ranges[0].start).toBe(0);
    expect(ranges.at(-1)!.end).toBe(size - 1);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].start).toBe(ranges[i - 1].end + 1);
    }
    const covered = ranges.reduce((total, r) => total + (r.end - r.start + 1), 0);
    expect(covered).toBe(size);
  });

  /** The boundary that produces a phantom empty chunk if you get it wrong. */
  it("does not add an empty chunk when the size divides exactly", () => {
    const ranges = chunkRanges(3 * CHUNK_BYTES);
    expect(ranges).toHaveLength(3);
    expect(ranges.at(-1)!.end).toBe(3 * CHUNK_BYTES - 1);
  });

  it("has nothing to send for an empty file", () => {
    expect(chunkRanges(0)).toEqual([]);
    expect(chunkRanges(-1)).toEqual([]);
    expect(chunkRanges(Number.NaN)).toEqual([]);
  });

  it("writes the content-range header the way Appwrite wants it", () => {
    const [first] = chunkRanges(12 * MB);
    expect(contentRange(first, 12 * MB)).toBe(`bytes 0-${5 * MB - 1}/${12 * MB}`);
  });
});

describe("resuming", () => {
  const ranges = chunkRanges(22 * MB); // five chunks

  it("sends everything when nothing has landed", () => {
    expect(remainingChunks(ranges, 0)).toHaveLength(5);
    expect(remainingChunks(ranges, -1)).toHaveLength(5);
  });

  /**
   * chunksUploaded is a COUNT, not a map of which ranges landed. Sequential
   * upload is what makes "3" mean "chunks 0, 1 and 2 are in" rather than "some
   * three of them are".
   */
  it("picks up from where the server says it got to", () => {
    const rest = remainingChunks(ranges, 3);
    expect(rest).toHaveLength(2);
    expect(rest[0].index).toBe(3);
  });

  it("has nothing left when the server holds them all", () => {
    expect(remainingChunks(ranges, 5)).toEqual([]);
    // Past the end is not an error; a stale count must not produce a negative
    // slice and re-upload the whole file.
    expect(remainingChunks(ranges, 99)).toEqual([]);
  });

  it("reports progress as chunks that actually landed", () => {
    expect(percentDone(0, 5)).toBe(0);
    expect(percentDone(3, 5)).toBe(60);
    expect(percentDone(5, 5)).toBe(100);
    // A stale or nonsense count must not render 140%.
    expect(percentDone(7, 5)).toBe(100);
    expect(percentDone(-1, 5)).toBe(0);
    expect(percentDone(1, 0)).toBe(0);
  });

  it("knows when it is done", () => {
    expect(isComplete(5, 5)).toBe(true);
    expect(isComplete(4, 5)).toBe(false);
    expect(isComplete(0, 0)).toBe(false);
  });
});
