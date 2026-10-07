/**
 * Turning a phone photo into a profile picture, in the browser, before upload.
 *
 * Three jobs, and the reason each is done here rather than on the server:
 *
 *   - Rotation. A portrait iPhone photo is stored landscape with an EXIF flag
 *     saying "turn me". Decoding with `imageOrientation: "from-image"` applies
 *     the flag, so the face is upright before anything else happens; skipping
 *     it is how a profile picture ends up on its side.
 *   - Size. A 12MP original is 3-5MB. Cropped to a centred square and redrawn
 *     at 512px it is tens of kilobytes, which is what a coach's rail of eight
 *     faces should cost on 4G.
 *   - Format. HEIC goes in, WebP comes out (JPEG where the browser cannot
 *     encode WebP), so the bucket only ever holds two formats every browser
 *     can show.
 *
 * The arithmetic is pure and tested on its own. The canvas calls are injected,
 * because jsdom has no canvas and a test that mocked one to return a 512x512
 * blob would be asserting its own mock.
 */

/** Square edge of every stored picture, in pixels. Twice the largest place it is drawn. */
export const AVATAR_SIZE = 512;

/** Matches the bucket's cap in appwrite/schema. A redrawn 512px image is far below it. */
export const MAX_AVATAR_BYTES = 2_000_000;

const QUALITY = 0.85;

export interface SquareCrop {
  /** Where the square starts in the source, in source pixels. */
  sx: number;
  sy: number;
  /** Its edge, in source pixels: the shorter side, so nothing is letterboxed. */
  side: number;
}

/**
 * The largest centred square inside a width x height image.
 *
 * Centred because a face is usually in the middle of a photo somebody took of
 * themselves, and asking them to drag a crop box one-handed is a screen nobody
 * finishes. Whole pixels, so the canvas never resamples a half-pixel edge.
 */
export function squareCrop(width: number, height: number): SquareCrop {
  if (!(width > 0 && height > 0)) throw new Error(`squareCrop: not an image size ${width}x${height}`);
  const side = Math.floor(Math.min(width, height));
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  };
}

export type AvatarType = "image/webp" | "image/jpeg";

export const extensionFor = (type: AvatarType): string => (type === "image/webp" ? "webp" : "jpg");

/** A decoded picture, already upright. */
export interface Decoded {
  width: number;
  height: number;
  close?: () => void;
}

export interface PipelineDeps<D extends Decoded = Decoded> {
  /** Decodes with EXIF orientation applied. */
  decode: (file: Blob) => Promise<D>;
  /** Draws `crop` of `source` into a `size` square and encodes it, or null if the browser cannot. */
  encode: (source: D, crop: SquareCrop, size: number, type: AvatarType, quality: number) => Promise<Blob | null>;
}

export type PreparedAvatar = { ok: true; blob: Blob; type: AvatarType } | { ok: false; message: string };

/**
 * The upload-ready picture, or a plain reason it cannot be made.
 *
 * WebP first. A browser that cannot encode WebP (Safari before 17) quietly
 * hands back a PNG instead of failing, so the blob's type is checked rather
 * than trusted, and JPEG is the fallback every browser has.
 */
export async function prepareAvatar<D extends Decoded>(file: Blob, deps: PipelineDeps<D>): Promise<PreparedAvatar> {
  let source: D;
  try {
    source = await deps.decode(file);
  } catch {
    // Chrome on Android and every desktop browser bar Safari cannot decode
    // HEIC. iOS converts on pick, so this is mostly a desktop with a file
    // AirDropped from a phone.
    return { ok: false, message: "That photo couldn't be opened here. Try a JPEG or PNG." };
  }
  try {
    const crop = squareCrop(source.width, source.height);
    for (const type of ["image/webp", "image/jpeg"] as const) {
      const blob = await deps.encode(source, crop, AVATAR_SIZE, type, QUALITY);
      if (!blob || blob.type !== type) continue;
      if (blob.size > MAX_AVATAR_BYTES) {
        return { ok: false, message: "That photo is too large even after resizing. Try another." };
      }
      return { ok: true, blob, type };
    }
    return { ok: false, message: "This browser couldn't resize that photo. Try another browser." };
  } finally {
    source.close?.();
  }
}

/**
 * The real decode and encode, for the browser.
 *
 * `createImageBitmap` with `imageOrientation: "from-image"` is the one call
 * that both decodes and honours EXIF on every current browser; drawing an
 * `<img>` relies on CSS `image-orientation`, which a canvas does not consult
 * in older Safari.
 */
export const browserPipeline: PipelineDeps<ImageBitmap> = {
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  encode: async (source, crop, size, type, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  },
};
