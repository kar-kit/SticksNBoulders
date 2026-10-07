import { checkVideoTicketSecret } from "./startup-check";

const at = (length: number) => "x".repeat(length);

function check(secret: string | undefined, nodeEnv = "production", phase?: string) {
  return checkVideoTicketSecret({ env: { VIDEO_TICKET_SECRET: secret }, nodeEnv, phase });
}

describe("a production start", () => {
  it("fails when the secret is missing, and says how to fix it", () => {
    const result = checkVideoTicketSecret({ env: {}, nodeEnv: "production", phase: undefined });
    expect(result.status).toBe("fail");
    if (result.status === "ok") throw new Error("unreachable");
    expect(result.message).toContain("VIDEO_TICKET_SECRET");
    expect(result.message).toContain("openssl rand -base64 48");
  });

  it("fails on an empty string, which is what .env.example ships with", () => {
    expect(check("").status).toBe("fail");
  });

  it("fails one character short of the minimum", () => {
    expect(check(at(31)).status).toBe("fail");
  });

  it("passes at exactly the minimum", () => {
    expect(check(at(32))).toEqual({ status: "ok" });
  });

  it("passes on a long secret", () => {
    expect(check(at(64))).toEqual({ status: "ok" });
  });
});

describe("a development start", () => {
  it("warns instead of failing when the secret is missing", () => {
    const result = check(undefined, "development");
    expect(result.status).toBe("warn");
    if (result.status === "ok") throw new Error("unreachable");
    expect(result.message).toContain("VIDEO_TICKET_SECRET");
    expect(result.message).toContain("openssl rand -base64 48");
  });

  it("warns on a short secret, and is silent on a good one", () => {
    expect(check(at(31), "development").status).toBe("warn");
    expect(check(at(32), "development")).toEqual({ status: "ok" });
  });

  it("treats an unset NODE_ENV as non-production", () => {
    const result = checkVideoTicketSecret({ env: {}, nodeEnv: undefined, phase: undefined });
    expect(result.status).toBe("warn");
  });
});

describe("the production build", () => {
  it("is exempt, so CI does not need the secret", () => {
    expect(check(undefined, "production", "phase-production-build")).toEqual({ status: "ok" });
    expect(check(at(5), "production", "phase-production-build")).toEqual({ status: "ok" });
  });

  it("is the only phase that is exempt", () => {
    expect(check(undefined, "production", "phase-production-server").status).toBe("fail");
    expect(check(undefined, "production", "phase-development-server").status).toBe("fail");
  });
});
