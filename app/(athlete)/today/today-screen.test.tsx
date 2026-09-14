import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodayScreen } from "./today-screen";
import type { SessionRecord } from "@/lib/logging/session";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const training = vi.hoisted(() => ({
  value: {} as ReturnType<typeof import("@/lib/logging/session-context").useTrainingSessions>,
}));
vi.mock("@/lib/logging/session-context", () => ({
  useTrainingSessions: () => training.value,
}));

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  ...overrides,
});

function setup(overrides: Partial<typeof training.value> = {}) {
  const start = vi.fn(async () => session());
  training.value = {
    state: { status: "ready", sessions: [] },
    active: null,
    lastFinished: null,
    start,
    finish: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  } as typeof training.value;
  render(<TodayScreen />);
  return { start, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());

describe("Today, with no program", () => {
  it("says what day it is and that nothing is prescribed", () => {
    setup();
    expect(screen.getByText("Nothing prescribed today.")).toBeInTheDocument();
  });

  it("offers to start on an entirely empty account", () => {
    // Ruairi's first morning. An empty screen that looks broken makes the beta
    // look broken.
    setup();
    expect(screen.getByText("No sessions logged yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a session" })).toBeInTheDocument();
  });

  it("names the last session once there is one", () => {
    setup({ lastFinished: session({ startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date() }) });
    expect(screen.getByText("Last session: Thu")).toBeInTheDocument();
  });

  it("carries no streaks, badges or encouragement", () => {
    // The audience is competitive powerlifters with a coach. The coach supplies
    // the motivation.
    setup({ lastFinished: session({ finishedAt: new Date() }) });
    expect(screen.queryByText(/streak|keep it up|well done|nice work|day in a row/i)).not.toBeInTheDocument();
  });
});

describe("starting and resuming", () => {
  it("starts a session and goes to the logger", async () => {
    const { user, start } = setup();
    await user.click(screen.getByRole("button", { name: "Start a session" }));

    expect(start).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/log");
  });

  it("offers Resume when one is already running", () => {
    setup({ active: session() });
    expect(screen.getByRole("button", { name: "Resume session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a session" })).not.toBeInTheDocument();
  });

  it("shows how long the running session has been going", () => {
    setup({ active: session({ startedAt: new Date(Date.now() - 47 * 60_000 - 12_000) }) });
    expect(screen.getByText(/Session running · 0:47:1\d/)).toBeInTheDocument();
  });

  it("says nothing was lost when a start fails, and leaves the button ready", async () => {
    const start = vi.fn(async () => {
      throw new Error("no signal");
    });
    const { user } = setup({ start: start as never });
    await user.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText(/Nothing was lost/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a session" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
