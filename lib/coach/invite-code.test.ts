import {
  generateInviteCode,
  isInviteCode,
  normaliseInviteCode,
  INVITE_KEYSPACE,
} from "./invite-code";

/** Cycles a fixed byte pattern, so a generated code is checkable by hand. */
const bytesOf = (...values: number[]) => {
  let at = 0;
  return (length: number) =>
    Uint8Array.from({ length }, () => {
      const value = values[at % values.length];
      at += 1;
      return value;
    });
};

describe("generating a code", () => {
  it("prefixes it and makes it five characters long", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^SNB-[A-Z0-9]{5}$/);
    expect(code).toHaveLength(9);
  });

  it("uses no character anyone confuses for another", () => {
    // The whole point of the alphabet. A code containing an O next to a 0 is
    // a code that gets typed wrong across a gym floor.
    const codes = Array.from({ length: 200 }, () => generateInviteCode().slice(4));
    expect(codes.join("")).not.toMatch(/[ILOU01]/);
  });

  it("maps bytes through the alphabet rather than through ASCII", () => {
    expect(generateInviteCode(bytesOf(0))).toBe("SNB-22222");
    expect(generateInviteCode(bytesOf(0, 1, 2, 3, 4))).toBe("SNB-23456");
  });

  it("rejects the bytes that would bias the first characters of the alphabet", () => {
    // 240..255 would wrap to 2..8 more often than the rest. Dropped, not
    // folded -- so the first byte here contributes nothing and the second
    // supplies the character.
    expect(generateInviteCode(bytesOf(250, 5))).toBe("SNB-77777");
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
    expect(codes.size).toBe(500);
  });

  it("has a keyspace worth stating, because Order 16 has to rate limit against it", () => {
    expect(INVITE_KEYSPACE).toBe(24_300_000);
  });
});

describe("reading a code somebody typed", () => {
  it("takes it exactly as shown", () => {
    expect(normaliseInviteCode("SNB-4F7K2")).toBe("SNB-4F7K2");
  });

  it.each([
    ["lower case", "snb-4f7k2"],
    ["no prefix", "4F7K2"],
    ["a space instead of the hyphen", "SNB 4F7K2"],
    ["spaces around it, from a paste", "  SNB-4F7K2  "],
    ["run together", "snb4f7k2"],
    ["typed with the phone's own hyphen", "SNB–4F7K2"],
  ])("forgives %s", (_label, typed) => {
    expect(normaliseInviteCode(typed)).toBe("SNB-4F7K2");
  });

  it.each([
    ["too short", "SNB-4F7K"],
    ["too long", "SNB-4F7K22"],
    ["empty", ""],
    ["the prefix alone", "SNB-"],
    ["a character the alphabet excludes", "SNB-4F7KO"],
    ["a zero where an O was meant", "SNB-4F7K0"],
  ])("refuses %s", (_label, typed) => {
    expect(normaliseInviteCode(typed)).toBeNull();
  });

  it("takes a bare body that happens to start with the prefix's own letters", () => {
    // S, N and B are all in the alphabet, so SNB-SNB23 is a code this
    // generator can produce. Stripping "SNB" on sight would leave "23".
    expect(normaliseInviteCode("SNB23")).toBe("SNB-SNB23");
    expect(normaliseInviteCode("SNB-SNB23")).toBe("SNB-SNB23");
    expect(normaliseInviteCode("snb snb23")).toBe("SNB-SNB23");
  });

  it("recognises its own output", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isInviteCode(generateInviteCode())).toBe(true);
    }
    expect(isInviteCode("snb-4f7k2")).toBe(false);
  });
});
