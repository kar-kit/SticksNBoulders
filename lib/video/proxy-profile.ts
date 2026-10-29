/**
 * What a clip's proxy is (schema v22, docs/video-proxy.md).
 *
 * H.264 High, 8-bit 4:2:0, AAC, moov first: the one combination every browser
 * a coach might use decodes and can start before the whole file has arrived.
 *
 * The cap is a CAP, not a target. A source under it keeps its size and frame
 * rate -- a 720p clip stays 720p, a 30fps clip stays 30fps -- because
 * upscaling or inventing frames costs bytes and shows the coach nothing new.
 *
 * Orientation-agnostic: a portrait 4K clip becomes 1080 x 1920, not 608 x
 * 1080, so `longEdge` and `shortEdge` rather than width and height.
 */

export interface ProxyCap {
  /** The longer side of the displayed (rotation applied) frame, in pixels. Even. */
  longEdge: number;
  /** The shorter side, in pixels. Even. */
  shortEdge: number;
  /** Frames per second. A faster source is reduced to this; a slower one is left alone. */
  fps: number;
}

/**
 * THE cap. 720p is a one-line change: `{ longEdge: 1280, shortEdge: 720, fps: 60 }`.
 *
 * A change applies to proxies made after it. Existing proxies are not redone,
 * because the worker treats a verified proxy as done (docs/video-proxy.md,
 * "Changing the cap").
 */
export const PROXY_CAP: ProxyCap = { longEdge: 1920, shortEdge: 1080, fps: 60 };

/**
 * The encoder settings, for when the source is not already compliant.
 *
 * CRF 23 is x264's default quality. The maxrate/bufsize pair caps the peaks so
 * a busy frame (chalk, a crowded gym) cannot spike past what the tunnel and
 * Vercel stream comfortably; 10 Mbps is roughly what an iPhone's own 1080p30
 * H.264 sits under. `veryfast` because the worker runs on the same VM as the
 * Appwrite instance, niced, one clip at a time, and a clip a minute behind is
 * fine where a VM pegged for ten minutes is not.
 */
export const PROXY_ENCODE = {
  crf: 23,
  maxrateKbps: 10_000,
  bufsizeKbps: 20_000,
  preset: "veryfast",
  audioKbps: 96,
} as const;
