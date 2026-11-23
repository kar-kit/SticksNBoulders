import { NO_MODE } from "@/lib/auth/mode";
import { NOT_A_COACH } from "@/lib/auth/role";
import type { SessionState } from "@/lib/auth/session-context";
import { REMEMBERED_USER_KEY } from "@/lib/auth/remembered-user";
import { RETURNING_ATTRIBUTE, RETURNING_SCRIPT, rootDecision } from "./root";

const user = { id: "u1", name: "A", email: "a@example.com" };
const signedIn = (over: Partial<Extract<SessionState, { status: "signed-in" }>> = {}): SessionState => ({
  status: "signed-in",
  user,
  coach: NOT_A_COACH,
  prefs: NO_MODE,
  offline: false,
  ...over,
});

describe("rootDecision", () => {
  it("waits while the session is loading", () => {
    expect(rootDecision({ status: "loading" })).toEqual({ kind: "wait" });
  });

  it("keeps a signed-out visitor on the public page instead of sending them to sign in", () => {
    expect(rootDecision({ status: "signed-out" })).toEqual({ kind: "public" });
  });

  it("sends a signed-in athlete to Today, as before", () => {
    expect(rootDecision(signedIn({ prefs: { mode: "athlete", choseCoach: false } }))).toEqual({
      kind: "go",
      to: "/today",
      adopt: null,
    });
  });

  it("sends a signed-in coach to the roster, as before", () => {
    expect(rootDecision(signedIn({ prefs: { mode: "coach", choseCoach: true } }))).toEqual({
      kind: "go",
      to: "/coach/roster",
      adopt: null,
    });
  });

  it("keeps the migration: no mode but linked athletes goes to the roster and saves coach", () => {
    expect(rootDecision(signedIn({ coach: { isCoach: true, athleteIds: ["a1"] } }))).toEqual({
      kind: "go",
      to: "/coach/roster",
      adopt: "coach",
    });
  });

  it("sends a brand-new account to the first-run question", () => {
    expect(rootDecision(signedIn())).toEqual({ kind: "go", to: "/welcome", adopt: null });
  });

  it("sends a remembered session with no signal to Today, not the question", () => {
    expect(rootDecision(signedIn({ offline: true }))).toEqual({ kind: "go", to: "/today", adopt: null });
  });
});

describe("RETURNING_SCRIPT", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute(RETURNING_ATTRIBUTE);
  });

  const run = () => new Function(RETURNING_SCRIPT)();

  it("marks the page as returning when the device remembers a user", () => {
    localStorage.setItem(REMEMBERED_USER_KEY, "{}");
    run();
    expect(document.documentElement.hasAttribute(RETURNING_ATTRIBUTE)).toBe(true);
  });

  it("leaves a first-time visitor's page visible", () => {
    run();
    expect(document.documentElement.hasAttribute(RETURNING_ATTRIBUTE)).toBe(false);
  });

  it("does not throw where storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(run).not.toThrow();
    spy.mockRestore();
  });
});
