import { render, screen } from "@testing-library/react";
import { ClipContext } from "./clip-context";
import type { QueueItem } from "@/lib/review/queue";

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "set-1",
  athleteId: "joey",
  athleteName: "Joey Pang",
  exerciseId: "squat",
  exerciseName: "Squat",
  sessionId: "sess-1",
  setIndex: 1,
  loadKg: 180,
  reps: 3,
  rpe: 8.5,
  e1rmKg: 198,
  loggedAt: "2026-10-04T10:00:00.000Z",
  videoFileId: "file-1",
  notes: null,
  ...over,
});

const show = (over: Partial<QueueItem> = {}) =>
  render(<ClipContext item={item(over)} sessionSets={[]} recent={[]} previousBestKg={null} />);

describe("Prescribed", () => {
  it("shows the snapshot stored on the set, exactly as stored", () => {
    show({ prescriptionId: "l1", prescribed: "3 reps · RPE 8" });
    expect(screen.getByText("Prescribed:")).toBeInTheDocument();
    expect(screen.getByText("3 reps · RPE 8")).toBeInTheDocument();
  });

  it("is absent for a set logged freely, rather than inferred from what was lifted", () => {
    show({ prescriptionId: null, prescribed: null });
    expect(screen.queryByText("Prescribed:")).not.toBeInTheDocument();
  });
});

describe("Adjust program", () => {
  it("opens this athlete's program on the set's line, in a new tab so the queue keeps its place", () => {
    show({ prescriptionId: "l1", prescribed: "3 reps · 175 kg (80%)" });
    const link = screen.getByRole("link", { name: /Adjust program/ });
    expect(link).toHaveAttribute("href", "/coach/programs?athlete=joey&line=l1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("still opens their program when the set was not prescribed", () => {
    show();
    expect(screen.getByRole("link", { name: /Adjust program/ })).toHaveAttribute(
      "href",
      "/coach/programs?athlete=joey",
    );
  });
});

describe("the athlete's note (F11)", () => {
  it("shows what the athlete wrote about the set beside the clip", () => {
    show({ notes: "Hip pinched out of the hole" });
    expect(screen.getByRole("heading", { name: "Athlete note" })).toBeInTheDocument();
    expect(screen.getByText("“Hip pinched out of the hole”")).toBeInTheDocument();
  });

  it("shows nothing for a set with no note", () => {
    show();
    expect(screen.queryByRole("heading", { name: "Athlete note" })).not.toBeInTheDocument();
  });
});

describe("a failed set (F19)", () => {
  it("is marked Failed beside the set's numbers, with no e1RM line", () => {
    show({ loadKg: 200, reps: 0, rpe: 10, e1rmKg: null, failed: true });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText(/^e1RM/)).not.toBeInTheDocument();
  });

  it("marks a missed set among the recent ones, and nothing on a made clip", () => {
    render(
      <ClipContext
        item={item()}
        sessionSets={[]}
        recent={[
          { loggedAt: "2026-10-01T10:00:00.000Z", loadKg: 190, reps: 1, rpe: 10, e1rmKg: null, failed: true },
          { loggedAt: "2026-09-28T10:00:00.000Z", loadKg: 180, reps: 2, rpe: 9, e1rmKg: 192 },
        ]}
        previousBestKg={null}
      />,
    );
    expect(screen.getAllByText("Failed")).toHaveLength(1);
    expect(screen.getByText("Failed").closest("li")).toHaveTextContent("190 kg × 1");
  });
});
