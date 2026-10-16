import { render, screen } from "@testing-library/react";
import type { DotsResult } from "@/lib/strength/dots";
import { DotsBlock } from "./dots-block";

const store = vi.hoisted(() => ({ fetchDots: vi.fn() }));
vi.mock("@/lib/strength/dots-store", () => store);

const ready = (over: Partial<Extract<DotsResult, { status: "ready" }>> = {}): DotsResult => ({
  status: "ready",
  score: 412.34,
  totalKg: 520,
  bodyweightKg: 82.5,
  measuredOn: "2026-09-02",
  stale: false,
  lifts: [
    { lift: "squat", exerciseId: "sq", valueKg: 180, kind: "tested", asOf: "2026-09-01" },
    { lift: "bench press", exerciseId: "bp", valueKg: 120, kind: "tested", asOf: "2026-09-01" },
    { lift: "deadlift", exerciseId: "dl", valueKg: 220, kind: "tested", asOf: "2026-09-01" },
  ] as Extract<DotsResult, { status: "ready" }>["lifts"],
  ...over,
});

beforeEach(() => {
  store.fetchDots.mockReset();
});

describe("the DOTS block", () => {
  it("shows the score to a tenth and the total it came from", async () => {
    store.fetchDots.mockResolvedValue(ready());
    render(<DotsBlock athleteId="joey" audience="athlete" />);
    expect(await screen.findByText("412.3")).toBeInTheDocument();
    expect(screen.getByText(/from 180 \/ 120 \/ 220/)).toBeInTheDocument();
    // A current weigh-in is not called out.
    expect(screen.queryByText(/82\.5kg/)).not.toBeInTheDocument();
    expect(store.fetchDots).toHaveBeenCalledWith("joey");
  });

  it("dates the bodyweight behind a stale score rather than passing it off as current", async () => {
    store.fetchDots.mockResolvedValue(ready({ stale: true }));
    render(<DotsBlock athleteId="joey" audience="coach" />);
    expect(await screen.findByText("412.3")).toBeInTheDocument();
    expect(screen.getByText(/at 82\.5kg from 2 Sep/)).toBeInTheDocument();
  });

  it("tells the athlete how to get a score, and the coach what he is waiting on", async () => {
    store.fetchDots.mockResolvedValue({ status: "no-bodyweight" });
    const { unmount } = render(<DotsBlock athleteId="joey" audience="athlete" />);
    expect(await screen.findByText("Log a weight and this appears.")).toBeInTheDocument();
    unmount();
    render(<DotsBlock athleteId="joey" audience="coach" />);
    expect(await screen.findByText("Waiting on a weigh-in.")).toBeInTheDocument();
  });

  it("shows nothing rather than an error when the read fails", async () => {
    store.fetchDots.mockRejectedValue(new Error("offline"));
    const { container } = render(<DotsBlock athleteId="joey" audience="athlete" />);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
