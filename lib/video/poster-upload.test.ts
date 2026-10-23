import { describe, expect, it, vi } from "vitest";
import { posterPermissions } from "@/appwrite/documents/policy";

vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({}) }));

import { capturePosterFor, uploadPoster } from "./poster-upload";

const poster = { blob: new Blob(["frame"], { type: "image/webp" }), type: "image/webp" as const };

describe("uploadPoster", () => {
  it("uploads at the clip's poster id, stamped exactly like the clip", async () => {
    const createFile = vi.fn(async () => ({}));
    expect(await uploadPoster("clip1", "joey", poster, { createFile, timeoutMs: 1000 })).toBe("clip1_poster");
    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketId: "set_video_posters",
        fileId: "clip1_poster",
        permissions: posterPermissions({ athleteId: "joey" }),
      }),
    );
    const file = (createFile.mock.calls[0] as unknown as [{ file: File }])[0].file;
    expect(file.name).toBe("poster.webp");
    expect(file.type).toBe("image/webp");
  });

  it("counts a poster already there (409) as done when it carries this athlete's poster stamp", async () => {
    const createFile = vi.fn(async () => Promise.reject({ code: 409 }));
    const getFile = vi.fn(async () => ({ $permissions: [...posterPermissions({ athleteId: "joey" })].reverse() }));
    expect(await uploadPoster("clip1", "joey", poster, { createFile, getFile, timeoutMs: 1000 })).toBe("clip1_poster");
    expect(getFile).toHaveBeenCalledWith({ bucketId: "set_video_posters", fileId: "clip1_poster" });
  });

  it("refuses a file someone else put at the poster id first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createFile = vi.fn(async () => Promise.reject({ code: 409 }));
    const squatted = vi.fn(async () => ({ $permissions: ['read("user:coach")', 'delete("user:coach")'] }));
    expect(await uploadPoster("clip1", "joey", poster, { createFile, getFile: squatted, timeoutMs: 1000 })).toBeNull();
    const unreadable = vi.fn(async () => Promise.reject({ code: 404 }));
    expect(await uploadPoster("clip1", "joey", poster, { createFile, getFile: unreadable, timeoutMs: 1000 })).toBeNull();
    warn.mockRestore();
  });

  it("returns null, never throws, when the upload fails or hangs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await uploadPoster("clip1", "joey", poster, { createFile: async () => Promise.reject({ code: 401 }), timeoutMs: 1000 }),
    ).toBeNull();
    expect(
      await uploadPoster("clip1", "joey", poster, { createFile: () => new Promise(() => {}), timeoutMs: 10 }),
    ).toBeNull();
    warn.mockRestore();
  });

  it("uploads nothing when there is no frame or no room for a poster id", async () => {
    const createFile = vi.fn(async () => ({}));
    expect(await uploadPoster("clip1", "joey", null, { createFile, timeoutMs: 1000 })).toBeNull();
    expect(await uploadPoster("x".repeat(30), "joey", poster, { createFile, timeoutMs: 1000 })).toBeNull();
    expect(createFile).not.toHaveBeenCalled();
  });
});

describe("capturePosterFor", () => {
  it("turns a capture that throws into no poster", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await capturePosterFor(new Blob(), { capture: async () => Promise.reject(new Error("boom")) })).toBeNull();
    warn.mockRestore();
  });
});
