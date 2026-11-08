import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Comment } from "@/lib/review/comments";
import { CoachRepliesProvider } from "@/lib/review/coach-replies-context";
import { RepliesInbox } from "./replies-inbox";

const session = vi.hoisted(() => ({ athleteIds: ["joey", "sam"] as string[] }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "ruairi", name: "Ruairi", email: "" },
      coach: { isCoach: true, athleteIds: session.athleteIds },
    },
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/athletes", () => ({
  fetchAthleteNames: vi.fn(async () => [
    { id: "joey", name: "Joey Pang" },
    { id: "sam", name: "Sam Lee" },
  ]),
}));
vi.mock("@/lib/review/queue-store", () => ({
  fetchExerciseNames: vi.fn(async () => new Map([["squat", "Squat"], ["bench", "Bench"]])),
}));
vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({ databaseId: "db" }) }));
vi.mock("@/components/profile/user-avatar", () => ({ UserAvatar: () => null }));

const store = vi.hoisted(() => ({
  fetchThreadComments: vi.fn(),
  fetchThreadReads: vi.fn(),
  saveThreadRead: vi.fn(),
  subscribeToThreads: vi.fn(() => () => {}),
  fetchThreadSets: vi.fn(),
}));
vi.mock("@/lib/review/replies-store", () => store);

const t = (d: number, h = 10) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
const said = (id: string, setId: string, athleteId: string, authorId: string, at: string, body: string): Comment => ({
  id,
  setId,
  athleteId,
  authorId,
  body,
  parentId: null,
  createdAt: at,
  postedAt: at,
});

beforeEach(() => {
  vi.clearAllMocks();
  session.athleteIds = ["joey", "sam"];
  store.fetchThreadComments.mockResolvedValue([
    said("c1", "squat-set", "joey", "ruairi", t(20, 9), "Hips shot up."),
    said("r1", "squat-set", "joey", "joey", t(20), "Felt it. Dropping to 170."),
    said("r2", "bench-set", "sam", "sam", t(22), "Elbows better?"),
    said("c2", "bench-set", "sam", "ruairi", t(22, 12), "Yes."),
  ]);
  store.fetchThreadReads.mockResolvedValue(new Map());
  store.saveThreadRead.mockResolvedValue(undefined);
  store.fetchThreadSets.mockResolvedValue(
    new Map([
      ["squat-set", { athleteId: "joey", exerciseId: "squat", loadKg: 180, reps: 3, rpe: 8, loggedAt: t(19), failed: false }],
      ["bench-set", { athleteId: "sam", exerciseId: "bench", loadKg: 100, reps: 5, rpe: null, loggedAt: t(21), failed: false }],
    ]),
  );
});

const mount = () =>
  render(
    <CoachRepliesProvider coachId="ruairi" athleteIds={session.athleteIds}>
      <RepliesInbox />
    </CoachRepliesProvider>,
  );

it("lists every thread an athlete answered in, newest first, with who, which set and what they said", async () => {
  mount();
  const rows = await screen.findAllByRole("link");
  expect(rows).toHaveLength(2);
  // Sam replied last.
  expect(rows[0]).toHaveTextContent("Sam Lee");
  await waitFor(() => expect(rows[0]).toHaveTextContent("Bench 100 × 5"));
  expect(rows[0]).toHaveTextContent("Elbows better?");
  expect(rows[1]).toHaveTextContent("Joey Pang");
  await waitFor(() => expect(rows[1]).toHaveTextContent("Squat 180 × 3 @8"));
  expect(rows[1]).toHaveTextContent("Felt it. Dropping to 170.");
});

it("marks the unread one, and not the one the coach already answered", async () => {
  mount();
  const [sam, joey] = await screen.findAllByRole("link");
  expect(within(joey).getByText("New")).toBeInTheDocument();
  expect(within(sam).queryByText(/new/i)).not.toBeInTheDocument();
  expect(screen.getByText("1 unread")).toBeInTheDocument();
});

it("opens the thread in the clip dialog over Athlete View and marks it read on the tap", async () => {
  mount();
  const [, joey] = await screen.findAllByRole("link");
  expect(joey).toHaveAttribute("href", "/coach/athletes/joey?clip=squat-set");
  joey.addEventListener("click", (event) => event.preventDefault());
  await userEvent.click(joey);
  expect(store.saveThreadRead).toHaveBeenCalledWith("ruairi", { athleteId: "joey", setId: "squat-set", lastReadAt: t(20) });
  await waitFor(() => expect(screen.getByText("All read")).toBeInTheDocument());
});

it("leaves out a thread of an athlete who has unlinked", async () => {
  session.athleteIds = ["sam"];
  mount();
  const rows = await screen.findAllByRole("link");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("Sam Lee");
});

it("says so when nobody has replied yet", async () => {
  store.fetchThreadComments.mockResolvedValue([said("c1", "squat-set", "joey", "ruairi", t(20), "Hips shot up.")]);
  mount();
  expect(await screen.findByText("No replies yet")).toBeInTheDocument();
});

it("says so when it cannot load", async () => {
  store.fetchThreadComments.mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("Couldn’t load replies")).toBeInTheDocument();
});

it("has a real empty state for a coach with no athletes", () => {
  session.athleteIds = [];
  mount();
  expect(screen.getByText("No replies yet")).toBeInTheDocument();
  expect(store.fetchThreadComments).not.toHaveBeenCalled();
});
