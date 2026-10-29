import type { ProbeJson } from "./proxy-ffmpeg";

/**
 * ffprobe JSON (`-show_streams -show_format -of json`), trimmed to the fields
 * proxy-ffmpeg.ts reads. The SDR shapes are copied from ffprobe 8.1 run over
 * synthetic sources made with ffmpeg's testsrc2 (docs/video-proxy.md,
 * "Checked locally"); the iPhone HDR one adds the Dolby Vision record and the
 * negative display-matrix rotation iPhones write [Inference: from published
 * ffprobe dumps of iPhone 12+ HDR clips, not from a clip of Joey's].
 */

const aac = { codec_type: "audio", codec_name: "aac", profile: "LC", bit_rate: "70064", duration: "2.000000" };
const rotated = (rotation: number) => [{ side_data_type: "Display Matrix", rotation }];

/** iPhone 4K60 in "High Efficiency": 8-bit HEVC, ~45 Mbps. */
export const hevc4k60: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main",
      pix_fmt: "yuv420p",
      width: 3840,
      height: 2160,
      r_frame_rate: "60/1",
      avg_frame_rate: "60/1",
      bit_rate: "45100000",
      color_transfer: "bt709",
      color_primaries: "bt709",
      color_space: "bt709",
      duration: "20.016667",
    },
    { ...aac, duration: "20.016667" },
  ],
  format: { duration: "20.016667", bit_rate: "45300000" },
};

/** iPhone "Most Compatible" 1080p30: H.264 already, but ~17 Mbps and moov at the end. */
export const h264_1080p30: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "17060000",
      duration: "45.000000",
    },
    { ...aac, duration: "45.000000" },
  ],
  format: { duration: "45.000000", bit_rate: "17200000" },
};

/** Already proxy-shaped: H.264 Main 720p30 at 3 Mbps. Remuxed, never re-encoded. */
export const h264_720p30: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "Main",
      pix_fmt: "yuv420p",
      width: 1280,
      height: 720,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "2994432",
      duration: "2.000000",
    },
    aac,
  ],
  format: { duration: "2.000000", bit_rate: "3059000" },
};

/** Portrait H.264, stored landscape with a quarter-turn flag. Displayed 1080 x 1920. */
export const portraitRotated: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "7610172",
      duration: "2.000000",
      side_data_list: rotated(90),
    },
    aac,
  ],
  format: { duration: "2.000000", bit_rate: "7695288" },
};

/** Portrait 4K HEVC, flag as an older ffprobe reports it: a `rotate` tag. */
export const portrait4kHevcOldTag: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main",
      pix_fmt: "yuv420p",
      width: 3840,
      height: 2160,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "24000000",
      tags: { rotate: "90" },
    },
    aac,
  ],
  format: { duration: "12.500000", bit_rate: "24100000" },
};

/** No audio track at all (a muted export, a screen recording). */
export const noAudio: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1280,
      height: 720,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "2900000",
      duration: "2.000000",
    },
  ],
  format: { duration: "2.000000", bit_rate: "2910000" },
};

/** 1080p60 H.264 at 8 Mbps: inside every cap, so a remux. 60 stays 60. */
export const h264_1080p60: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      r_frame_rate: "60/1",
      avg_frame_rate: "60/1",
      bit_rate: "8100000",
      duration: "2.000000",
    },
    aac,
  ],
  format: { duration: "2.000000", bit_rate: "8170000" },
};

/** 120fps slow-motion source: brought down to the 60fps cap. */
export const h264_720p120: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1280,
      height: 720,
      r_frame_rate: "120/1",
      avg_frame_rate: "120/1",
      bit_rate: "5900000",
      duration: "2.000000",
    },
    aac,
  ],
  format: { duration: "2.000000", bit_rate: "5970000" },
};

/** Variable frame rate HEVC: nominal 60, average 40.34 (ffprobe 8.1 on a synthetic VFR clip). */
export const vfrHevc: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      r_frame_rate: "60/1",
      avg_frame_rate: "4800/119",
      bit_rate: "5323752",
      duration: "1.983333",
    },
    aac,
  ],
  format: { duration: "2.000000", bit_rate: "5368284" },
};

/** iPhone 15 Pro default: HDR HLG, 10-bit HEVC, Dolby Vision 8.4, portrait. */
export const iphoneHdrPortrait: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main 10",
      pix_fmt: "yuv420p10le",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
      avg_frame_rate: "18000/601",
      bit_rate: "8920000",
      color_transfer: "arib-std-b67",
      color_primaries: "bt2020",
      color_space: "bt2020nc",
      duration: "31.098333",
      side_data_list: [{ side_data_type: "DOVI configuration record" }, { side_data_type: "Display Matrix", rotation: -90 }],
    },
    { ...aac, duration: "31.098333" },
    // iPhones also carry timed-metadata tracks; never mapped.
    { codec_type: "data" },
  ],
  format: { duration: "31.098333", bit_rate: "9100000" },
};

/** HDR10 (PQ), the other transfer that needs tone-mapping. */
export const hdr10: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main 10",
      pix_fmt: "yuv420p10le",
      width: 3840,
      height: 2160,
      r_frame_rate: "24000/1001",
      avg_frame_rate: "24000/1001",
      bit_rate: "30000000",
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
      color_space: "bt2020nc",
    },
  ],
  format: { duration: "10.010000", bit_rate: "30000000" },
};

/** H.264 that would remux but for its PCM audio: video copied, audio encoded. */
export const pcmAudio: ProbeJson = {
  streams: [
    { ...h264_720p30.streams![0] },
    { codec_type: "audio", codec_name: "pcm_s16le", duration: "2.000000" },
  ],
  format: { duration: "2.000000", bit_rate: "4500000" },
};

/** A proxy as the worker's own ffmpeg writes one (the verification's happy path). */
export const goodProxyOf1080p30: ProbeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      bit_rate: "6100000",
    },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { duration: "45.005000", bit_rate: "6200000" },
};
