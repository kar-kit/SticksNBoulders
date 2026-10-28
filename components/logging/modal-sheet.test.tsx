import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ModalSheet } from "./modal-sheet";

/**
 * jsdom has no showModal, close or inert. The modal behaviour itself (inert
 * page, trapped focus, top layer) is the browser's; what is tested here is
 * that it is asked for, and what this component adds on top.
 */
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
const close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
});
afterEach(() => {
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

function Harness({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Shut
      </button>
      <ModalSheet label="Edit Set 2" onDismiss={onDismiss}>
        {open ? (
          <section aria-label="Sheet body">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </section>
        ) : null}
      </ModalSheet>
    </>
  );
}

describe("ModalSheet", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("[data-scrim]")).toBeNull();
  });

  it("opens as a modal, named, with a fading scrim behind a sheet that rises", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Set 2" });
    expect(showModal).toHaveBeenCalledTimes(1);
    const scrim = dialog.querySelector("[data-scrim]")!;
    expect(scrim).toHaveAttribute("aria-hidden", "true");
    expect(scrim.className).toContain("animate-fade-in");
    const panel = screen.getByRole("region", { name: "Sheet body" }).parentElement!;
    expect(panel.className).toContain("motion-safe:animate-sheet-in");
    expect(panel.className).toContain("pb-safe");
  });

  it("asks to close on a scrim tap, but not on a tap inside the sheet", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("region", { name: "Sheet body" }));
    expect(onDismiss).not.toHaveBeenCalled();
    await user.click(document.querySelector<HTMLElement>("[data-scrim]")!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // A request: it stays open until the caller closes it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks to close on Escape and on the dialog's cancel, and keeps itself open", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  /**
   * F21. The edit sheet holds the set's camera, an `<input type="file">`, and
   * the input's `cancel` bubbles. Read as the sheet's own cancel, backing out
   * of the picker closed the sheet and unmounted the camera, so a pick that
   * came after it had no input left to land on.
   */
  it("does not ask to close on a file picker's cancel bubbling up from inside the sheet", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    function WithInput() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ModalSheet label="Edit Set 2" onDismiss={onDismiss}>
            {open ? (
              <section aria-label="Sheet body">
                <input type="file" aria-label="Clip file" />
              </section>
            ) : null}
          </ModalSheet>
        </>
      );
    }
    render(<WithInput />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const fromPicker = new Event("cancel", { bubbles: true });
    act(() => {
      screen.getByLabelText("Clip file").dispatchEvent(fromPicker);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit Set 2" })).toBeInTheDocument();
  });

  it("closes the modal and hands focus back to its opener when closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(opener).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalled();
    // jsdom: no animation, so it unmounts at once.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
