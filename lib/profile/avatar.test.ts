// @vitest-environment node
import sharp from "sharp";
import { AVATAR_SIZE, MAX_AVATAR_BYTES, prepareAvatar, squareCrop, type PipelineDeps, type SquareCrop } from "./avatar";

describe("the centred square", () => {
  it.each<[number, number, SquareCrop]>([
    // A portrait phone photo, already upright: the square is the middle band.
    [3024, 4032, { sx: 0, sy: 504, side: 3024 }],
    // The same photo, landscape.
    [4032, 3024, { sx: 504, sy: 0, side: 3024 }],
    [512, 512, { sx: 0, sy: 0, side: 512 }],
    // Odd difference: whole pixels, never a half-pixel edge to resample.
    [101, 100, { sx: 0, sy: 0, side: 100 }],
    [100, 103, { sx: 0, sy: 1, side: 100 }],
    // Smaller than the target: cropped, then scaled up rather than refused.
    [300, 200, { sx: 50, sy: 0, side: 200 }],
  ])("%ix%i -> %o", (width, height, expected) => {
    expect(squareCrop(width, height)).toEqual(expected);
  });

  it("stays inside the image", () => {
    for (const [w, h] of [[1, 9999], [9999, 1], [37, 41]]) {
      const { sx, sy, side } = squareCrop(w, h);
      expect(sx + side).toBeLessThanOrEqual(w);
      expect(sy + side).toBeLessThanOrEqual(h);
    }
  });

  it("refuses something that is not an image size", () => {
    expect(() => squareCrop(0, 100)).toThrow();
    expect(() => squareCrop(Number.NaN, 100)).toThrow();
  });
});

/**
 * The pipeline with a real image library standing in for the browser's
 * canvas. jsdom has none, and a canvas mocked to return "a 512x512 blob" would
 * only prove the mock. sharp honours EXIF orientation the way
 * `createImageBitmap(..., { imageOrientation: "from-image" })` does, and
 * encodes real WebP, so what comes out can be measured.
 */
interface SharpDecoded {
  width: number;
  height: number;
  buffer: Buffer;
}

const sharpPipeline = (options: { webp?: boolean } = {}): PipelineDeps<SharpDecoded> => ({
  decode: async (file) => {
    // .rotate() with no angle applies the EXIF orientation and drops the tag.
    const { data, info } = await sharp(Buffer.from(await file.arrayBuffer())).rotate().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, buffer: data };
  },
  encode: async (source, crop, size, type) => {
    // A browser without WebP encoding hands back PNG; so does this, on request.
    if (type === "image/webp" && options.webp === false) {
      return new Blob([new Uint8Array(await sharp(source.buffer).png().toBuffer())], { type: "image/png" });
    }
    const pipeline = sharp(source.buffer)
      .extract({ left: crop.sx, top: crop.sy, width: crop.side, height: crop.side })
      .resize(size, size);
    const out = type === "image/webp" ? await pipeline.webp().toBuffer() : await pipeline.jpeg().toBuffer();
    return new Blob([new Uint8Array(out)], { type });
  },
});

/**
 * A phone photo as the camera stores it: landscape pixels, with EXIF
 * orientation 6 ("rotate 90 clockwise to view"). Left half red, right half
 * blue -- so upright, the TOP is red and the bottom blue.
 */
async function rotatedPhonePhoto(width = 1200, height = 600): Promise<Blob> {
  const half = await sharp({ create: { width: width / 2, height, channels: 3, background: "#0000ff" } }).png().toBuffer();
  const jpeg = await sharp({ create: { width, height, channels: 3, background: "#ff0000" } })
    .composite([{ input: half, left: width / 2, top: 0 }])
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
}

async function pixel(blob: Blob, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

const reddish = ([r, g, b]: number[]) => r > 180 && g < 80 && b < 80;
const bluish = ([r, g, b]: number[]) => b > 180 && r < 80 && g < 80;

describe("preparing a phone photo for upload", () => {
  it("turns a sideways, non-square photo into an upright 512px square WebP under the cap", async () => {
    const prepared = await prepareAvatar(await rotatedPhonePhoto(), sharpPipeline());
    if (!prepared.ok) throw new Error(prepared.message);

    expect(prepared.type).toBe("image/webp");
    expect(prepared.blob.type).toBe("image/webp");
    expect(prepared.blob.size).toBeLessThan(MAX_AVATAR_BYTES);
    const meta = await sharp(Buffer.from(await prepared.blob.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", AVATAR_SIZE, AVATAR_SIZE]);

    // Upright: red on top, blue below. Ignoring the EXIF flag would put the
    // colours side by side and make the top-centre pixel the boundary or blue.
    expect(reddish(await pixel(prepared.blob, 256, 40))).toBe(true);
    expect(bluish(await pixel(prepared.blob, 256, 470))).toBe(true);
  });

  it("falls back to JPEG when the browser hands back PNG for WebP", async () => {
    const prepared = await prepareAvatar(await rotatedPhonePhoto(), sharpPipeline({ webp: false }));
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.type).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await prepared.blob.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", AVATAR_SIZE, AVATAR_SIZE]);
  });

  it("says plainly when the photo cannot be opened, as HEIC on most desktop browsers", async () => {
    const prepared = await prepareAvatar(new Blob([new Uint8Array([1, 2, 3])], { type: "image/heic" }), sharpPipeline());
    expect(prepared).toEqual({ ok: false, message: "That photo couldn't be opened here. Try a JPEG or PNG." });
  });

  it("refuses rather than uploads when an encoder produces something over the bucket's cap", async () => {
    const huge: PipelineDeps = {
      decode: async () => ({ width: 4000, height: 3000 }),
      encode: async (_s, _c, _n, type) => new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type }),
    };
    expect((await prepareAvatar(new Blob(), huge)).ok).toBe(false);
  });

  it("lets go of the decoded image either way", async () => {
    const close = vi.fn();
    const deps: PipelineDeps = {
      decode: async () => ({ width: 10, height: 10, close }),
      encode: async () => null,
    };
    await prepareAvatar(new Blob(), deps);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
