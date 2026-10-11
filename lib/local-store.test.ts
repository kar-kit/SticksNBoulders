import { readLocal, writeLocal } from "./local-store";

afterEach(() => vi.restoreAllMocks());

describe("localStorage that cannot be written", () => {
  it("swallows a quota-exceeded write, so nothing that stores a convenience can fail a set", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(() => writeLocal("snb.k", 1)).not.toThrow();
    expect(readLocal("snb.k")).toBeNull();
  });
});
