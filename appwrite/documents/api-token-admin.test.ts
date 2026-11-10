// @vitest-environment node
import { createHash } from "node:crypto";
import { generateToken, hashToken } from "./api-token-admin";
import { isTokenShape, TOKEN_BYTES } from "./api-token";

describe("minting and hashing (F29)", () => {
  it("makes snb_pat_ plus 32 random bytes as 43 base64url characters", () => {
    const token = generateToken();
    expect(isTokenShape(token)).toBe(true);
    expect(Buffer.from(token.slice("snb_pat_".length), "base64url")).toHaveLength(TOKEN_BYTES);
  });

  it("draws its bytes from the random source it is given, all 32 of them", () => {
    const size = vi.fn((n: number) => Buffer.alloc(n, 0xfb));
    const token = generateToken(size);
    expect(size).toHaveBeenCalledWith(32);
    expect(token).toBe(`snb_pat_${Buffer.alloc(32, 0xfb).toString("base64url")}`);
  });

  it("hashes with sha256 to 64 hex characters, the same every time", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });
});
