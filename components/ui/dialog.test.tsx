import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./dialog";

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
});
