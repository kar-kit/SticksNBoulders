import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteShell } from "./athlete-shell";
import { CoachShell } from "./coach-shell";
import type { SessionState } from "@/lib/auth/session-context";

const replace = vi.fn();
const push = vi.fn();
const nav = vi.hoisted(() => ({ pathname: "/today" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => nav.pathname,
}));

const session = vi.hoisted(() => ({ state: { status: "loading" } as SessionState }));
vi.mock("@/lib/auth/session-context", async () => {
  const react = await import("react");
  return {
    useSession: () => ({ state: session.state, refresh: vi.fn() }),
    useRequireSession: () => {
      const router = { replace };
      react.useEffect(() => {
        if (session.state.status === "signed-out") router.replace("/sign-in");
      }, []);
      return session.state;
    },
  };
});

const SIGNED_IN: SessionState = {
  status: "signed-in",
  user: { id: "u1", name: "Joey Pang", email: "joey@example.com" },
  coach: { isCoach: false, athleteIds: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/today";
  session.state = SIGNED_IN;
});

describe("AthleteShell", () => {
  it("renders the page inside the four-tab shell", () => {
    render(<AthleteShell><p>Session content</p></AthleteShell>);
    expect(screen.getByText("Session content")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("paints the chrome before the session resolves, but not the content", () => {
    // Resolving the session costs an Appwrite round trip. Gating the whole
    // shell on it meant no first contentful paint at all on a cold load --
    // measured, not guessed.
    session.state = { status: "loading" };
    render(<AthleteShell><p>Session content</p></AthleteShell>);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.queryByText("Session content")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("sends a signed-out visitor to sign in, and renders no content on the way", () => {
    session.state = { status: "signed-out" };
    render(<AthleteShell><p>Session content</p></AthleteShell>);
    expect(replace).toHaveBeenCalledWith("/sign-in");
    // The chrome may flash for a frame; the athlete's data never does.
    expect(screen.queryByText("Session content")).not.toBeInTheDocument();
  });

  it("keeps the tab bar outside the scrolling region", () => {
    // A tab bar that scrolls away is one a thumb has to hunt for mid-set.
    const { container } = render(<AthleteShell><p>Content</p></AthleteShell>);
    const main = container.querySelector("main");
    expect(main?.className).toContain("overflow-y-auto");
    expect(main?.querySelector("nav")).toBeNull();
  });
});

describe("CoachShell", () => {
  const athletes = [
    { id: "a1", name: "Joey Pang", needsAttention: true },
    { id: "a2", name: "Sam Tierney" },
  ];

  it("keeps the athlete rail on every screen", () => {
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    expect(screen.getByText("Joey P")).toBeInTheDocument();
    expect(screen.getByText("Sam T")).toBeInTheDocument();
  });

  it("marks who needs attention", () => {
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    expect(screen.getAllByLabelText("Needs attention")).toHaveLength(1);
  });

  it("says so plainly when there is nobody yet", () => {
    render(<CoachShell athletes={[]}>content</CoachShell>);
    expect(screen.getByText("Nobody yet.")).toBeInTheDocument();
  });

  it("shows the review count, which is the one number to see on opening a tab", () => {
    render(<CoachShell athletes={athletes} reviewCount={7}>content</CoachShell>);
    expect(screen.getByRole("link", { name: /Review/ })).toHaveTextContent("7");
  });

  it("shows no count at zero, because a 0 is noise", () => {
    render(<CoachShell athletes={athletes} reviewCount={0}>content</CoachShell>);
    expect(screen.getByRole("link", { name: "Review" }).textContent).toBe("Review");
  });

  it("marks the current section", () => {
    nav.pathname = "/coach/review";
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Roster" })).not.toHaveAttribute("aria-current");
  });

  it("switches to athlete mode on the same account", async () => {
    // One account, two modes. Role is a relationship, not an account type.
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    await userEvent.click(screen.getByRole("button", { name: "Athlete mode" }));
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("shows the coach's own initials", () => {
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    expect(screen.getByText("JP")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in", () => {
    session.state = { status: "signed-out" };
    render(<CoachShell athletes={athletes}>content</CoachShell>);
    expect(replace).toHaveBeenCalledWith("/sign-in");
    expect(screen.queryByText("Nobody yet.")).not.toBeInTheDocument();
  });
});
