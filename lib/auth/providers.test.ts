import { enabledProviders } from "./providers";

describe("enabledProviders", () => {
  it("shows Google alone by default, because Apple is not configured", () => {
    expect(enabledProviders().map((p) => p.name)).toEqual(["google"]);
  });

  it.each([["true"], [true]])("shows Apple when the flag is %p", (appleEnabled) => {
    expect(enabledProviders({ appleEnabled }).map((p) => p.name)).toEqual(["apple", "google"]);
  });

  it.each([["false"], [false], [""], [undefined]])("hides Apple when the flag is %p", (appleEnabled) => {
    // A button that 412s is worse than no button.
    expect(enabledProviders({ appleEnabled }).map((p) => p.name)).toEqual(["google"]);
  });

  it("puts Apple above Google, which is Apple's own guidance", () => {
    expect(enabledProviders({ appleEnabled: true })[0].name).toBe("apple");
  });

  it("uses Apple's and Google's prescribed wording", () => {
    const labels = enabledProviders({ appleEnabled: true }).map((p) => p.label);
    expect(labels).toEqual(["Continue with Apple", "Continue with Google"]);
  });
});
