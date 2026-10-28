import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { attachClipToSet, type UploadResult } from "@/lib/video/upload";
import { beginEdit } from "@/lib/logging/number-pad";
import { AttachVideo } from "./attach-video";
import { EditSetSheet } from "./edit-set-sheet";
import { ModalSheet } from "./modal-sheet";

vi.mock("@/lib/video/upload", () => ({
  attachClipToSet: vi.fn(async (): Promise<UploadResult> => ({ ok: true, fileId: "f-new" })),
}));

/**
 * F21: the edit sheet's camera, wired the way log-screen.tsx wires it -- an
 * `AttachVideo` inside `EditSetSheet` inside `ModalSheet`, and a dismiss that
 * closes an untouched draft at once (`dismissEdit`). jsdom has no picker and
 * no `showModal`; what is pinned is what the page does around them.
 */
function LogLikeSheet({
  onAttached,
  onUploadingChange,
}: {
  onAttached: (result: UploadResult) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ModalSheet label="Edit Set 2" onDismiss={() => setOpen(false)}>
      {open ? (
        <EditSetSheet
          setLabel="Set 2"
          exerciseName="Squat"
          draft={{ loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "" }}
          field="load"
          pad={beginEdit("load", 140, "kg")}
          unit="kg"
          canSave
          onField={() => {}}
          onPadChange={() => {}}
          onToggleWarmup={() => {}}
          onRpe={() => {}}
          onToggleFailed={() => {}}
          onNote={() => {}}
          onSave={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          video={
            <AttachVideo setId="st-2" athleteId="joey" onAttached={onAttached} onUploadingChange={onUploadingChange} />
          }
        />
      ) : null}
    </ModalSheet>
  );
}

const clip = () => new File(["x"], "squat.mov", { type: "video/quicktime" });
const fileInput = () => document.querySelector<HTMLInputElement>("[data-modal-sheet] input[type=file]")!;

beforeEach(() => {
  vi.mocked(attachClipToSet).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("the edit sheet's camera (F17, fixed in F21)", () => {
  it("keeps the sheet, and its file input, through the picker's cancel, so the pick still uploads", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const onAttached = vi.fn();
    render(<LogLikeSheet onAttached={onAttached} onUploadingChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add video" }));
    expect(click).toHaveBeenCalledTimes(1);
    const input = fileInput();
    expect(click.mock.contexts[0]).toBe(input);

    // What iOS can send while its picker is up: the input's own `cancel`,
    // bubbling. It used to reach the sheet's onCancel and dismiss it.
    act(() => {
      input.dispatchEvent(new Event("cancel", { bubbles: true }));
    });
    expect(screen.getByRole("dialog", { name: "Edit Set 2" })).toBeInTheDocument();
    expect(input.isConnected).toBe(true);

    click.mockRestore();
    const file = clip();
    await user.upload(input, file);
    await vi.waitFor(() => expect(attachClipToSet).toHaveBeenCalledWith("st-2", "joey", file, expect.anything()));
    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledWith({ ok: true, fileId: "f-new" }));
  });

  it("finishes an upload started in the sheet after the sheet has closed, and lets Delete go", async () => {
    let finish: (result: UploadResult) => void = () => {};
    vi.mocked(attachClipToSet).mockImplementationOnce(
      () => new Promise<UploadResult>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    const onAttached = vi.fn();
    const onUploadingChange = vi.fn();
    render(<LogLikeSheet onAttached={onAttached} onUploadingChange={onUploadingChange} />);

    await user.upload(fileInput(), clip());
    await vi.waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(true));

    // Closed mid-upload: the camera unmounts with the sheet.
    await user.click(screen.getByRole("button", { name: "Cancel, keep Set 2 as logged" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The upload was never the component's to abort: it lands, the screen
    // hears it (and queues the old file's retirement), and the hold on
    // Delete set is released.
    await act(async () => finish({ ok: true, fileId: "f-new" }));
    expect(onAttached).toHaveBeenCalledWith({ ok: true, fileId: "f-new" });
    expect(onUploadingChange).toHaveBeenLastCalledWith(false);
  });
});
