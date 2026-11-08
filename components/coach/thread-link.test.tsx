import { render, screen, waitFor } from "@testing-library/react";
import { ThreadLink } from "./thread-link";

/**
 * `/coach/replies/<setId>`, the link F27's push notifications open: whose set,
 * then a hand-over to the clip dialog -- or a plain refusal.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const session = vi.hoisted(() => ({ athleteIds: ["joey"] as string[] }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "ruairi", name: "Ruairi", email: "" }, coach: { isCoach: true, athleteIds: session.athleteIds } },
    refresh: vi.fn(),
  }),
}));

const replies = vi.hoisted(() => ({ threads: [] as { setId: string; athleteId: string }[], markRead: vi.fn() }));
vi.mock("@/lib/review/coach-replies-context", () => ({
  useCoachReplies: () => ({ status: "ready", threads: replies.threads, unreadCount: 0, markRead: replies.markRead }),
}));

const store = vi.hoisted(() => ({ fetchSetOwner: vi.fn() }));
vi.mock("@/lib/review/replies-store", () => store);

beforeEach(() => {
  vi.clearAllMocks();
  session.athleteIds = ["joey"];
  replies.threads = [];
});

it("opens a thread from the inbox without another read, marking it read", async () => {
  replies.threads = [{ setId: "s1", athleteId: "joey" }];
  render(<ThreadLink setId="s1" />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/coach/athletes/joey?clip=s1"));
  expect(replies.markRead).toHaveBeenCalledWith("s1");
  expect(store.fetchSetOwner).not.toHaveBeenCalled();
});

it("finds whose set it is when opened cold, before the inbox has loaded", async () => {
  store.fetchSetOwner.mockResolvedValue("joey");
  render(<ThreadLink setId="s9" />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/coach/athletes/joey?clip=s9"));
});

it("refuses a set the coach cannot read", async () => {
  store.fetchSetOwner.mockResolvedValue(null);
  render(<ThreadLink setId="gone" />);
  expect(await screen.findByText("This thread isn’t available")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to Replies" })).toHaveAttribute("href", "/coach/replies");
  expect(replace).not.toHaveBeenCalled();
});

it("refuses a thread of an athlete who has since unlinked, even one still in the inbox", async () => {
  session.athleteIds = [];
  replies.threads = [{ setId: "s1", athleteId: "joey" }];
  render(<ThreadLink setId="s1" />);
  expect(await screen.findByText("This thread isn’t available")).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
  expect(replies.markRead).not.toHaveBeenCalled();
});
