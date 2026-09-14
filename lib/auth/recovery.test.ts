import {
  forgetResetEmail,
  formatCooldown,
  isSpentToken,
  recallResetEmail,
  rememberResetEmail,
  parseResetParams,
  passwordProblemMessage,
  RECOVERY_LINK_TTL_MINUTES,
  remainingCooldown,
  RESEND_COOLDOWN_SECONDS,
  validateNewPassword,
} from "./recovery";

describe("parseResetParams", () => {
  it("reads the userId and secret Appwrite appends to the link", () => {
    const params = new URLSearchParams("userId=abc123&secret=s3cr3t");
    expect(parseResetParams(params)).toEqual({ userId: "abc123", secret: "s3cr3t" });
  });

  it("accepts the object shape Next hands a page", () => {
    expect(parseResetParams({ userId: "abc123", secret: "s3cr3t" })).toEqual({
      userId: "abc123",
      secret: "s3cr3t",
    });
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseResetParams({ userId: ["a", "b"], secret: "s" })).toEqual({ userId: "a", secret: "s" });
  });

  it.each([
    ["userId missing", { secret: "s3cr3t" }],
    ["secret missing", { userId: "abc123" }],
    ["both missing", {}],
    ["userId empty", { userId: "", secret: "s3cr3t" }],
    ["secret empty", { userId: "abc123", secret: "" }],
    ["whitespace only", { userId: "  ", secret: "  " }],
  ])("returns null when %s", (_label, params) => {
    // A mail client that broke the link across a line, or someone opening the
    // page directly. Either way there is nothing to reset.
    expect(parseResetParams(params)).toBeNull();
  });

  it("trims padding a mail client may have introduced", () => {
    expect(parseResetParams({ userId: " abc123 ", secret: " s3cr3t " })).toEqual({
      userId: "abc123",
      secret: "s3cr3t",
    });
  });
});

describe("validateNewPassword", () => {
  it("accepts a password that is long enough and matches", () => {
    expect(validateNewPassword("hunter2222", "hunter2222", 8)).toBeNull();
  });

  it("rejects one that is too short before checking the match", () => {
    // Told the length rule once, rather than two errors in sequence.
    expect(validateNewPassword("short", "different", 8)).toBe("too-short");
  });

  it("rejects a mismatch", () => {
    expect(validateNewPassword("hunter2222", "hunter2223", 8)).toBe("mismatch");
  });

  it("accepts exactly the minimum length", () => {
    expect(validateNewPassword("12345678", "12345678", 8)).toBeNull();
  });

  it("rejects one character under", () => {
    expect(validateNewPassword("1234567", "1234567", 8)).toBe("too-short");
  });

  it("imposes no composition rules at all", () => {
    // Rules that demand a symbol push people to weaker passwords they write
    // down. The design says so explicitly: "Nothing else required."
    expect(validateNewPassword("aaaaaaaa", "aaaaaaaa", 8)).toBeNull();
    expect(validateNewPassword("all lower case words", "all lower case words", 8)).toBeNull();
  });

  it("treats an empty confirmation as a mismatch, not a pass", () => {
    expect(validateNewPassword("hunter2222", "", 8)).toBe("mismatch");
  });
});

describe("passwordProblemMessage", () => {
  it("states the length requirement", () => {
    expect(passwordProblemMessage("too-short", 8)).toBe("At least 8 characters.");
  });

  it("says plainly that the two differ", () => {
    expect(passwordProblemMessage("mismatch", 8)).toBe("Those two don't match.");
  });
});

describe("the resend cooldown", () => {
  it("starts at the full window", () => {
    expect(remainingCooldown(1000, 1000)).toBe(RESEND_COOLDOWN_SECONDS);
  });

  it("counts down", () => {
    expect(remainingCooldown(0, 18_000, 60)).toBe(42);
  });

  it("reaches zero and stays there", () => {
    expect(remainingCooldown(0, 60_000, 60)).toBe(0);
    expect(remainingCooldown(0, 600_000, 60)).toBe(0);
  });

  it("never goes negative", () => {
    expect(remainingCooldown(0, 999_999, 60)).toBeGreaterThanOrEqual(0);
  });

  it.each([
    [42, "0:42"],
    [60, "1:00"],
    [5, "0:05"],
    [0, "0:00"],
    [125, "2:05"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    // The design shows "Resend in 0:42", so seconds are always two digits.
    expect(formatCooldown(seconds)).toBe(expected);
  });
});

describe("a spent link", () => {
  it("treats invalid credentials as a used or expired token", () => {
    // Appwrite reports both the same way, and so does the screen: either way
    // the answer is to request a fresh link.
    expect(isSpentToken({ kind: "invalid-credentials" })).toBe(true);
  });

  it("treats an unrecognised failure the same, because a reset cannot be retried", () => {
    expect(isSpentToken({ kind: "unknown", message: "boom" })).toBe(true);
  });

  it("does not treat being offline as a spent link", () => {
    // The link is fine; the connection is not. Telling someone to request a
    // new one would waste the one they have.
    expect(isSpentToken({ kind: "offline" })).toBe(false);
  });

  it("does not treat rate limiting as a spent link", () => {
    expect(isSpentToken({ kind: "rate-limited" })).toBe(false);
  });
});

describe("stated lifetimes match Appwrite's", () => {
  it("says one hour, which is what Appwrite actually enforces", () => {
    // Verified in the SDK docs: "valid for 1 hour". The copy on the screen
    // promises the same, so the two must not drift.
    expect(RECOVERY_LINK_TTL_MINUTES).toBe(60);
  });
});

describe("remembering the address across screens", () => {
  function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }

  it("round-trips the address", () => {
    const storage = fakeStorage();
    rememberResetEmail("joey@example.com", storage);
    expect(recallResetEmail(storage)).toBe("joey@example.com");
  });

  it("clears it once the reset is done", () => {
    const storage = fakeStorage();
    rememberResetEmail("joey@example.com", storage);
    forgetResetEmail(storage);
    expect(recallResetEmail(storage)).toBeNull();
  });

  it("returns null when nothing was stored", () => {
    expect(recallResetEmail(fakeStorage())).toBeNull();
  });

  it("survives storage being unavailable, because a reset must not depend on it", () => {
    // Private browsing and blocked site data both throw here. The address is a
    // nicety; the reset itself has to work regardless.
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;
    expect(() => rememberResetEmail("joey@example.com", broken)).not.toThrow();
    expect(recallResetEmail(broken)).toBeNull();
    expect(() => forgetResetEmail(broken)).not.toThrow();
  });
});
