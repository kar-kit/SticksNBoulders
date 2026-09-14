import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainingSessionProvider, useTrainingSessions } from "./session-context";
import type { SessionRecord } from "./session";

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  ...overrides,
});

function Probe() {
  const { state, active, lastFinished, start, finish } = useTrainingSessions();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="active">{active?.id ?? "none"}</span>
      <span data-testid="last">{lastFinished?.id ?? "none"}</span>
      {/* Swallowed the way the real callers do: a failed start leaves the
          button ready rather than throwing into the void. */}
      <button type="button" onClick={() => void start().catch(() => {})}>start</button>
      <button
        type="button"
        onClick={() => void finish("s1", { setCount: 3, tonnageKg: 900 }).catch(() => {})}
      >
        finish
      </button>
    </div>
  );
}

function setup(options: {
  sessions?: SessionRecord[];
  load?: (id: string) => Promise<SessionRecord[]>;
  start?: ReturnType<typeof vi.fn>;
  finish?: ReturnType<typeof vi.fn>;
  athleteId?: string | null;
} = {}) {
  const start = options.start ?? vi.fn(async () => session({ id: "new" }));
  const finish = options.finish ?? vi.fn(async () => {});
  const load = options.load ?? (async () => options.sessions ?? []);
  render(
    <TrainingSessionProvider
      athleteId={options.athleteId === undefined ? "joey" : options.athleteId}
      load={load}
      start={start as never}
      finish={finish as never}
    >
      <Probe />
    </TrainingSessionProvider>,
  );
  return { start, finish, user: userEvent.setup() };
}

const ready = () => waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

describe("knowing whether a session is running", () => {
  it("finds the live session", async () => {
    setup({ sessions: [session({ id: "live" })] });
    await ready();
    expect(screen.getByTestId("active")).toHaveTextContent("live");
  });

  it("reports none when everything is finished, and names the last one", async () => {
    setup({ sessions: [session({ id: "done", finishedAt: new Date("2026-09-14T10:00:00Z") })] });
    await ready();
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(screen.getByTestId("last")).toHaveTextContent("done");
  });

  it("keeps working when the read fails, rather than blocking training", async () => {
    setup({ load: async () => { throw new Error("no signal"); } });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("failed"));
  });
});

describe("starting a session", () => {
  it("writes one and holds it as active", async () => {
    const { user, start } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "start" }));

    expect(start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("new"));
  });

  it("resumes the running one instead of starting a second", async () => {
    // Two live sessions is a state to avoid creating, not just to survive.
    const { user, start } = setup({ sessions: [session({ id: "live" })] });
    await ready();
    await user.click(screen.getByRole("button", { name: "start" }));

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByTestId("active")).toHaveTextContent("live");
  });

  it("reuses the same client id when a first attempt failed", async () => {
    // client_session_id is unique-indexed so a retry recovers the first
    // attempt's session rather than creating a twin. Minting a new id on retry
    // would defeat the index entirely.
    const ids: string[] = [];
    const start = vi.fn(async (_actor: unknown, clientId: string) => {
      ids.push(clientId);
      if (ids.length === 1) throw new Error("timeout");
      return session({ id: "recovered", clientSessionId: clientId });
    });
    const { user } = setup({ start });
    await ready();

    await user.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(ids).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "start" }));

    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[0]).toBe(ids[1]);
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("recovered"));
  });

  it("refuses to start without a signed-in athlete rather than writing an orphan", async () => {
    const { user, start } = setup({ athleteId: null });
    await ready();
    await user.click(screen.getByRole("button", { name: "start" }));
    expect(start).not.toHaveBeenCalled();
  });
});

describe("finishing a session", () => {
  it("writes the totals and stops reporting it as active", async () => {
    const { user, finish } = setup({ sessions: [session({ id: "s1" })] });
    await ready();
    await user.click(screen.getByRole("button", { name: "finish" }));

    expect(finish).toHaveBeenCalledWith(
      { userId: "joey" },
      "s1",
      { setCount: 3, tonnageKg: 900 },
      expect.any(Date),
    );
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("none"));
    expect(screen.getByTestId("last")).toHaveTextContent("s1");
  });
});
