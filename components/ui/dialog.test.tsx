import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./dialog";
import { usePresence } from "./motion";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {open ? (
        <Dialog
          labelledBy="title"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <h2 id="title">Bodyweight</h2>
          <button type="button">Inside</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe("Dialog", () => {
  it("is a dialog named by its heading", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("dialog", { name: "Bodyweight" })).toBeInTheDocument();
  });

  it("asks to close on Escape, once, even when the key arrives twice over", async () => {
    // One Escape can be both a keydown and the native `cancel`; two close
    // requests walk history back twice and take the coach off the page.
    const onClose = vi.fn();
    render(
      <Dialog labelledBy="t" onClose={onClose}>
        <h2 id="t">Clip</h2>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Clip" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not take a file picker's cancel, bubbling up from inside, as a close request", () => {
    // `<input type="file">` fires a bubbling `cancel` when its picker is
    // dismissed. That is the picker closing, not the dialog.
    const onClose = vi.fn();
    render(
      <Dialog labelledBy="t" onClose={onClose}>
        <h2 id="t">Clip</h2>
        <input type="file" aria-label="Clip file" />
      </Dialog>,
    );
    fireEvent(screen.getByLabelText("Clip file"), new Event("cancel", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(screen.getByRole("dialog", { name: "Clip" }), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click on the backdrop, not on its contents", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog labelledBy="t" onClose={onClose}>
        <h2 id="t">Clip</h2>
        <button type="button">Inside</button>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands focus back to whatever opened it", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    screen.getByRole("button", { name: "Inside" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  describe("leaving", () => {
    /** Opened by a button, closed by the URL; kept mounted by usePresence, as the Athlete View does. */
    function Presence({ onExited }: { onExited?: () => void }) {
      const [open, setOpen] = useState(false);
      const shown = usePresence(open);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open it
          </button>
          {shown.shown ? (
            <Dialog
              labelledBy="t"
              onClose={() => setOpen(false)}
              leaving={shown.leaving}
              onExited={() => {
                onExited?.();
                shown.exited();
              }}
            >
              <h2 id="t">Bodyweight</h2>
            </Dialog>
          ) : null}
        </>
      );
    }

    function fading(ms: number) {
      const real = window.getComputedStyle;
      vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
        const style = real(el, pseudo);
        if (!(el instanceof HTMLDialogElement)) return style;
        return new Proxy(style, {
          get: (target, key) =>
            key === "transitionDuration" ? `${ms / 1000}s` : key === "transitionDelay" ? "0s" : Reflect.get(target, key),
        });
      });
    }

    afterEach(() => vi.restoreAllMocks());

    it("stays mounted while it fades out -- closed, hidden and focus already handed back -- then unmounts", async () => {
      fading(180);
      const onExited = vi.fn();
      const user = userEvent.setup();
      render(<Presence onExited={onExited} />);
      const opener = screen.getByRole("button", { name: "Open it" });
      await user.click(opener);
      const dialog = screen.getByRole("dialog", { name: "Bodyweight" });

      fireEvent.keyDown(dialog, { key: "Escape" });

      // Still in the document, fading...
      expect(dialog).toBeInTheDocument();
      expect(dialog).not.toHaveAttribute("open");
      // ...but already gone for everyone using it.
      expect(dialog).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
      expect(onExited).not.toHaveBeenCalled();

      fireEvent.transitionEnd(dialog);
      expect(onExited).toHaveBeenCalledTimes(1);
      expect(dialog).not.toBeInTheDocument();
    });

    it("unmounts at once when there is nothing to play (reduced motion)", async () => {
      const user = userEvent.setup();
      render(<Presence />);
      await user.click(screen.getByRole("button", { name: "Open it" }));
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(document.querySelector("dialog")).toBeNull();
    });

    it("opens again if asked mid-fade, and can be closed again", async () => {
      fading(180);
      const user = userEvent.setup();
      render(<Presence />);
      const opener = screen.getByRole("button", { name: "Open it" });
      await user.click(opener);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await user.click(opener);
      const dialog = screen.getByRole("dialog", { name: "Bodyweight" });
      expect(dialog).toHaveAttribute("open");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
