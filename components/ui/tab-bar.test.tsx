import { render, screen } from "@testing-library/react";
import { TabBar } from "./tab-bar";

const pathname = vi.hoisted(() => ({ current: "/today" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const badge = vi.hoisted(() => ({ unread: 0 }));
vi.mock("@/lib/review/feedback-context", () => ({
  useFeedbackBadge: () => ({ unread: badge.unread }),
}));

beforeEach(() => {
  badge.unread = 0;
});

describe("TabBar", () => {
  it("offers exactly four tabs", () => {
    // Four, no more. A fifth means something else is wrong.
    pathname.current = "/today";
    render(<TabBar />);
    expect(screen.getAllByRole("link")).toHaveLength(4);
    for (const label of ["Today", "Log", "History", "Me"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current tab", () => {
    pathname.current = "/log";
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Log" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the parent tab lit on a sub-route", () => {
    // /history/abc123 is still History.
    pathname.current = "/history/abc123";
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  });

  it("does not light a tab whose href is only a prefix of the path", () => {
    // /logbook must not light /log.
    pathname.current = "/logbook";
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Log" })).not.toHaveAttribute("aria-current");
  });

  it("dots Today when the coach has said something new, since Coach Feedback lives under it", () => {
    pathname.current = "/log";
    badge.unread = 2;
    render(<TabBar />);
    expect(screen.getAllByTestId("feedback-dot")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Today.*new coach feedback/ })).toHaveAttribute("href", "/today");
  });

  it("shows no dot when there is nothing new", () => {
    render(<TabBar />);
    expect(screen.queryByTestId("feedback-dot")).not.toBeInTheDocument();
  });
});
