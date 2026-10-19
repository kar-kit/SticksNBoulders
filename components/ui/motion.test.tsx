import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { afterExit, exitDuration, flash, useArrivals, useChanged, usePresence } from "./motion";

/**
 * jsdom loads no stylesheet, so every computed duration is zero there. Tests
 * that need an exit to take time say so through getComputedStyle, which is
 * exactly what the helpers read in a browser.
 */
function lasting(ms: number) {
  const real = window.getComputedStyle;
  return vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    return new Proxy(style, {
      get: (target, key) =>
        key === "transitionDuration" ? `${ms / 1000}s` : key === "transitionDelay" ? "0s" : Reflect.get(target, key),
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePresence", () => {
  it("keeps the last value on screen while it leaves, until the exit has played", () => {
    const { result, rerender } = renderHook(({ value }) => usePresence(value), {
      initialProps: { value: "clip-1" as string | null },
    });
    expect(result.current).toMatchObject({ shown: "clip-1", leaving: false });

    rerender({ value: null });
    expect(result.current).toMatchObject({ shown: "clip-1", leaving: true });

    act(() => result.current.exited());
    expect(result.current).toMatchObject({ shown: null, leaving: false });
  });

  it("cancels the exit when the value comes back, and swaps to a new one in place", () => {
    const { result, rerender } = renderHook(({ value }) => usePresence(value), {
      initialProps: { value: "clip-1" as string | null },
    });
    rerender({ value: null });
    rerender({ value: "clip-2" });
    expect(result.current).toMatchObject({ shown: "clip-2", leaving: false });
  });

  it("treats false as closed, for a boolean open", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
    expect(result.current.shown).toBeNull();
    rerender({ open: true });
    expect(result.current).toMatchObject({ shown: true, leaving: false });
    rerender({ open: false });
    expect(result.current).toMatchObject({ shown: true, leaving: true });
  });
});

describe("useArrivals", () => {
  it("marks nothing new on the first render, then only what was added", () => {
    const { result, rerender } = renderHook(({ ids }) => useArrivals(ids, "day-1"), {
      initialProps: { ids: ["l1", "l2"] },
    });
    expect(result.current("l1")).toBe(false);
    rerender({ ids: ["l1", "l2", "l3"] });
    expect(result.current("l3")).toBe(true);
    expect(result.current("l1")).toBe(false);
  });

  it("keeps an arrival marked across re-renders until the list changes again, so its animation is not cut off", () => {
    const { result, rerender } = renderHook(({ ids }) => useArrivals(ids, "w"), { initialProps: { ids: ["a"] } });
    rerender({ ids: ["a", "b"] });
    rerender({ ids: ["a", "b"] });
    expect(result.current("b")).toBe(true);
    rerender({ ids: ["a"] });
    expect(result.current("b")).toBe(false);
  });

  it("resets without marking anything on a new scope: another week is a replacement, not an addition", () => {
    const { result, rerender } = renderHook(({ ids, scope }) => useArrivals(ids, scope), {
      initialProps: { ids: ["a", "b"], scope: "week-1" },
    });
    rerender({ ids: ["x", "y"], scope: "week-2" });
    expect(result.current("x")).toBe(false);
    expect(result.current("y")).toBe(false);
  });
});

describe("useChanged", () => {
  it("is false for the value it mounted with and true once it changes", () => {
    const { result, rerender } = renderHook(({ v }) => useChanged(v), { initialProps: { v: "draft" } });
    expect(result.current).toBe(false);
    rerender({ v: "draft" });
    expect(result.current).toBe(false);
    rerender({ v: "live" });
    expect(result.current).toBe(true);
  });
});

describe("flash", () => {
  it("tints an element and clears the tint when its animation ends, so the next one plays", () => {
    const { container } = render(<div className="flash-host" />);
    const el = container.firstElementChild!;
    flash(el, "saved");
    expect(el).toHaveAttribute("data-flash", "saved");
    fireEvent.animationEnd(el);
    expect(el).not.toHaveAttribute("data-flash");
  });

  it("ignores an animation ending on a child", () => {
    const { container } = render(
      <div>
        <span />
      </div>,
    );
    const el = container.firstElementChild!;
    flash(el, "failed");
    fireEvent.animationEnd(el.querySelector("span")!);
    expect(el).toHaveAttribute("data-flash", "failed");
  });

  it("is a no-op without an element", () => {
    expect(() => flash(null, "landed")).not.toThrow();
  });
});

describe("afterExit", () => {
  it("finishes at once when the element has nothing to play (jsdom, reduced motion)", () => {
    const done = vi.fn();
    const { container } = render(<div />);
    expect(exitDuration(container.firstElementChild)).toBe(0);
    afterExit(container.firstElementChild, done);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("waits for the element's own transition to end", () => {
    lasting(180);
    const done = vi.fn();
    const { container } = render(
      <div>
        <span />
      </div>,
    );
    const el = container.firstElementChild!;
    expect(exitDuration(el)).toBe(180);
    afterExit(el, done);
    expect(done).not.toHaveBeenCalled();
    fireEvent.transitionEnd(el.querySelector("span")!);
    expect(done).not.toHaveBeenCalled();
    fireEvent.transitionEnd(el);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting after the computed duration, in case the event never comes", () => {
    vi.useFakeTimers();
    lasting(180);
    const done = vi.fn();
    const { container } = render(<div />);
    afterExit(container.firstElementChild, done);
    vi.advanceTimersByTime(250);
    expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("can be cancelled", () => {
    lasting(180);
    const done = vi.fn();
    const { container } = render(<div />);
    const cancel = afterExit(container.firstElementChild, done);
    cancel();
    fireEvent.transitionEnd(container.firstElementChild!);
    expect(done).not.toHaveBeenCalled();
  });
});
