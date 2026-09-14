import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseLibraryProvider, useExerciseLibrary } from "./library-context";
import type { Exercise } from "./match";

const squat: Exercise = {
  id: "squat",
  name: "Squat",
  normalisedName: "squat",
  isGlobal: true,
};

function Probe() {
  const { state, remember } = useExerciseLibrary();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="names">{state.exercises.map((e) => e.name).join(",")}</span>
      <button
        type="button"
        onClick={() =>
          remember({ id: "zercher", name: "Zercher Squat", normalisedName: "zercher squat", isGlobal: false })
        }
      >
        remember
      </button>
    </div>
  );
}

const renderWith = (load: (userId: string) => Promise<Exercise[]>, userId: string | null = "joey") =>
  render(
    <ExerciseLibraryProvider userId={userId} load={load}>
      <Probe />
    </ExerciseLibraryProvider>,
  );

describe("the library, fetched once per app load", () => {
  it("loads it and holds it", async () => {
    renderWith(async () => [squat]);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("names")).toHaveTextContent("Squat");
  });

  it("does not fetch for a signed-out visitor", async () => {
    const load = vi.fn();
    renderWith(load, null);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(load).not.toHaveBeenCalled();
  });

  it("survives a failed load without blocking logging", async () => {
    // The athlete can still type a name. It simply is not matched against the
    // library, which is a worse experience, not a broken one.
    renderWith(async () => {
      throw new Error("no signal");
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("failed"));
  });

  it("takes a just-created exercise locally, so the list never lags the typing", async () => {
    renderWith(async () => [squat]);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    await userEvent.setup().click(screen.getByRole("button", { name: "remember" }));
    expect(screen.getByTestId("names")).toHaveTextContent("Squat,Zercher Squat");
  });

  it("refuses to be used outside its provider rather than returning an empty library", () => {
    // An empty library that silently works is how an athlete ends up creating a
    // duplicate of a lift that was in the library all along.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ExerciseLibraryProvider/);
    vi.restoreAllMocks();
  });
});
