import { renderHook } from "@testing-library/react";
import { isEditable, releaseKeyboard, resetKeyboardScroll, useKeyboardGapGuard } from "./keyboard-gap";

/** A field in the page, focused, the way a tap leaves one under the keyboard. */
function focusField(tag: "input" | "textarea" = "input", type = "text"): HTMLElement {
  const el = document.createElement(tag);
  if (el instanceof HTMLInputElement) el.type = type;
  document.body.append(el);
  el.focus();
  return el;
}

/**
 * A window the keyboard left scrolled by `by`. jsdom does no layout, so
 * scrollY and the scrolling element's scrollTop are stubbed together and
 * scrollTo puts both back, as a browser would.
 */
function scrolledWindow(by: number, rootTop = by) {
  const root = { scrollTop: rootTop };
  const win = {
    scrollY: by,
    document: { activeElement: document.activeElement, scrollingElement: root },
    scrollTo: vi.fn(() => {
      win.scrollY = 0;
      root.scrollTop = 0;
    }),
  };
  return { win: win as unknown as Window, root, scrollTo: win.scrollTo };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isEditable", () => {
  it("counts the fields that raise a keyboard", () => {
    for (const type of ["text", "search", "number", "email", "password", "tel", "url"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(isEditable(input)).toBe(true);
    }
    expect(isEditable(document.createElement("textarea"))).toBe(true);
  });

  it("does not count controls, read-only or disabled fields, or nothing", () => {
    for (const type of ["button", "checkbox", "radio", "range", "submit", "file"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(isEditable(input)).toBe(false);
    }
    const readOnly = document.createElement("input");
    readOnly.readOnly = true;
    const disabled = document.createElement("textarea");
    disabled.disabled = true;
    expect(isEditable(readOnly)).toBe(false);
    expect(isEditable(disabled)).toBe(false);
    expect(isEditable(document.createElement("button"))).toBe(false);
    expect(isEditable(document.body)).toBe(false);
    expect(isEditable(null)).toBe(false);
  });

  it("counts contenteditable", () => {
    const div = document.createElement("div");
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditable(div)).toBe(true);
  });
});

describe("releaseKeyboard", () => {
  it("blurs the field holding the keyboard", () => {
    const field = focusField();
    const out = vi.fn();
    field.addEventListener("focusout", out);
    releaseKeyboard();
    expect(document.activeElement).not.toBe(field);
    // The point of calling it before an unmount: the guard hears this.
    expect(out).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone anywhere else", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    releaseKeyboard();
    expect(document.activeElement).toBe(button);
  });
});

describe("resetKeyboardScroll", () => {
  it("puts a document the keyboard left scrolled back at the top", () => {
    const { win, root, scrollTo } = scrolledWindow(336);
    expect(resetKeyboardScroll(win)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(win.scrollY).toBe(0);
    expect(root.scrollTop).toBe(0);
  });

  it("catches the scrolling element off on its own", () => {
    const { win, root, scrollTo } = scrolledWindow(0, 336);
    expect(resetKeyboardScroll(win)).toBe(true);
    expect(scrollTo).toHaveBeenCalled();
    expect(root.scrollTop).toBe(0);
  });

  it("sets the scrolling element directly if scrollTo left it", () => {
    const { win, root } = scrolledWindow(336);
    (win as unknown as { scrollTo: () => void }).scrollTo = vi.fn();
    resetKeyboardScroll(win);
    expect(root.scrollTop).toBe(0);
  });

  it("does nothing when nothing is scrolled", () => {
    const { win, scrollTo } = scrolledWindow(0);
    expect(resetKeyboardScroll(win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never jumps while a field still holds the keyboard", () => {
    // That scroll is iOS keeping the field in view, mid-word.
    focusField();
    const { win, scrollTo } = scrolledWindow(336);
    expect(resetKeyboardScroll(win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("survives a document with no scrolling element", () => {
    const win = { scrollY: 0, document: { activeElement: null, scrollingElement: null }, scrollTo: vi.fn() };
    expect(resetKeyboardScroll(win as unknown as Window)).toBe(false);
  });
});

describe("useKeyboardGapGuard", () => {
  let frames: FrameRequestCallback[];
  let scrollTo: ReturnType<typeof vi.fn>;
  let viewport: EventTarget;
  let main: HTMLElement;

  const flushFrames = () => {
    const due = frames;
    frames = [];
    for (const cb of due) cb(0);
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => {};
    });
    viewport = new EventTarget();
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    // The keyboard's leftover: the window shifted up by its height.
    Object.defineProperty(window, "scrollY", { value: 336, configurable: true, writable: true });
    scrollTo = vi.fn(() => {
      window.scrollY = 0;
    });
    vi.stubGlobal("scrollTo", scrollTo);
    // <main>, scrolled to the athlete's place in the list.
    main = document.createElement("main");
    main.scrollTop = 900;
    document.body.append(main);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).visualViewport;
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  });

  it("resets the document once focus leaves for somewhere that is not a field", () => {
    renderHook(() => useKeyboardGapGuard());
    const field = focusField();
    field.blur();
    // Not on the focusout itself: focus has not landed yet.
    expect(scrollTo).not.toHaveBeenCalled();
    flushFrames();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(window.scrollY).toBe(0);
  });

  it("does not reset when focus moves on to another field", () => {
    renderHook(() => useKeyboardGapGuard());
    focusField();
    focusField();
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("resets when the keyboard closes without a focusout", () => {
    // A focused field unmounted by a re-render: WebKit fires nothing, but the
    // visual viewport grows back as the keyboard goes.
    renderHook(() => useKeyboardGapGuard());
    viewport.dispatchEvent(new Event("resize"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("ignores a viewport resize while a field is still focused", () => {
    renderHook(() => useKeyboardGapGuard());
    focusField();
    viewport.dispatchEvent(new Event("resize"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never touches <main>'s own scroll", () => {
    renderHook(() => useKeyboardGapGuard());
    focusField().blur();
    flushFrames();
    viewport.dispatchEvent(new Event("resize"));
    expect(main.scrollTop).toBe(900);
  });

  it("stops listening when the shell unmounts", () => {
    const { unmount } = renderHook(() => useKeyboardGapGuard());
    const field = focusField();
    unmount();
    field.blur();
    flushFrames();
    viewport.dispatchEvent(new Event("resize"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("drops a pending check on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardGapGuard());
    focusField().blur();
    unmount();
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("works without a visualViewport, on focusout alone", () => {
    delete (window as unknown as Record<string, unknown>).visualViewport;
    renderHook(() => useKeyboardGapGuard());
    focusField().blur();
    flushFrames();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
