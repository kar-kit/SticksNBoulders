import { render, screen, waitFor } from "@testing-library/react";
import { DepartureNotice } from "./departure-notice";

const links = vi.hoisted(() => ({ fetchCoachLinks: vi.fn() }));
vi.mock("@/lib/coach/coach-links-store", () => links);

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "coach", name: "Ruairi Deane", email: "r@example.com" },
      coach: { isCoach: false, athleteIds: [] },
    },
    refresh: vi.fn(),
  }),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

it("says quietly that an athlete left, with no name", async () => {
  links.fetchCoachLinks.mockResolvedValue([{ athleteId: "joey", status: "revoked", revokedAt: daysAgo(1) }]);
  render(<DepartureNotice />);
  const notice = await screen.findByRole("status");
  expect(notice).toHaveTextContent(/^An athlete stopped sharing their training with you on \d+ [A-Z][a-z]{2}\.$/);
  expect(notice).not.toHaveTextContent("joey");
});

it("renders nothing when nobody left recently", async () => {
  links.fetchCoachLinks.mockResolvedValue([
    { athleteId: "sam", status: "active", revokedAt: null },
    { athleteId: "old", status: "revoked", revokedAt: daysAgo(40) },
  ]);
  const { container } = render(<DepartureNotice />);
  await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("renders nothing when the read fails, rather than an error box", async () => {
  links.fetchCoachLinks.mockRejectedValue(new Error("offline"));
  const { container } = render(<DepartureNotice />);
  await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it("uses records it is handed instead of reading them again", async () => {
  links.fetchCoachLinks.mockClear();
  render(<DepartureNotice records={[{ athleteId: "joey", status: "revoked", revokedAt: daysAgo(2) }]} />);
  expect(screen.getByRole("status")).toHaveTextContent(/^An athlete stopped sharing/);
  expect(links.fetchCoachLinks).not.toHaveBeenCalled();
});

it("renders nothing while handed records are still loading", () => {
  const { container } = render(<DepartureNotice records={null} />);
  expect(container).toBeEmptyDOMElement();
});
