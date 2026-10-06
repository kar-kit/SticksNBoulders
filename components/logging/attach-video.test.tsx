import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("nudges once the sets are logged, as a status line rather than an alert", () => {
    render_("prompt");
    expect(screen.getByRole("status")).toHaveTextContent("Your coach asked for a clip of this one.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add video" })).toHaveAttribute("data-video-ask", "prompt");
    expect(screen.getByRole("button", { name: "Add video" })).toBeEnabled();
  });

  it("puts the nudge away on Not now and leaves the camera usable", async () => {
    render_("prompt");
    await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add video" })).toBeEnabled();
  });

  it("reports an attached clip so the screen stops asking", async () => {
    const onAttached = vi.fn();
    const { container } = render_("prompt", { onAttached });
    const file = new File(["x"], "squat.mp4", { type: "video/mp4" });
    await userEvent.setup().upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Your coach asked for a clip of this one.")).not.toBeInTheDocument();
  });
});
