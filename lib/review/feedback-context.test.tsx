import { act, render, screen, waitFor } from "@testing-library/react";
import { FeedbackProvider, useFeedbackBadge } from "./feedback-context";
import { readSeenAt, writeSeenAt } from "./feedback-seen";

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({ state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } } }),
}));

const store = vi.hoisted(() => ({
  fetchUnreadCount: vi.fn(),
  fetchHasCoach: vi.fn(async () => true),
  subscribeToComments: vi.fn(() => () => {}),
}));
vi.mock("./feedback-store", () => store);

/** Two clips with something new from the coach, after the watermark. */
const COMMENTS = [
  { setId: "s1", createdAt: "2026-10-06T20:00:00.000Z" },
  { setId: "s2", createdAt: "2026-10-06T19:00:00.000Z" },
];

function Probe() {
  const { unread, markSetSeen } = useFeedbackBadge();
  return (
    <>
      <p>unread {unread}</p>
      <button type="button" onClick={() => markSetSeen("s1", "2026-10-06T20:00:00.000Z")}>
        read s1
      </button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  writeSeenAt("joey", "2026-10-01T00:00:00.000Z");
  // Counts like the real store: after the watermark, minus clips read since.
  store.fetchUnreadCount.mockImplementation(
    async (_athleteId: string, seenAt: string | null, setSeen: Record<string, string> = {}) =>
      COMMENTS.filter((c) => !seenAt || c.createdAt > seenAt).filter(
        (c) => !setSeen[c.setId] || c.createdAt > setSeen[c.setId],
      ).length,
  );
});

it("reading one clip's thread clears that clip from the dot and leaves the other counted (F15)", async () => {
  render(
    <FeedbackProvider>
      <Probe />
    </FeedbackProvider>,
  );
  expect(await screen.findByText("unread 2")).toBeInTheDocument();

  act(() => screen.getByRole("button", { name: "read s1" }).click());

  expect(await screen.findByText("unread 1")).toBeInTheDocument();
  await waitFor(() =>
    expect(store.fetchUnreadCount).toHaveBeenLastCalledWith("joey", "2026-10-01T00:00:00.000Z", {
      s1: "2026-10-06T20:00:00.000Z",
    }),
  );
  // The Feedback screen's watermark has not moved: s2 is still news there.
  expect(readSeenAt("joey")).toBe("2026-10-01T00:00:00.000Z");
});
