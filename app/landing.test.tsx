import { render } from "@testing-library/react";
import { NO_MODE } from "@/lib/auth/mode";
import { NOT_A_COACH } from "@/lib/auth/role";
import type { SessionState } from "@/lib/auth/session-context";
import { RETURNING_ATTRIBUTE } from "@/lib/landing/root";
import { Landing } from "./landing";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session = vi.hoisted(() => ({ state: { status: "loading" } as SessionState, recordMode: vi.fn() }));
vi.mock("@/lib/auth/session-context", () => ({ useSession: () => session }));

const html = document.documentElement;

afterEach(() => {
  replace.mockReset();
  html.removeAttribute(RETURNING_ATTRIBUTE);
});

describe("Landing, the root's gate", () => {
  it("leaves a signed-out visitor on the public page and reveals it", () => {
    html.setAttribute(RETURNING_ATTRIBUTE, "");
    session.state = { status: "signed-out" };
    render(<Landing />);
    expect(replace).not.toHaveBeenCalled();
    expect(html.hasAttribute(RETURNING_ATTRIBUTE)).toBe(false);
  });

  it("does nothing while the session is loading", () => {
    session.state = { status: "loading" };
    render(<Landing />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("hides the public page and sends a signed-in user on, as the root always did", () => {
    session.state = {
      status: "signed-in",
      user: { id: "u1", name: "A", email: "a@example.com" },
      coach: NOT_A_COACH,
      prefs: { ...NO_MODE, mode: "athlete" },
      offline: false,
    };
    render(<Landing />);
    expect(html.hasAttribute(RETURNING_ATTRIBUTE)).toBe(true);
    expect(replace).toHaveBeenCalledWith("/today");
  });
});
