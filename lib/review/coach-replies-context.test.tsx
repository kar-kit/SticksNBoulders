import { act, render, screen, waitFor } from "@testing-library/react";
import type { Comment } from "./comments";
import { CoachRepliesProvider, mergeMarks, useCoachReplies, useMarkThreadRead } from "./coach-replies-context";

/**
 * The shared Replies state (F26): one badge, cleared from wherever the thread
 * is opened, and honest when the write does not land.
 */

const store = vi.hoisted(() => ({
  fetchThreadComments: vi.fn(),
  fetchThreadReads: vi.fn(),
  saveThreadRead: vi.fn(),
  subscribeToThreads: vi.fn(),
}));
vi.mock("./replies-store", () => store);
vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({ databaseId: "db" }) }));

const t = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
const said = (id: string, setId: string, authorId: string, at: string): Comment => ({
  id,
  setId,
  athleteId: "joey",
  authorId,
  body: `${authorId} says`,
  parentId: null,
  createdAt: at,
  postedAt: at,
});

let wake: () => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  store.fetchThreadComments.mockResolvedValue([
    said("c1", "s1", "ruairi", t(9)),
    said("r1", "s1", "joey", t(10)),
    said("r2", "s2", "joey", t(11)),
  ]);
  store.fetchThreadReads.mockResolvedValue(new Map());
  store.saveThreadRead.mockResolvedValue(undefined);
  store.subscribeToThreads.mockImplementation((_db: string, onChange: () => void) => {
    wake = onChange;
    return () => {};
  });
});

function Badge() {
  const { status, unreadCount, markRead } = useCoachReplies();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="count">{unreadCount}</span>
      <button type="button" onClick={() => markRead("s1")}>
        open s1
      </button>
    </div>
  );
}

const mount = (athleteIds: string[] | null = ["joey"], extra: React.ReactNode = null) =>
  render(
    <CoachRepliesProvider coachId="ruairi" athleteIds={athleteIds}>
      <Badge />
      {extra}
    </CoachRepliesProvider>,
  );

it("counts threads with an unread athlete reply", async () => {
  mount();
  await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
  expect(screen.getByTestId("count")).toHaveTextContent("2");
  expect(store.fetchThreadComments).toHaveBeenCalledWith(["joey"]);
  expect(store.fetchThreadReads).toHaveBeenCalledWith("ruairi");
});

it("clears a thread at once when it is opened, and writes the mark through the server's time", async () => {
  mount();
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
  act(() => screen.getByRole("button", { name: "open s1" }).click());
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(store.saveThreadRead).toHaveBeenCalledWith("ruairi", { athleteId: "joey", setId: "s1", lastReadAt: t(10) });
});

it("writes nothing for a thread that is already read", async () => {
  store.fetchThreadReads.mockResolvedValue(new Map([["s1", { athleteId: "joey", lastReadAt: t(10) }]]));
  mount();
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  act(() => screen.getByRole("button", { name: "open s1" }).click());
  expect(store.saveThreadRead).not.toHaveBeenCalled();
});

it("puts the badge back when the write is refused, rather than showing a clear that never landed", async () => {
  store.saveThreadRead.mockRejectedValue(Object.assign(new Error("unauthorized"), { code: 401 }));
  mount();
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
  act(() => screen.getByRole("button", { name: "open s1" }).click());
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
  expect(store.fetchThreadComments).toHaveBeenCalledTimes(2);
});

it("re-reads when a reply or a mark arrives live", async () => {
  mount();
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
  store.fetchThreadReads.mockResolvedValue(
    new Map([
      ["s1", { athleteId: "joey", lastReadAt: t(10) }],
      ["s2", { athleteId: "joey", lastReadAt: t(11) }],
    ]),
  );
  // His laptop read both: the phone's badge clears without a refresh.
  await act(async () => wake());
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
});

it("reads nothing and shows nothing for a coach with nobody linked", async () => {
  mount([]);
  expect(screen.getByTestId("status")).toHaveTextContent("ready");
  expect(screen.getByTestId("count")).toHaveTextContent("0");
  expect(store.fetchThreadComments).not.toHaveBeenCalled();
});

it("is a quiet no-op outside the provider, so screens that mark threads render anywhere", () => {
  render(<Badge />);
  expect(screen.getByTestId("status")).toHaveTextContent("idle");
  act(() => screen.getByRole("button", { name: "open s1" }).click());
  expect(store.saveThreadRead).not.toHaveBeenCalled();
});

describe("useMarkThreadRead", () => {
  function Dialog({ setId, shown }: { setId: string | null; shown: Comment[] }) {
    useMarkThreadRead(setId, shown);
    return null;
  }

  it("marks the open thread as far as the screen shows", async () => {
    mount(["joey"], <Dialog setId="s1" shown={[said("c1", "s1", "ruairi", t(9)), said("r1", "s1", "joey", t(10))]} />);
    await waitFor(() => expect(store.saveThreadRead).toHaveBeenCalledWith("ruairi", { athleteId: "joey", setId: "s1", lastReadAt: t(10) }));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("leaves a reply the screen has not got yet unread", async () => {
    mount(["joey"], <Dialog setId="s1" shown={[said("c1", "s1", "ruairi", t(9))]} />);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(store.saveThreadRead).not.toHaveBeenCalled();
  });

  it("does nothing with no thread open", async () => {
    mount(["joey"], <Dialog setId={null} shown={[]} />);
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(store.saveThreadRead).not.toHaveBeenCalled();
  });
});

describe("mergeMarks", () => {
  it("keeps the later mark per thread", () => {
    const merged = mergeMarks(new Map([["s1", t(10)], ["s2", t(12)]]), new Map([["s1", t(11)], ["s2", t(11)], ["s3", t(1)]]));
    expect([...merged]).toEqual([
      ["s1", t(11)],
      ["s2", t(12)],
      ["s3", t(1)],
    ]);
  });
});
