import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { attachClipToSet } from "@/lib/video/upload";
import { AttachVideo } from "./attach-video";

vi.mock("@/lib/video/upload", () => ({
  attachClipToSet: vi.fn(async () => ({ ok: true })),
}));

const render_ = (ask: "none" | "emphasise" | "prompt", extra: Record<string, unknown> = {}) =>
  render(<AttachVideo setId="s1" athleteId="a1" ask={ask} {...extra} />);

describe("the camera when the coach asked for a clip (Order 30)", () => {
  it("is the plain camera when nothing was asked", () => {
    render_("none");
    expect(screen.getByRole("button", { name: "Add video" })).not.toHaveAttribute("data-video-ask");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stands out while the flagged sets are still to do, with no message", () => {
    render_("emphasise");
    expect(screen.getByRole("button", { name: "Add video" })).toHaveAttribute("data-video-ask", "emphasise");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stands out the same once every flagged set is logged, and says nothing inline", () => {
    render_("prompt");
    expect(screen.getByRole("button", { name: "Add video" })).toHaveAttribute("data-video-ask", "prompt");
    expect(screen.getByRole("button", { name: "Add video" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports an attached clip so the screen stops asking", async () => {
    const onAttached = vi.fn();
    const { container } = render_("prompt", { onAttached });
    const file = new File(["x"], "squat.mp4", { type: "video/mp4" });
    await userEvent.setup().upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
  });
});

describe("the coach's ask as a popup (F18)", () => {
  afterEach(() => vi.restoreAllMocks());

  const nudged = (extra: Record<string, unknown> = {}) => {
    const onNudgeShown = vi.fn();
    const onNudgeClose = vi.fn();
    const utils = render(
      <AttachVideo setId="s1" athleteId="a1" ask="emphasise" nudge onNudgeShown={onNudgeShown} onNudgeClose={onNudgeClose} {...extra} />,
    );
    return { ...utils, onNudgeShown, onNudgeClose };
  };

  it("asks in a dialog named by its heading, Attach now first, and says it was shown once", () => {
    const { onNudgeShown } = nudged();
    const dialog = screen.getByRole("dialog", { name: "Your coach asked for a clip of this set" });
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Attach now", "Later"]);
    expect(onNudgeShown).toHaveBeenCalledTimes(1);
  });

  it("is not there without the nudge", () => {
    render_("prompt");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the picker straight from the Attach now tap, with the dialog already closed", async () => {
    const opened: boolean[] = [];
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      opened.push(this.closest("dialog") === null && document.querySelector("dialog")?.hasAttribute("open") !== true);
    });
    const { onNudgeClose, container } = nudged();
    await userEvent.setup().click(screen.getByRole("button", { name: "Attach now" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(container.querySelector("input[type=file]"));
    // The input lives outside the modal, and the modal was closed before the click.
    expect(opened).toEqual([true]);
    expect(onNudgeClose).toHaveBeenCalledTimes(1);
  });

  it("uploads what Attach now picked onto the same set", async () => {
    vi.mocked(attachClipToSet).mockClear();
    const { container, rerender } = nudged();
    await userEvent.setup().click(screen.getByRole("button", { name: "Attach now" }));
    rerender(<AttachVideo setId="s1" athleteId="a1" ask="emphasise" />);
    const file = new File(["x"], "squat.mp4", { type: "video/mp4" });
    await userEvent.setup().upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    await vi.waitFor(() => expect(attachClipToSet).toHaveBeenCalledWith("s1", "a1", file, expect.anything()));
  });

  it("closes on Later and hands the focus to the camera", async () => {
    const { onNudgeClose, rerender } = nudged();
    await userEvent.setup().click(screen.getByRole("button", { name: "Later" }));
    expect(onNudgeClose).toHaveBeenCalledTimes(1);
    rerender(<AttachVideo setId="s1" athleteId="a1" ask="emphasise" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add video" })).toHaveFocus();
  });

  it("closes on Escape like Later", async () => {
    const { onNudgeClose } = nudged();
    // jsdom has no showModal, so nothing moves the focus in for it.
    screen.getByRole("button", { name: "Attach now" }).focus();
    await userEvent.setup().keyboard("{Escape}");
    expect(onNudgeClose).toHaveBeenCalledTimes(1);
  });
});

describe("a clip that did not finish but was kept", () => {
  const pick = async (container: HTMLElement) =>
    userEvent
      .setup()
      .upload(
        container.querySelector("input[type=file]") as HTMLInputElement,
        new File(["x"], "squat.mp4", { type: "video/mp4" }),
      );

  /**
   * Kept on the phone after the session ran out. It is on its way, so it is
   * shown as pending -- not as a failure the athlete has to act on, and the
   * coach's nudge stops, because a clip is coming.
   */
  it("is shown as pending, with what will send it, and counts as on its way", async () => {
    vi.mocked(attachClipToSet).mockResolvedValueOnce({
      ok: false,
      reason: "pending",
      message: "It will upload once you sign in again.",
    });
    const onAttached = vi.fn();
    const { container } = render_("prompt", { onAttached });

    await pick(container);

    const status = await screen.findByText("It will upload once you sign in again.");
    expect(status.closest("[data-upload]")).toHaveAttribute("data-upload", "pending");
    expect(screen.getByRole("button", { name: "Video pending" })).toBeEnabled();
    expect(onAttached).toHaveBeenCalledTimes(1);
  });

  it("is still a failure when the clip was refused", async () => {
    vi.mocked(attachClipToSet).mockResolvedValueOnce({
      ok: false,
      reason: "failed",
      message: "File extension not allowed",
    });
    const onAttached = vi.fn();
    const { container } = render_("none", { onAttached });

    await pick(container);

    const status = await screen.findByText("File extension not allowed");
    expect(status.closest("[data-upload]")).toHaveAttribute("data-upload", "failed");
    expect(screen.getByRole("button", { name: "Add video" })).toBeEnabled();
    expect(onAttached).not.toHaveBeenCalled();
  });
});
