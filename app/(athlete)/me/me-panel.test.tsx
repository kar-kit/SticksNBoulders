import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "./me-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const offline = vi.hoisted(() => ({ hasUnsynced: vi.fn(() => false) }));
vi.mock("@/lib/offline/client", () => offline);

describe("signing out with training still on the phone", () => {
  it("signs straight out when everything has synced", async () => {
    const onSignOut = vi.fn(async () => {});
    render(<SignOutButton onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("says so first, and stays signed in if asked", async () => {
    offline.hasUnsynced.mockReturnValue(true);
    const onSignOut = vi.fn(async () => {});
    render(<SignOutButton onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/hasn.t synced yet/);
    await userEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("signs out anyway when the athlete confirms", async () => {
    offline.hasUnsynced.mockReturnValue(true);
    const onSignOut = vi.fn(async () => {});
    render(<SignOutButton onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
