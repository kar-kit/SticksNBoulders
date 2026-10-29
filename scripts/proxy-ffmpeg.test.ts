import { describe, expect, it } from "vitest";
import type { ProxyCap } from "../lib/video/proxy-profile";
import * as F from "./proxy-ffmpeg.fixtures";
import {
  fitWithin,
  moovBeforeMdat,
  parseCapabilities,
  planProxy,
  ProxyError,
  readProbe,
  remuxBlockers,
  topLevelBoxes,
  verifyProxy,
  type Capabilities,
  type ProbeJson,
} from "./proxy-ffmpeg";

const FULL: Capabilities = { zscale: true, tonemap: true, libx264: true, fpsModeFlag: "-fps_mode" };
const plan = (probe: ProbeJson, caps: Capabilities = FULL, cap?: ProxyCap) =>
  planProxy(readProbe(probe), caps, "in.mov", "out.mp4", cap);
const flag = (args: string[], name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

describe("readProbe", () => {
  it("reports a portrait clip as displayed, from the display matrix or the old rotate tag", () => {
    expect(readProbe(F.portraitRotated).video).toMatchObject({ width: 1080, height: 1920, quarterTurn: true });
    expect(readProbe(F.portrait4kHevcOldTag).video).toMatchObject({ width: 2160, height: 3840, quarterTurn: true });
    expect(readProbe(F.iphoneHdrPortrait).video).toMatchObject({ width: 1080, height: 1920 });
    expect(readProbe(F.h264_1080p30).video).toMatchObject({ width: 1920, height: 1080, quarterTurn: false });
  });

  it("detects HLG and PQ as HDR, and nothing else", () => {
    expect(readProbe(F.iphoneHdrPortrait).video.hdr).toBe("hlg");
    expect(readProbe(F.hdr10).video.hdr).toBe("pq");
    expect(readProbe(F.hevc4k60).video.hdr).toBeNull();
    expect(readProbe(F.h264_720p30).video.hdr).toBeNull();
  });

  it("uses the average frame rate and flags variable rate", () => {
    const vfr = readProbe(F.vfrHevc).video;
    expect(vfr.fps).toBeCloseTo(40.34, 2);
    expect(vfr.vfr).toBe(true);
    // An iPhone's 29.95 average against a nominal 30 is jitter, not VFR worth naming.
    expect(readProbe(F.iphoneHdrPortrait).video.vfr).toBe(false);
  });

  it("knows a clip has no audio, and refuses a file with no video", () => {
    expect(readProbe(F.noAudio).audio).toBeNull();
    expect(() => readProbe({ streams: [{ codec_type: "audio", codec_name: "aac" }] })).toThrow(ProxyError);
  });
});

describe("fitWithin", () => {
  it("caps 4K to 1080p in either orientation", () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 1920, height: 1080, scaled: true });
    expect(fitWithin(2160, 3840)).toEqual({ width: 1080, height: 1920, scaled: true });
  });

  it("never upscales", () => {
    expect(fitWithin(1280, 720)).toEqual({ width: 1280, height: 720, scaled: false });
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080, scaled: false });
  });

  it("keeps the aspect for odd shapes and makes both sides even", () => {
    // 4:3 at 4032 x 3024: the short edge is what binds.
    expect(fitWithin(4032, 3024)).toEqual({ width: 1440, height: 1080, scaled: true });
    expect(fitWithin(1281, 721)).toEqual({ width: 1280, height: 720, scaled: true });
  });

  it("follows the one cap value: 720p is a one-line change", () => {
    expect(fitWithin(1920, 1080, { longEdge: 1280, shortEdge: 720, fps: 60 })).toEqual({ width: 1280, height: 720, scaled: true });
  });
});

describe("planProxy: remux what is already compliant", () => {
  it.each([
    ["720p30 H.264 at 3 Mbps", F.h264_720p30],
    ["1080p60 H.264 at 8 Mbps (60 stays 60)", F.h264_1080p60],
    ["portrait H.264 within the cap", F.portraitRotated],
    ["H.264 with no audio", F.noAudio],
  ])("%s is copied, with faststart", (_name, probe) => {
    const p = plan(probe);
    expect(p.mode).toBe("remux");
    expect(flag(p.args, "-c:v")).toBe("copy");
    expect(flag(p.args, "-movflags")).toBe("+faststart");
    expect(p.args).not.toContain("-vf");
  });

  it("copies AAC, drops a missing track with -an, and encodes any other audio to AAC", () => {
    expect(flag(plan(F.h264_720p30).args, "-c:a")).toBe("copy");
    expect(plan(F.noAudio).args).toContain("-an");
    expect(plan(F.noAudio).args).not.toContain("0:a:0");
    const pcm = plan(F.pcmAudio);
    expect(pcm.mode).toBe("remux");
    expect(flag(pcm.args, "-c:a")).toBe("aac");
    expect(flag(pcm.args, "-b:a")).toBe("96k");
  });

  it("maps only the first video and audio, never an iPhone's data tracks", () => {
    const args = plan(F.iphoneHdrPortrait).args;
    expect(args.filter((a) => a.startsWith("0:"))).toEqual(["0:v:0", "0:a:0"]);
    expect(args).toContain("-dn");
  });
});

describe("planProxy: encode everything else", () => {
  it("HEVC 4K60: H.264 High at 1080p, 60fps kept, the profile's rate control", () => {
    const p = plan(F.hevc4k60);
    expect(p.mode).toBe("encode");
    if (p.mode !== "encode") return;
    expect(p.filters).toEqual(["scale=1920:1080:flags=bicubic", "setsar=1", "format=yuv420p"]);
    expect(flag(p.args, "-c:v")).toBe("libx264");
    expect(flag(p.args, "-profile:v")).toBe("high");
    expect(flag(p.args, "-pix_fmt")).toBe("yuv420p");
    expect(flag(p.args, "-preset")).toBe("veryfast");
    expect(flag(p.args, "-crf")).toBe("23");
    expect(flag(p.args, "-maxrate")).toBe("10000k");
    expect(flag(p.args, "-bufsize")).toBe("20000k");
    expect(flag(p.args, "-b:a")).toBe("96k");
    expect(flag(p.args, "-movflags")).toBe("+faststart");
  });

  it("H.264 1080p30 over the bitrate ceiling: re-encoded at the same size and rate", () => {
    const p = plan(F.h264_1080p30);
    expect(remuxBlockers(readProbe(F.h264_1080p30))).toEqual(["17060kbps is over the ceiling"]);
    expect(p.mode).toBe("encode");
    if (p.mode !== "encode") return;
    expect(p.filters).toEqual(["format=yuv420p"]);
    expect(p.size).toEqual({ width: 1920, height: 1080 });
  });

  it("brings 120fps down to the cap and leaves a VFR clip's own timestamps alone", () => {
    const fast = plan(F.h264_720p120);
    expect(fast.mode === "encode" && fast.filters[0]).toBe("fps=60");
    const vfr = plan(F.vfrHevc);
    expect(vfr.mode === "encode" && vfr.filters.some((f) => f.startsWith("fps="))).toBe(false);
    expect(flag(vfr.args, "-fps_mode")).toBe("passthrough");
  });

  it("spells passthrough -vsync on an ffmpeg older than 5.1", () => {
    const p = plan(F.vfrHevc, { ...FULL, fpsModeFlag: "-vsync" });
    expect(flag(p.args, "-vsync")).toBe("passthrough");
    expect(p.args).not.toContain("-fps_mode");
  });

  it("scales a portrait 4K clip to 1080 x 1920, the frame ffmpeg sees after autorotate", () => {
    const p = plan(F.portrait4kHevcOldTag);
    expect(p.mode === "encode" && p.filters[0]).toBe("scale=1080:1920:flags=bicubic");
  });

  it("tone-maps HDR to SDR, after scaling, with the source's own colour tags, and tags the output BT.709", () => {
    const p = plan(F.iphoneHdrPortrait);
    expect(p.mode).toBe("encode");
    if (p.mode !== "encode") return;
    expect(p.filters).toEqual([
      "zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
      "format=yuv420p",
    ]);
    expect(flag(p.args, "-color_trc")).toBe("bt709");
    expect(flag(p.args, "-colorspace")).toBe("bt709");
    const pq = plan(F.hdr10);
    expect(pq.mode === "encode" && pq.filters[0]).toBe("scale=1920:1080:flags=bicubic");
    expect(pq.mode === "encode" && pq.filters[2]).toContain("tin=smpte2084");
  });

  it("refuses HDR loudly, naming the fix, when this ffmpeg cannot tone-map", () => {
    expect(() => plan(F.iphoneHdrPortrait, { ...FULL, zscale: false })).toThrow(/zscale \(libzimg\)[^]*washed out[^]*SNB_FFMPEG/);
    expect(() => plan(F.hdr10, { ...FULL, tonemap: false })).toThrow(ProxyError);
    // SDR does not need either.
    expect(plan(F.hevc4k60, { ...FULL, zscale: false, tonemap: false }).mode).toBe("encode");
  });

  it("refuses an encode without libx264, but still remuxes", () => {
    expect(() => plan(F.hevc4k60, { ...FULL, libx264: false })).toThrow(/libx264/);
    expect(plan(F.h264_720p30, { ...FULL, libx264: false }).mode).toBe("remux");
  });

  it("at a 720p cap, a 1080p H.264 that would have remuxed is scaled instead", () => {
    const p = plan(F.h264_1080p60, FULL, { longEdge: 1280, shortEdge: 720, fps: 60 });
    expect(p.mode === "encode" && p.filters[0]).toBe("scale=1280:720:flags=bicubic");
  });
});

describe("parseCapabilities", () => {
  const listing = (...names: string[]) => names.map((n) => ` ... ${n}            V->V       something`).join("\n");

  it("reads filters, encoders, and which fps-mode flag the version speaks", () => {
    expect(
      parseCapabilities({
        version: "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023",
        filters: listing("scale", "zscale", "tonemap"),
        encoders: " V....D libx264              libx264 H.264",
      }),
    ).toEqual({ zscale: true, tonemap: true, libx264: true, fpsModeFlag: "-fps_mode" });
    expect(
      parseCapabilities({ version: "ffmpeg version 4.4.2-0ubuntu0.22.04.1", filters: listing("tonemap"), encoders: "" }),
    ).toEqual({ zscale: false, tonemap: true, libx264: false, fpsModeFlag: "-vsync" });
  });

  it("does not mistake tonemap_opencl for tonemap, and takes a git build as recent", () => {
    const caps = parseCapabilities({ version: "ffmpeg version N-113000-gabc", filters: listing("tonemap_opencl"), encoders: "" });
    expect(caps.tonemap).toBe(false);
    expect(caps.fpsModeFlag).toBe("-fps_mode");
  });
});

describe("verifyProxy", () => {
  const source = readProbe(F.h264_1080p30);
  const faststart = { moovBeforeMdat: true };

  it("passes a good proxy", () => {
    expect(verifyProxy(F.goodProxyOf1080p30, source, faststart)).toEqual([]);
  });

  it("fails each thing a coach would otherwise find by pressing play", () => {
    const bad: ProbeJson = {
      streams: [{ ...F.hevc4k60.streams![0], width: 3840, height: 2160, avg_frame_rate: "120/1" }],
      format: { duration: "40.000000" },
    };
    expect(verifyProxy(bad, source, { moovBeforeMdat: false })).toEqual([
      "codec is hevc, not h264",
      "duration 40.00s against the source's 45.00s",
      "moov is not before mdat (not faststart)",
      "3840x2160 is over the cap",
      "120.00fps is over the cap",
    ]);
  });

  it("allows half a second of drift and no more", () => {
    const at = (duration: string): ProbeJson => ({ ...F.goodProxyOf1080p30, format: { duration } });
    expect(verifyProxy(at("45.499"), source, faststart)).toEqual([]);
    expect(verifyProxy(at("44.4"), source, faststart)).toHaveLength(1);
  });

  it("fails a file with no video, and a source of unknown length", () => {
    expect(verifyProxy({ streams: [], format: {} }, source, faststart)).toEqual(["no video stream in the proxy"]);
    const unknown = { ...source, durationSeconds: null };
    expect(verifyProxy(F.goodProxyOf1080p30, unknown, faststart)[0]).toMatch(/duration is unknown/);
  });

  it("accepts a portrait proxy whose coded frame is landscape with a rotation flag", () => {
    const portrait = readProbe(F.portraitRotated);
    expect(verifyProxy(F.portraitRotated, portrait, faststart)).toEqual([]);
  });
});

describe("topLevelBoxes and the faststart check", () => {
  const box = (type: string, size: number) => {
    const b = new Uint8Array(size);
    new DataView(b.buffer).setUint32(0, size);
    b.set([...type].map((c) => c.charCodeAt(0)), 4);
    return b;
  };
  const file = (...boxes: Uint8Array[]) => {
    const all = new Uint8Array(boxes.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of boxes) {
      all.set(b, at);
      at += b.length;
    }
    return all;
  };
  const reader = (bytes: Uint8Array) => async (offset: number, length: number) => bytes.subarray(offset, offset + length);

  it("walks the headers in order: a faststart file and one with the moov last", async () => {
    const fast = file(box("ftyp", 24), box("moov", 400), box("free", 8), box("mdat", 1000));
    const slow = file(box("ftyp", 24), box("free", 8), box("mdat", 1000), box("moov", 400));
    expect(await topLevelBoxes(reader(fast), fast.length)).toEqual(["ftyp", "moov", "free", "mdat"]);
    expect(moovBeforeMdat(await topLevelBoxes(reader(fast), fast.length))).toBe(true);
    expect(moovBeforeMdat(await topLevelBoxes(reader(slow), slow.length))).toBe(false);
  });

  it("follows a 64-bit box size and a box that runs to the end", async () => {
    const big = new Uint8Array(32);
    const view = new DataView(big.buffer);
    view.setUint32(0, 1);
    big.set([..."mdat"].map((c) => c.charCodeAt(0)), 4);
    view.setBigUint64(8, BigInt(32));
    const tail = box("moov", 16);
    new DataView(tail.buffer).setUint32(0, 0);
    const bytes = file(box("ftyp", 16), big, tail);
    expect(await topLevelBoxes(reader(bytes), bytes.length)).toEqual(["ftyp", "mdat", "moov"]);
  });

  it("stops at a malformed header rather than looping, and needs both boxes", async () => {
    const bytes = file(box("ftyp", 16), new Uint8Array(16));
    expect(await topLevelBoxes(reader(bytes), bytes.length)).toEqual(["ftyp"]);
    expect(moovBeforeMdat(["ftyp", "moov"])).toBe(false);
  });
});
