import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinishPanel } from "./finish-panel";

describe("FinishPanel", () => {
  it("shows the real finish screen with no records, one, and several, and replays by remounting", async () => {
    const user = userEvent.setup();
    render(<FinishPanel />);
    const records = () => screen.queryByRole("region", { name: "Personal records" });

    expect(within(records()!).getByRole("heading", { level: 2 })).toHaveTextContent("4 new PRs");

    await user.click(screen.getByRole("button", { name: "1 PR" }));
    expect(within(records()!).getByRole("heading", { level: 2 })).toHaveTextContent("New PR");
    expect(within(records()!).getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "No PRs" }));
    expect(records()).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Session done" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "4 PRs" }));
    const first = within(records()!).getAllByRole("listitem")[0];
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(within(records()!).getAllByRole("listitem")[0]).not.toBe(first);
  });
});
