/**
 * The ffmpeg half of `npm run clips:proxies`: what a source is, what to do
 * with it, and whether the result can be trusted. All pure, so every decision
 * is tested against ffprobe JSON fixtures (proxy-ffmpeg.fixtures.ts) with no
 * ffmpeg in the loop; scripts/make-clip-proxies.mts runs the processes.
 *
 * The three decisions:
 *
 *   1. Remux or encode. A source that is already H.264, 8-bit 4:2:0, inside
 *      the cap and under the bitrate ceiling is copied into a new MP4 with the
 *      moov moved to the front (`-c copy -movflags +faststart`): seconds of
 *      I/O instead of minutes of CPU, and no generation loss. Anything else is
 *      encoded to lib/video/proxy-profile.ts.
 *   2. The filter chain, when encoding: frame rate down to the cap if above
 *      it, scale down to fit the cap if above it, HDR tone-mapped to SDR. Never
 *      up. ffmpeg applies the phone's rotation flag itself before the filters
 *      (autorotate), so the chain sees the frame as displayed.
 *   3. Verification of the output before anything points at it.
 *
 * HDR. iPhone 12 and later film HDR by default: 10-bit HEVC, HLG transfer,
 * often Dolby Vision on top. Squeezing that into 8-bit SDR without
 * tone-mapping gives flat, washed-out colour -- a proxy that looks broken.
 * Tone-mapping needs zscale (libzimg) and tonemap. An ffmpeg without them
 * makes this throw with a message saying so, rather than produce the bad
 * proxy: the clip stays on its original, which still plays where HEVC does.
 */
import { PROXY_CAP, PROXY_ENCODE, type ProxyCap } from "../lib/video/proxy-profile";

/* -------------------------------------------------------------------------
 * Reading ffprobe
 * ---------------------------------------------------------------------- */

/** The slice of `ffprobe -show_streams -show_format -of json` this reads. */
export interface ProbeJson {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    bit_rate?: string;
    color_transfer?: string;
    color_primaries?: string;
    color_space?: string;
    duration?: string;
    tags?: Record<string, string>;
    side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
    disposition?: { attached_pic?: number };
  }>;
  format?: { duration?: string; bit_rate?: string };
}

export type Hdr = "hlg" | "pq";

export interface VideoFacts {
  codec: string;
  profile: string;
  pixFmt: string;
  /** As stored, before rotation. */
  codedWidth: number;
  codedHeight: number;
  /** As displayed: swapped when the rotation flag is a quarter turn. */
  width: number;
  height: number;
  /** Quarter-turn rotation flag present (portrait phone clips). */
  quarterTurn: boolean;
  /** Average frame rate, or the nominal one where the average is unknown. Null when neither parses. */
  fps: number | null;
  /** Nominal and average frame rates disagree: phones record variable frame rate. */
  vfr: boolean;
  /** Bits per second of the video stream, or of the whole file if the stream does not say. */
  bitRate: number | null;
  hdr: Hdr | null;
  transfer: string | null;
  primaries: string | null;
  matrix: string | null;
}

export interface MediaFacts {
  video: VideoFacts;
  audio: { codec: string } | null;
  durationSeconds: number | null;
}

/** A refusal with a message meant for the operator's log, verbatim. */
export class ProxyError extends Error {}

const rate = (value: string | undefined): number | null => {
  if (!value) return null;
  const [n, d = "1"] = value.split("/");
  const num = Number(n);
  const den = Number(d);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  return num / den;
};

const positive = (value: string | undefined): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const HDR_TRANSFERS: Record<string, Hdr> = { "arib-std-b67": "hlg", smpte2084: "pq" };

/** The facts that decide what to do, from ffprobe's JSON. Throws when there is no video. */
export function readProbe(json: ProbeJson): MediaFacts {
  const streams = json.streams ?? [];
  // A cover image is a "video" stream to ffprobe. Not one to play.
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!v || !v.width || !v.height) throw new ProxyError("no video stream");
  const a = streams.find((s) => s.codec_type === "audio");

  // Two places a phone's rotation can surface: the display matrix (ffprobe 5+)
  // and the older `rotate` tag. Their signs differ; only "quarter turn or
  // not" matters here, because ffmpeg applies the rotation itself.
  const rotations = [
    ...(v.side_data_list ?? []).map((d) => d.rotation).filter((r): r is number => typeof r === "number"),
    ...(v.tags?.rotate ? [Number(v.tags.rotate)] : []),
  ].filter(Number.isFinite);
  const quarterTurn = rotations.some((r) => Math.abs(Math.round(r)) % 180 === 90);

  const nominal = rate(v.r_frame_rate);
  const average = rate(v.avg_frame_rate);
  const transfer = v.color_transfer ?? null;

  return {
    video: {
      codec: v.codec_name ?? "",
      profile: v.profile ?? "",
      pixFmt: v.pix_fmt ?? "",
      codedWidth: v.width,
      codedHeight: v.height,
      width: quarterTurn ? v.height : v.width,
      height: quarterTurn ? v.width : v.height,
      quarterTurn,
      fps: average ?? nominal,
      vfr: nominal !== null && average !== null && Math.abs(nominal - average) / nominal > 0.01,
      bitRate: positive(v.bit_rate) ?? positive(json.format?.bit_rate),
      hdr: transfer ? (HDR_TRANSFERS[transfer] ?? null) : null,
      transfer,
      primaries: v.color_primaries ?? null,
      matrix: v.color_space ?? null,
    },
    audio: a ? { codec: a.codec_name ?? "" } : null,
    durationSeconds: positive(json.format?.duration) ?? positive(v.duration),
  };
}

/* -------------------------------------------------------------------------
 * What this ffmpeg can do
 * ---------------------------------------------------------------------- */

export interface Capabilities {
  /** libzimg's zscale filter: the colour conversions tone-mapping needs. */
  zscale: boolean;
  tonemap: boolean;
  libx264: boolean;
  /** `-fps_mode` arrived in ffmpeg 5.1; older builds spell it `-vsync`. */
  fpsModeFlag: "-fps_mode" | "-vsync";
}

/**
 * From `ffmpeg -version`, `ffmpeg -hide_banner -filters` and `-encoders`.
 * A version string that does not parse (a git build, "N-112233-g...") is
 * taken as recent.
 */
export function parseCapabilities(out: { version: string; filters: string; encoders: string }): Capabilities {
  const has = (listing: string, name: string) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(listing);
  const v = /ffmpeg version n?(\d+)\.(\d+)/.exec(out.version);
  const old = v !== null && (Number(v[1]) < 5 || (Number(v[1]) === 5 && Number(v[2]) < 1));
  return {
    zscale: has(out.filters, "zscale"),
    tonemap: has(out.filters, "tonemap"),
    libx264: has(out.encoders, "libx264"),
    fpsModeFlag: old ? "-vsync" : "-fps_mode",
  };
}

/* -------------------------------------------------------------------------
 * Planning
 * ---------------------------------------------------------------------- */

/** A small margin so 59.94 and float noise count as 60. */
const FPS_SLACK = 0.5;

/**
 * The displayed size scaled down to fit the cap, never up, aspect kept, both
 * sides even (4:2:0 needs it). Orientation-agnostic.
 */
export function fitWithin(width: number, height: number, cap: ProxyCap = PROXY_CAP) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, cap.longEdge / long, cap.shortEdge / short);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (scale === 1) {
    // Already inside. Odd sides (never seen from a phone) still need evening.
    const w = width % 2 === 0 ? width : width - 1;
    const h = height % 2 === 0 ? height : height - 1;
    return { width: w, height: h, scaled: w !== width || h !== height };
  }
  return { width: even(width * scale), height: even(height * scale), scaled: true };
}

const withinCap = (width: number, height: number, cap: ProxyCap) =>
  Math.max(width, height) <= cap.longEdge && Math.min(width, height) <= cap.shortEdge;

const BROWSER_SAFE_H264 = new Set(["Baseline", "Constrained Baseline", "Main", "High"]);
const BROWSER_SAFE_PIXELS = new Set(["yuv420p", "yuvj420p"]);

/** Why a source cannot simply be remuxed. Empty means it can. */
export function remuxBlockers(src: MediaFacts, cap: ProxyCap = PROXY_CAP): string[] {
  const v = src.video;
  const reasons: string[] = [];
  if (v.codec !== "h264") reasons.push(`codec ${v.codec || "unknown"}`);
  else if (!BROWSER_SAFE_H264.has(v.profile)) reasons.push(`H.264 profile ${v.profile || "unknown"}`);
  if (!BROWSER_SAFE_PIXELS.has(v.pixFmt)) reasons.push(`pixel format ${v.pixFmt || "unknown"}`);
  if (v.hdr) reasons.push(`HDR (${v.transfer})`);
  if (!withinCap(v.width, v.height, cap)) reasons.push(`${v.width}x${v.height} is over the cap`);
  if (fitWithin(v.width, v.height, cap).scaled) reasons.push("odd dimensions");
  if (v.fps === null) reasons.push("unknown frame rate");
  else if (v.fps > cap.fps + FPS_SLACK) reasons.push(`${v.fps.toFixed(2)}fps is over the cap`);
  if (v.bitRate === null) reasons.push("unknown bitrate");
  else if (v.bitRate > PROXY_ENCODE.maxrateKbps * 1000) reasons.push(`${Math.round(v.bitRate / 1000)}kbps is over the ceiling`);
  return [...new Set(reasons)];
}

/**
 * The tone-map chain for an HLG or PQ source: to linear light, to BT.709
 * primaries, Hable curve, back to BT.709 limited range. The input's own
 * transfer, matrix and primaries are passed explicitly rather than trusted to
 * frame side data, which phone files do not always carry through a decoder.
 */
export function toneMapFilters(v: VideoFacts): string[] {
  const tin = v.transfer ?? "arib-std-b67";
  const min = v.matrix && v.matrix !== "unknown" ? v.matrix : "bt2020nc";
  const pin = v.primaries && v.primaries !== "unknown" ? v.primaries : "bt2020";
  return [
    `zscale=tin=${tin}:min=${min}:pin=${pin}:t=linear:npl=100`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
  ];
}

export type ProxyPlan =
  | { mode: "remux"; args: string[]; reasons: [] }
  | { mode: "encode"; args: string[]; reasons: string[]; filters: string[]; size: { width: number; height: number } };

const MP4_TAIL = (output: string) => ["-sn", "-dn", "-movflags", "+faststart", "-f", "mp4", output];

/**
 * The ffmpeg arguments that turn `input` into a proxy at `output`.
 *
 * Throws a ProxyError, with the fix in the message, when this ffmpeg cannot
 * make a correct proxy of this source: HDR without zscale/tonemap, or an
 * encode with no libx264.
 */
export function planProxy(src: MediaFacts, caps: Capabilities, input: string, output: string, cap: ProxyCap = PROXY_CAP): ProxyPlan {
  const head = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input, "-map", "0:v:0"];
  const audioMap = src.audio ? ["-map", "0:a:0"] : [];
  const audioOut = !src.audio
    ? ["-an"]
    : src.audio.codec === "aac"
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", `${PROXY_ENCODE.audioKbps}k`, "-ac", "2"];

  const reasons = remuxBlockers(src, cap);
  if (reasons.length === 0) {
    // The rotation flag is stream side data and survives a copy; players honour it.
    return { mode: "remux", reasons: [], args: [...head, ...audioMap, "-c:v", "copy", ...audioOut, ...MP4_TAIL(output)] };
  }

  const v = src.video;
  if (v.hdr && !(caps.zscale && caps.tonemap)) {
    const missing = [!caps.zscale && "zscale (libzimg)", !caps.tonemap && "tonemap"].filter(Boolean).join(" and ");
    throw new ProxyError(
      `HDR source (${v.transfer}) needs ffmpeg's ${missing} filter to tone-map to SDR; without it the proxy ` +
        `would come out washed out. Install an ffmpeg built with libzimg (Debian and Ubuntu's apt ffmpeg is) ` +
        `or point SNB_FFMPEG at one. The clip stays on its original.`,
    );
  }
  if (!caps.libx264) {
    throw new ProxyError("this ffmpeg has no libx264 encoder. Install one that does, or set SNB_FFMPEG. The clip stays on its original.");
  }

  const size = fitWithin(v.width, v.height, cap);
  const filters: string[] = [];
  // Frames first: dropping them before scaling is the cheap order.
  if (v.fps !== null && v.fps > cap.fps + FPS_SLACK) filters.push(`fps=${cap.fps}`);
  if (size.scaled) filters.push(`scale=${size.width}:${size.height}:flags=bicubic`, "setsar=1");
  if (v.hdr) filters.push(...toneMapFilters(v));
  filters.push("format=yuv420p");

  const sdrTags = v.hdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : [];
  const encodedAudio = src.audio ? ["-c:a", "aac", "-b:a", `${PROXY_ENCODE.audioKbps}k`, "-ac", "2"] : ["-an"];

  return {
    mode: "encode",
    reasons,
    filters,
    size: { width: size.width, height: size.height },
    args: [
      ...head,
      ...audioMap,
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      PROXY_ENCODE.preset,
      "-crf",
      String(PROXY_ENCODE.crf),
      "-maxrate",
      `${PROXY_ENCODE.maxrateKbps}k`,
      "-bufsize",
      `${PROXY_ENCODE.bufsizeKbps}k`,
      // Keep each frame's own timestamp. The mp4 muxer would otherwise make a
      // phone's variable-rate clip constant at its nominal rate, duplicating
      // frames a 30fps take never had. Above the cap, the fps filter has
      // already made it constant at the cap.
      caps.fpsModeFlag,
      "passthrough",
      ...sdrTags,
      ...encodedAudio,
      ...MP4_TAIL(output),
    ],
  };
}

/* -------------------------------------------------------------------------
 * Verifying
 * ---------------------------------------------------------------------- */

/** How far the proxy's duration may drift from the source's. */
export const DURATION_TOLERANCE_SECONDS = 0.5;

/**
 * What is wrong with a proxy, or nothing. Every check is one a coach would
 * otherwise discover by pressing play.
 */
export function verifyProxy(
  output: ProbeJson,
  source: MediaFacts,
  layout: { moovBeforeMdat: boolean },
  cap: ProxyCap = PROXY_CAP,
): string[] {
  let out: MediaFacts;
  try {
    out = readProbe(output);
  } catch {
    return ["no video stream in the proxy"];
  }
  const problems: string[] = [];
  const v = out.video;
  if (v.codec !== "h264") problems.push(`codec is ${v.codec || "unknown"}, not h264`);
  if (!BROWSER_SAFE_PIXELS.has(v.pixFmt)) problems.push(`pixel format is ${v.pixFmt || "unknown"}`);
  if (source.durationSeconds === null) problems.push("the source's duration is unknown, so the proxy's cannot be checked");
  else if (out.durationSeconds === null) problems.push("the proxy has no duration");
  else if (Math.abs(out.durationSeconds - source.durationSeconds) > DURATION_TOLERANCE_SECONDS) {
    problems.push(`duration ${out.durationSeconds.toFixed(2)}s against the source's ${source.durationSeconds.toFixed(2)}s`);
  }
  if (!layout.moovBeforeMdat) problems.push("moov is not before mdat (not faststart)");
  if (!withinCap(v.width, v.height, cap)) problems.push(`${v.width}x${v.height} is over the cap`);
  if (v.fps === null) problems.push("frame rate unknown");
  else if (v.fps > cap.fps + FPS_SLACK) problems.push(`${v.fps.toFixed(2)}fps is over the cap`);
  return problems;
}

/**
 * The top-level MP4 box types in file order, reading only box headers.
 *
 * `read(offset, length)` returns up to `length` bytes at `offset`. Stops at the
 * end, at a malformed header, or after 64 boxes (a real MP4 has a handful).
 */
export async function topLevelBoxes(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  fileSize: number,
): Promise<string[]> {
  const types: string[] = [];
  let offset = 0;
  while (offset + 8 <= fileSize && types.length < 64) {
    const header = await read(offset, 16);
    if (header.length < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
    // Zeroes or garbage, not a box: stop rather than read it as one.
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    if (size === 1) {
      if (header.length < 16) break;
      size = Number(view.getBigUint64(8));
    } else if (size === 0) {
      size = fileSize - offset; // runs to the end of the file
    }
    if (size < 8) break;
    types.push(type);
    offset += size;
  }
  return types;
}

/** The faststart test: a moov exists and comes before the first mdat. */
export function moovBeforeMdat(types: readonly string[]): boolean {
  const moov = types.indexOf("moov");
  const mdat = types.indexOf("mdat");
  return moov !== -1 && mdat !== -1 && moov < mdat;
}
