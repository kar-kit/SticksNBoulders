import {
  failureMessage,
  MINIMUM_PASSWORD_LENGTH,
  offersPasswordReset,
  offersProvider,
  toAuthFailure,
} from "./errors";

const appwrite = (type: string, code = 401, message = "boom") => ({ code, type, message });

describe("toAuthFailure", () => {
  it("maps invalid credentials", () => {
    expect(toAuthFailure(appwrite("user_invalid_credentials"))).toEqual({ kind: "invalid-credentials" });
  });

  it("maps a duplicate email on signup", () => {
    expect(toAuthFailure(appwrite("user_already_exists", 409))).toEqual({ kind: "email-taken" });
  });

  it("maps rate limiting by type and by status", () => {
    expect(toAuthFailure(appwrite("general_rate_limit_exceeded", 429))).toEqual({ kind: "rate-limited" });
    expect(toAuthFailure({ code: 429, type: "something_else" })).toEqual({ kind: "rate-limited" });
  });

  it("maps a weak password to the requirement, not to a raw server string", () => {
    expect(toAuthFailure(appwrite("general_argument_invalid", 400))).toEqual({
      kind: "weak-password",
      minimumLength: MINIMUM_PASSWORD_LENGTH,
    });
  });

  it("treats a failed fetch as offline, not as a bug", () => {
    // Far more often a dead gym connection than anything wrong with the app.
    expect(toAuthFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
  });

  it("falls back to invalid credentials for an unlabelled 401", () => {
    expect(toAuthFailure({ code: 401 })).toEqual({ kind: "invalid-credentials" });
  });

  it("keeps an unknown error's message rather than inventing one", () => {
    expect(toAuthFailure({ code: 500, message: "Server exploded" })).toEqual({
      kind: "unknown",
      message: "Server exploded",
    });
  });

  it("still says something when there is no message at all", () => {
    expect(toAuthFailure({})).toMatchObject({ kind: "unknown" });
    expect(failureMessage(toAuthFailure({}))).not.toBe("");
  });
});

describe("failureMessage", () => {
  it("does not reveal whether the email exists", () => {
    // Verified live: a wrong password, an unknown email and a provider-only
    // account are indistinguishable to the client, and this message must stay
    // true for all three.
    const message = failureMessage({ kind: "invalid-credentials" });
    expect(message).toBe("That email and password don't match.");
    expect(message.toLowerCase()).not.toContain("no account");
    expect(message.toLowerCase()).not.toContain("not found");
    expect(message.toLowerCase()).not.toContain("exist");
  });

  it.each([
    ["google", "You signed up with Google. Continue with Google."],
    ["apple", "You signed up with Apple. Continue with Apple."],
  ] as const)("names %s when the server established it", (provider, expected) => {
    expect(failureMessage({ kind: "other-method", provider })).toBe(expected);
  });

  it("states the password requirement as a requirement", () => {
    expect(failureMessage({ kind: "weak-password", minimumLength: 8 })).toContain("8 characters");
  });

  it("says plainly that signing in needs a connection", () => {
    // Authentication is the one thing that genuinely cannot work offline.
    expect(failureMessage({ kind: "offline" })).toMatch(/offline/i);
  });
});

describe("what the message offers alongside it", () => {
  it("offers reset only when a password could be the problem", () => {
    expect(offersPasswordReset({ kind: "invalid-credentials" })).toBe(true);
    expect(offersPasswordReset({ kind: "other-method", provider: "google" })).toBe(false);
    expect(offersPasswordReset({ kind: "offline" })).toBe(false);
  });

  it("does not offer reset to an account that has no password to reset", () => {
    // That reset email is a dead end and a support message to a busy coach.
    expect(offersPasswordReset({ kind: "other-method", provider: "google" })).toBe(false);
  });

  it("offers the provider button only when the provider is known", () => {
    expect(offersProvider({ kind: "other-method", provider: "google" })).toBe("google");
    expect(offersProvider({ kind: "invalid-credentials" })).toBeNull();
  });
});

describe("an account with no password whose provider is unknown", () => {
  it("says the account does not use a password", () => {
    expect(failureMessage({ kind: "other-method-unknown" })).toBe(
      "That account doesn't use a password. Use one of the options above.",
    );
  });

  it("does not offer a reset, because there is no password to reset", () => {
    expect(offersPasswordReset({ kind: "other-method-unknown" })).toBe(false);
  });

  it("offers no provider button, because none is known", () => {
    expect(offersProvider({ kind: "other-method-unknown" })).toBeNull();
  });
});
