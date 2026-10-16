import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * next.config.ts is the one file whose mistakes do not fail anything: a stray
 * `module.exports = {...}` beside `export default` replaced the whole config on
 * dev for a day, and the build still went green with no deployment id and no
 * headers for the service worker. So it is tested by what it exports.
 */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return (await import("../../next.config")).default;
}

afterEach(() => vi.unstubAllEnvs());

describe("next.config", () => {
  it("is the one config, with its build id and its service worker headers", async () => {
    const config = await load({ SNB_BUILD_ID: "abc123", VERCEL_GIT_COMMIT_SHA: "" });
    expect(config.deploymentId).toBe("abc123");
    expect(config.env?.NEXT_PUBLIC_SNB_BUILD_ID).toBe("abc123");
    const headers = await config.headers!();
    const worker = headers.find((rule) => rule.source === "/sw.js");
    expect(worker?.headers.find((h) => h.key === "Cache-Control")?.value).toContain("no-cache");
  });

  it("keeps the LAN origin for the dev server", async () => {
    const config = await load({ SNB_BUILD_ID: "abc123" });
    expect(config.allowedDevOrigins).toContain("192.168.1.189");
  });

  it("takes the build id from the Vercel commit when the host sets none", async () => {
    const config = await load({ SNB_BUILD_ID: "", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123" });
    expect(config.deploymentId).toBe("0123456789ab");
  });

  it("lets SNB_BUILD_ID win over the Vercel commit", async () => {
    const config = await load({ SNB_BUILD_ID: "mine", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123" });
    expect(config.deploymentId).toBe("mine");
  });
});
