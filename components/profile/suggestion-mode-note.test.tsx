import { render, screen } from "@testing-library/react";
import { SuggestionModeNote } from "./suggestion-mode-note";

const hook = vi.hoisted(() => ({ value: { mode: "direct", source: "live" } as { mode: string; source: string } }));
vi.mock("@/lib/coach/use-suggestion-mode", () => ({ useSuggestionMode: () => hook.value }));

describe("SuggestionModeNote", () => {
  it("tells an athlete their coach holds suggestions", () => {
    hook.value = { mode: "held", source: "live" };
    render(<SuggestionModeNote athleteId="joey" isCoach={false} />);
    expect(screen.getByText(/Your coach has load suggestions held/)).toBeInTheDocument();
  });

  it("says so from the cached copy too, with no signal", () => {
    hook.value = { mode: "held", source: "cached" };
    render(<SuggestionModeNote athleteId="joey" isCoach={false} />);
    expect(screen.getByText(/Your coach has load suggestions held/)).toBeInTheDocument();
  });

  it("does not claim the coach held them when the device has simply never been told", () => {
    hook.value = { mode: "held", source: "unknown" };
    const { container } = render(<SuggestionModeNote athleteId="joey" isCoach={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing to an athlete whose suggestions are direct", () => {
    hook.value = { mode: "direct", source: "live" };
    const { container } = render(<SuggestionModeNote athleteId="joey" isCoach={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells a coach where the switch lives", () => {
    hook.value = { mode: "direct", source: "live" };
    render(<SuggestionModeNote athleteId="ruairi" isCoach />);
    expect(screen.getByText(/set on their page in coach mode/)).toBeInTheDocument();
  });
});
