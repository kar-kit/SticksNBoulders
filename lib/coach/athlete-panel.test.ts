import { panelSearch, readPanel } from "./athlete-panel";

const params = (search: string) => new URLSearchParams(search);

describe("reading the open panel from the URL", () => {
  it("reads the bodyweight view and a clip", () => {
    expect(readPanel(params("view=bodyweight"))).toEqual({ kind: "bodyweight" });
    expect(readPanel(params("clip=set_123"))).toEqual({ kind: "clip", clipId: "set_123" });
  });

  it("is nothing for an empty or unknown query", () => {
    expect(readPanel(params(""))).toBeNull();
    expect(readPanel(params("view=other"))).toBeNull();
  });

  it("ignores a clip id that could not be a row id, rather than trusting it", () => {
    expect(readPanel(params(`clip=${encodeURIComponent("../../etc")}`))).toBeNull();
    expect(readPanel(params(`clip=${"x".repeat(37)}`))).toBeNull();
  });
});

describe("writing it back", () => {
  it("opens one panel at a time", () => {
    expect(panelSearch("?clip=a", { kind: "bodyweight" })).toBe("?view=bodyweight");
    expect(panelSearch("?view=bodyweight", { kind: "clip", clipId: "b" })).toBe("?clip=b");
  });

  it("closes to a clean URL", () => {
    expect(panelSearch("?view=bodyweight", null)).toBe("");
  });

  it("keeps any other parameter it finds", () => {
    expect(panelSearch("?from=roster&clip=a", null)).toBe("?from=roster");
    expect(panelSearch("?from=roster", { kind: "bodyweight" })).toBe("?from=roster&view=bodyweight");
  });
});
