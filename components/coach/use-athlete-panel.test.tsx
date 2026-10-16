import { act, renderHook } from "@testing-library/react";
import { useAthletePanel } from "./use-athlete-panel";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/coach/athletes/joey",
}));

beforeEach(() => {
  nav.search = "";
  window.history.replaceState(null, "", "/coach/athletes/joey");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Athlete View's overlay, in the URL", () => {
  it("opens with a new history entry, and closing goes back over it", () => {
    // So open, close, Back leaves the coach where they were before the
    // athlete -- not back inside the dialog.
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = renderHook(() => useAthletePanel());
    act(() => result.current.open({ kind: "bodyweight" }));
    expect(push).toHaveBeenCalledWith(null, "", "/coach/athletes/joey?view=bodyweight");
    act(() => result.current.close());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("closes a panel it did not open by replacing the entry, never by leaving the app", () => {
    // A reload or a pasted link: there is nothing of ours behind it.
    nav.search = "view=bodyweight";
    window.history.replaceState(null, "", "/coach/athletes/joey?view=bodyweight");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const replace = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useAthletePanel());
    expect(result.current.panel).toEqual({ kind: "bodyweight" });
    act(() => result.current.close());
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith(null, "", "/coach/athletes/joey");
  });

  it("forgets its entry once the browser's own Back has closed the panel", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useAthletePanel());
    act(() => result.current.open({ kind: "clip", clipId: "set-1" }));
    nav.search = "clip=set-1";
    rerender();
    // The coach pressed Back: the URL has no panel any more.
    nav.search = "";
    rerender();
    act(() => result.current.close());
    expect(back).not.toHaveBeenCalled();
  });

  it("swaps one panel for another without stacking entries", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useAthletePanel());
    act(() => result.current.open({ kind: "clip", clipId: "a" }));
    act(() => result.current.open({ kind: "clip", clipId: "b" }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenLastCalledWith(null, "", "/coach/athletes/joey?clip=b");
  });
});
