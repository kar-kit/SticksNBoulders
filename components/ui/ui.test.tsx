import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { Chip } from "./chip";
import { EmptyState } from "./empty-state";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Tabs } from "./tabs";
import { PendingDot, UploadBar } from "./sync-mark";

describe("Button", () => {
  it("fires on click", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start session</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Start session
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it cannot submit a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("still allows an explicit submit", () => {
    render(<Button type="submit">Sign in</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("styles each variant differently, defaulting to primary", () => {
    // A destructive action that renders as the primary call to action is the
    // failure this guards: the variant prop must reach the classes.
    const classOf = (variant?: "primary" | "secondary" | "ghost" | "danger") => {
      const { unmount } = render(<Button variant={variant}>Label</Button>);
      const className = screen.getByRole("button", { name: "Label" }).className;
      unmount();
      return className;
    };
    const variants = (["primary", "secondary", "ghost", "danger"] as const).map(classOf);
    expect(new Set(variants).size).toBe(4);
    expect(classOf()).toBe(variants[0]);
    expect(variants[0]).toContain("bg-accent-fill");
    expect(variants[3]).toContain("border-danger-line");
    expect(variants[3]).not.toContain("bg-accent-fill");
  });
});

describe("Chip", () => {
  it("is a button when it does something", () => {
    render(<Chip onClick={vi.fn()}>8</Chip>);
    expect(screen.getByRole("button", { name: "8" })).toBeInTheDocument();
  });

  it("is not a button when it is only a label", () => {
    // "On target" and "1 PR" are statements, not controls.
    render(<Chip tone="success">On target</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("On target")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("exposes the selected tab to assistive tech", () => {
    render(
      <Tabs
        label="Lifts"
        tabs={[
          { value: "squat", label: "Squat" },
          { value: "bench", label: "Bench" },
        ]}
        value="squat"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "Squat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Bench" })).toHaveAttribute("aria-selected", "false");
  });

  it("reports the value that was chosen", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Lifts"
        tabs={[
          { value: "squat", label: "Squat" },
          { value: "deadlift", label: "Deadlift" },
        ]}
        value="squat"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Deadlift" }));
    expect(onChange).toHaveBeenCalledWith("deadlift");
  });
});

describe("EmptyState", () => {
  it("states the fact and offers at most one action", () => {
    render(
      <EmptyState
        title="No athletes yet"
        body="Share your invite code and they will appear here."
        action={<Button size="sm">Copy invite code</Button>}
      />,
    );
    expect(screen.getByText("No athletes yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders without an action, because some empty states have none", () => {
    render(<EmptyState title="Nothing to review" />);
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Table", () => {
  it("keeps table semantics despite being built from grid rows", () => {
    render(
      <Table columns="1.4fr 1fr">
        <TableHead>
          <TableHeader sorted="asc">Name</TableHeader>
          <TableHeader>This week</TableHeader>
        </TableHead>
        <TableRow>
          <TableCell strong>Joey Pang</TableCell>
          <TableCell>3 of 4</TableCell>
        </TableRow>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("cell", { name: "Joey Pang" })).toBeInTheDocument();
  });
});

describe("sync marks", () => {
  it("labels the pending dot as queued, never as an error", () => {
    render(<PendingDot />);
    expect(screen.getByRole("status", { name: "Queued, will sync" })).toBeInTheDocument();
  });

  it.each([
    [-20, "0"],
    [0, "0"],
    [62, "62"],
    [140, "100"],
  ])("clamps an upload percentage of %p to %s", (input, expected) => {
    render(<UploadBar percent={input} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", expected);
  });
});
