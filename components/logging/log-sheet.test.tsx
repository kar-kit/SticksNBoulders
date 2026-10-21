import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { LogSheet, revealDelta, REVEAL_GAP_PX } from "./log-sheet";

describe("revealDelta", () => {
  const viewport = { top: 0, bottom: 852 };

  it("scrolls a row under the sheet up to just above it", () => {
    // Visible area ends at 852 - 380 - 12 = 460.
    expect(revealDelta({ top: 700, bottom: 764 }, viewport, 380)).toBe(304);
  });

  it("leaves a row that is already clear of the sheet alone", () => {
    expect(revealDelta({ top: 300, bottom: 364 }, viewport, 380)).toBe(0);
    expect(revealDelta({ top: 300, bottom: 852 - 380 - REVEAL_GAP_PX }, viewport, 380)).toBe(0);
  });

  it("scrolls back up to a row above the top edge", () => {
    expect(revealDelta({ top: -100, bottom: -36 }, viewport, 380)).toBe(-112);
  });

  it("measures from the scroll container, not the window", () => {
    expect(revealDelta({ top: 700, bottom: 764 }, { top: 60, bottom: 776 }, 380)).toBe(764 - (776 - 380 - 12));
  });
});

function Host({ open }: { open: boolean }) {
  const anchor = useRef<Element | null>(null);
  return (
    <LogSheet anchor={anchor} revealKey={open ? "row:load" : null}>
      {open ? <section aria-label="Pad">keys</section> : null}
    </LogSheet>
  );
}

describe("LogSheet", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing while closed and slides in when opened", () => {
    const { rerender } = render(<Host open={false} />);
    expect(document.querySelector("[data-log-sheet]")).toBeNull();
    rerender(<Host open />);
    const sheet = document.querySelector("[data-log-sheet]")!;
    expect(sheet).toContainElement(screen.getByRole("region", { name: "Pad" }));
    expect(sheet.className).toContain("motion-safe:animate-sheet-in");
    expect(sheet.className).toContain("sticky");
    expect(sheet.className).toContain("bottom-0");
  });

  it("unmounts at once when there is no exit to wait for (jsdom, reduced motion)", () => {
    const { rerender } = render(<Host open />);
    rerender(<Host open={false} />);
    expect(document.querySelector("[data-log-sheet]")).toBeNull();
  });

  it("stays, inert, while it slides out, and goes when the slide ends", () => {
    // A stylesheet that gives the sheet a 240ms exit, as sheet-out does.
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (!(el as Element).hasAttribute("data-log-sheet")) return style;
      return { ...style, animationName: "sheet-out", animationDuration: "240ms", animationDelay: "0s",
        transitionDuration: "0s", transitionDelay: "0s" } as CSSStyleDeclaration;
    });
    const { rerender } = render(<Host open />);
    rerender(<Host open={false} />);

    const sheet = document.querySelector("[data-log-sheet]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.className).toContain("motion-safe:animate-sheet-out");
    expect(sheet).toHaveAttribute("inert");
    // Still painted, no longer a thing to press.
    expect(screen.queryByRole("region", { name: "Pad" })).not.toBeInTheDocument();
    expect(sheet).toHaveTextContent("keys");

    act(() => {
      fireEvent.animationEnd(sheet);
    });
    expect(document.querySelector("[data-log-sheet]")).toBeNull();
  });

  it("comes back mid-exit without unmounting", () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (!(el as Element).hasAttribute("data-log-sheet")) return style;
      return { ...style, animationName: "sheet-out", animationDuration: "240ms", animationDelay: "0s",
        transitionDuration: "0s", transitionDelay: "0s" } as CSSStyleDeclaration;
    });
    const { rerender } = render(<Host open />);
    const first = document.querySelector("[data-log-sheet]");
    rerender(<Host open={false} />);
    rerender(<Host open />);
    const sheet = document.querySelector("[data-log-sheet]")!;
    expect(sheet).toBe(first);
    expect(sheet).not.toHaveAttribute("inert");
    expect(sheet.className).toContain("motion-safe:animate-sheet-in");
  });
});
