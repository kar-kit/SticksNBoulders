import { describe, expect, it, vi } from "vitest";
import {
  MAX_POSTER_BYTES,
  POSTER_EDGE,
  capturePoster,
  posterSeekTime,
  posterSize,
  type CaptureDeps,
  type LoadedVideo,
} from "./poster-capture";

describe("posterSize", () => {
  it("puts the longer edge at the poster edge and keeps the aspect, portrait or landscape", () => {
    expect(posterSize(1080, 1920)).toEqual({ width: 180, height: POSTER_EDGE });
    expect(posterSize(1920, 1080)).toEqual({ width: POSTER_EDGE, height: 180 });
  });

  it("never upscales a small clip, and keeps edges even", () => {
    expect(posterSize(240, 135)).toEqual({ width: 240, height: 136 });
  });

  it("refuses a size that is not one", () => {
    expect(posterSize(0, 0)).toBeNull();
    expect(posterSize(Number.NaN, 100)).toBeNull();
    expect(posterSize(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("posterSeekTime", () => {
  it("skips the black first frame: half a second in, or a third of a short clip", () => {
    expect(posterSeekTime(42)).toBe(0.5);
    expect(posterSeekTime(0.9)).toBeCloseTo(0.3);
  });

  it("uses a small fixed offset when the duration is unknown", () => {
    expect(posterSeekTime(Number.NaN)).toBe(0.1);
    expect(posterSeekTime(Number.POSITIVE_INFINITY)).toBe(0.1);
    expect(posterSeekTime(0)).toBe(0.1);
  });
});

describe("capturePoster", () => {
  const video: LoadedVideo = { width: 1080, height: 1920, duration: 30 };
  const deps = (over: Partial<CaptureDeps> = {}): CaptureDeps & { release: ReturnType<typeof vi.fn> } => {
    const release = vi.fn();
    return {
      load: async () => video,
      seek: async () => {},
      encode: async (_v, _s, type) => new Blob(["x".repeat(100)], { type }),
      ...over,
      release,
    } as CaptureDeps & { release: ReturnType<typeof vi.fn> };
  };
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("returns a WebP when the browser can encode one", async () => {
    const d = deps();
    const poster = await capturePoster(new Blob(), d);
    expect(poster?.type).toBe("image/webp");
    expect(d.release).toHaveBeenCalledOnce();
  });

  it("falls back to JPEG when WebP comes back as a PNG, as Safari does", async () => {
    const encode = vi.fn(async (_v: LoadedVideo, _s: unknown, type: string) =>
      new Blob(["x"], { type: type === "image/webp" ? "image/png" : type }),
    );
    const poster = await capturePoster(new Blob(), deps({ encode }));
    expect(poster?.type).toBe("image/jpeg");
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it("seeks past the first frame, at thumbnail size", async () => {
    const seek = vi.fn(async () => {});
    const encode = vi.fn(async (_v: LoadedVideo, _s: unknown, type: string) => new Blob(["x"], { type }));
    await capturePoster(new Blob(), deps({ seek, encode }));
    expect(seek).toHaveBeenCalledWith(video, 0.5);
    expect(encode.mock.calls[0][1]).toEqual({ width: 180, height: 320 });
  });

  it("yields null, never throws, when the clip cannot be decoded -- and releases nothing it never had", async () => {
    const warn = quiet();
    const d = deps({ load: async () => Promise.reject(new Error("MEDIA_ERR_SRC_NOT_SUPPORTED")) });
    expect(await capturePoster(new Blob(), d)).toBeNull();
    expect(d.release).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("yields null when seeking hangs, and still releases the element", async () => {
    const warn = quiet();
    const d = deps({ seek: () => new Promise<void>(() => {}) });
    expect(await capturePoster(new Blob(), d, 20)).toBeNull();
    expect(d.release).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("yields null when no format can be encoded, or the frame is absurdly large", async () => {
    expect(await capturePoster(new Blob(), deps({ encode: async () => null }))).toBeNull();
    expect(
      await capturePoster(
        new Blob(),
        deps({ encode: async (_v, _s, type) => new Blob([new Uint8Array(MAX_POSTER_BYTES + 1)], { type }) }),
      ),
    ).toBeNull();
  });

  it("yields null for a video that reports no size", async () => {
    expect(await capturePoster(new Blob(), deps({ load: async () => ({ width: 0, height: 0, duration: 3 }) }))).toBeNull();
  });
});
