/**
 * One still from a clip, on the phone, before it leaves (F12, schema v17).
 *
 * Appwrite previews are image-only, so a clip has no thumbnail unless someone
 * makes one. The phone already holds the file, already decodes it to show the
 * picker, and is the only place a poster costs no server work, so it is made
 * here: a hidden `<video>` on a blob URL, seeked a fraction of a second in,
 * drawn onto a canvas at thumbnail size and encoded as WebP (JPEG where the
 * browser cannot encode WebP, as with profile pictures).
 *
 * Best effort, always. A frame grab that fails -- a codec this browser cannot
 * decode, a phone that refuses to seek a video it is not playing, a timeout --
 * yields null and the clip goes up without a poster. The set row then shows
 * the placeholder, and `npm run clips:posters` can make one later with ffmpeg.
 * Nothing here may delay or fail the clip, let alone the set.
 *
 * The arithmetic is pure and tested; the media calls are injected, because
 * jsdom has neither a decoder nor a canvas and a test that mocked both would
 * be asserting its own mock (the same split as lib/profile/avatar.ts).
 */

/** The longer edge of every poster, in pixels. Several times the largest place one is drawn. */
export const POSTER_EDGE = 320;

/** The bucket's cap in appwrite/schema. A 320px frame is a few tens of kilobytes. */
export const MAX_POSTER_BYTES = 1_000_000;

/** A frame grab that has not finished by now is not going to. */
export const CAPTURE_TIMEOUT_MS = 8_000;

const QUALITY = 0.7;

export type PosterType = "image/webp" | "image/jpeg";

export const posterExtension = (type: PosterType): string => (type === "image/webp" ? "webp" : "jpg");

/**
 * Thumbnail dimensions for a `width` x `height` video: the longer edge at
 * POSTER_EDGE, aspect kept, never upscaled, whole even pixels.
 *
 * Even, because some encoders round odd edges and a 1px seam on a thumbnail is
 * the kind of thing that reads as a bug. Null for a size that is not one --
 * a video whose metadata never arrived reports 0x0.
 */
export function posterSize(width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const scale = Math.min(1, POSTER_EDGE / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Where in the clip to take the frame, in seconds.
 *
 * Not zero: the first frame of a phone clip is often black or a smear while
 * exposure settles. Half a second in, or a third of the way through a clip
 * shorter than a second and a half. A duration the browser does not know
 * (NaN, Infinity -- some WebM files from MediaRecorder) gets a small fixed
 * offset, which every real clip is longer than.
 */
export function posterSeekTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.1;
  return Math.min(0.5, duration / 3);
}

/** A loaded video, ready to seek. */
export interface LoadedVideo {
  width: number;
  height: number;
  duration: number;
}

export interface CaptureDeps<V extends LoadedVideo = LoadedVideo> {
  /** Loads the clip far enough to know its size. Rejects if it cannot be decoded. */
  load: (clip: Blob) => Promise<V>;
  /** Seeks and resolves once that frame can be drawn. */
  seek: (video: V, seconds: number) => Promise<void>;
  /** Draws the current frame at `size` and encodes it, or null if the browser cannot. */
  encode: (video: V, size: { width: number; height: number }, type: PosterType, quality: number) => Promise<Blob | null>;
  /** Releases the element and the blob URL. Always called. */
  release: (video: V) => void;
}

export type Poster = { blob: Blob; type: PosterType };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`poster capture timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * The poster for a clip, or null. Never throws.
 *
 * WebP first, then JPEG. A browser that cannot encode WebP (Safari, including
 * iOS) hands back a PNG instead of failing, so the blob's type is checked
 * rather than trusted -- and a PNG would be refused by the bucket anyway.
 */
export async function capturePoster<V extends LoadedVideo>(
  clip: Blob,
  deps: CaptureDeps<V>,
  timeoutMs: number = CAPTURE_TIMEOUT_MS,
): Promise<Poster | null> {
  let video: V | null = null;
  const work = (async (): Promise<Poster | null> => {
    video = await deps.load(clip);
    const size = posterSize(video.width, video.height);
    if (!size) return null;
    await deps.seek(video, posterSeekTime(video.duration));
    for (const type of ["image/webp", "image/jpeg"] as const) {
      const blob = await deps.encode(video, size, type, QUALITY);
      if (!blob || blob.type !== type || blob.size === 0) continue;
      return blob.size > MAX_POSTER_BYTES ? null : { blob, type };
    }
    return null;
  })();
  try {
    return await withTimeout(work, timeoutMs);
  } catch (error) {
    console.warn("poster: could not capture a frame; the clip goes without one", error);
    return null;
  } finally {
    // After a timeout the work may still hold the element; release it once
    // it settles, so a slow decoder does not keep a 100MB blob URL alive.
    if (video) deps.release(video);
    else void work.then(() => video && deps.release(video), () => video && deps.release(video));
  }
}

/** The browser's video element, with the blob URL it plays. */
export interface BrowserVideo extends LoadedVideo {
  element: HTMLVideoElement;
  url: string;
}

function once(element: HTMLVideoElement, ok: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      element.removeEventListener(ok, done);
      element.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      element.removeEventListener(ok, done);
      element.removeEventListener("error", fail);
      reject(new Error(`video ${ok} failed: ${element.error?.message ?? element.error?.code ?? "unknown"}`));
    };
    element.addEventListener(ok, done);
    element.addEventListener("error", fail);
  });
}

/**
 * The real load, seek and encode.
 *
 * `muted` and `playsInline` are set before the source, because iOS Safari
 * will not decode a frame for an element it thinks may take over the screen
 * with sound. `loadeddata` rather than `loadedmetadata`: metadata gives the
 * size but iOS does not decode a frame until data arrives, and drawing before
 * then paints black. The blob URL is same-origin, so the canvas is never
 * tainted and `toBlob` is allowed.
 */
export const browserCapture: CaptureDeps<BrowserVideo> = {
  load: async (clip) => {
    const element = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.setAttribute("playsinline", "");
    element.preload = "auto";
    const url = URL.createObjectURL(clip);
    const loaded = once(element, "loadeddata");
    element.src = url;
    element.load();
    try {
      await loaded;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    return { element, url, width: element.videoWidth, height: element.videoHeight, duration: element.duration };
  },
  seek: async (video, seconds) => {
    if (seconds <= 0 || Math.abs(video.element.currentTime - seconds) < 0.01) return;
    const seeked = once(video.element, "seeked");
    video.element.currentTime = seconds;
    await seeked;
  },
  encode: async (video, size, type, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(video.element, 0, 0, size.width, size.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  },
  release: (video) => {
    video.element.removeAttribute("src");
    video.element.load();
    URL.revokeObjectURL(video.url);
  },
};
