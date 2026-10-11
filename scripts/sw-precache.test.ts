// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkPrecache, loadServiceWorker, staticFile } from "./sw-precache";

const sw = loadServiceWorker();
const DPL = "?dpl=c52ea7b7c80b";

/** The shapes a webpack build actually emits, taken from .next/server/app/today.html. */
const HTML = [
  `<link rel="stylesheet" href="/_next/static/css/a8913fef371941e2.css${DPL}" data-precedence="next"/>`,
  `<link rel="preload" href="/_next/static/media/1a4aa50920b5315c-s.p.woff2${DPL}" as="font" crossorigin=""/>`,
  `<script src="/_next/static/chunks/webpack-9ce23131beb575e0.js${DPL}" async=""></script>`,
  `<script src="/_next/static/chunks/app/(athlete)/layout-36c36949b83df261.js${DPL}" async=""></script>`,
  `<script src="/_next/static/chunks/app/(athlete)/today/page-1f80f15fb8f56b87.js${DPL}" async=""></script>`,
  `<script src="/_next/static/chunks/app/(coach)/coach/roster/page-0d5e.js?dpl=a&amp;v=2" async=""></script>`,
  `<script src="/_next/static/chunks/app/history/[sessionId]/page-77aa.js${DPL}" async=""></script>`,
  // The inline RSC payload: escaped quotes either side.
  `<script>self.__next_f.push([1,"2:I[\\"/_next/static/css/a8913fef371941e2.css${DPL}\\"]"])</script>`,
  `<style>@font-face{src:url(/_next/static/media/98e207f02528a563-s.p.woff2)}</style>`,
].join("\n");

describe("assetsIn", () => {
  const assets = [...sw.assetsIn(HTML)];

  it("keeps route-group chunks whole, parentheses and all", () => {
    expect(assets).toContain(`/_next/static/chunks/app/(athlete)/layout-36c36949b83df261.js${DPL}`);
    expect(assets).toContain(`/_next/static/chunks/app/(athlete)/today/page-1f80f15fb8f56b87.js${DPL}`);
  });

  it("never asks for a path cut off inside a parenthesis", () => {
    for (const asset of assets) expect(asset.split("(").length).toBe(asset.split(")").length);
  });

  it("decodes &amp; so the query is the one the browser sends", () => {
    expect(assets).toContain("/_next/static/chunks/app/(coach)/coach/roster/page-0d5e.js?dpl=a&v=2");
  });

  it("keeps dynamic-segment brackets", () => {
    expect(assets).toContain(`/_next/static/chunks/app/history/[sessionId]/page-77aa.js${DPL}`);
  });

  it("stops at an escaped quote and at the ) closing a CSS url()", () => {
    expect(assets).toContain("/_next/static/media/98e207f02528a563-s.p.woff2");
    for (const asset of assets) expect(asset).not.toMatch(/[\\"')<>\s]$/);
  });

  it("counts a URL once however many times the page names it", () => {
    expect(assets.filter((a) => a.startsWith("/_next/static/css/"))).toHaveLength(1);
  });
});

describe("checkPrecache", () => {
  function build(files: Record<string, string>): string {
    const dist = mkdtempSync(path.join(tmpdir(), "snb-sw-"));
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
      writeFileSync(path.join(dist, file), body);
    }
    return dist;
  }
  const page = (src: string) => `<script src="${src}"></script>`;
  const layout = "/_next/static/chunks/app/(athlete)/layout-1.js?dpl=x";

  it("passes when every page is prerendered and every asset is on disk", () => {
    const pages = Object.fromEntries(
      sw.shellPages.map((p) => [`server/app/${p === "/" ? "index" : p.slice(1)}.html`, page(layout)]),
    );
    const report = checkPrecache(build({ ...pages, "static/chunks/app/(athlete)/layout-1.js": "" }), sw);
    expect(report).toEqual({ missingPages: [], missingAssets: new Map(), assetCount: 1 });
  });

  it("names the asset with no file behind it, and the page that asked for it", () => {
    const report = checkPrecache(build({ "server/app/today.html": page("/_next/static/chunks/gone.js") }), sw);
    expect(report.missingAssets).toEqual(new Map([["/_next/static/chunks/gone.js", "/today"]]));
  });

  it("names a shell page that was not prerendered", () => {
    const report = checkPrecache(build({ "server/app/index.html": "" }), sw);
    expect(report.missingPages).toContain("/today");
    expect(report.missingPages).not.toContain("/");
  });
});

describe("staticFile", () => {
  it("drops the query and decodes the path", () => {
    expect(staticFile("/d", "/_next/static/chunks/app/%28athlete%29/a.js?dpl=x")).toBe(
      "/d/static/chunks/app/(athlete)/a.js",
    );
  });
});
