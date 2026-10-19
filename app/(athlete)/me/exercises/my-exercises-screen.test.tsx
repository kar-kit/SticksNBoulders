import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyExercisesScreen } from "./my-exercises-screen";
import type { Exercise } from "@/lib/exercises/match";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

const library = vi.hoisted(() => ({
  exercises: [] as Exercise[],
  rename: vi.fn(),
  forget: vi.fn(),
  reload: vi.fn(async () => {}),
}));
vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: { status: "ready", exercises: library.exercises },
    remember: vi.fn(),
    rename: library.rename,
    forget: library.forget,
    reload: library.reload,
  }),
}));

const store = vi.hoisted(() => ({
  renameMyExercise: vi.fn(async () => {}),
  deleteMyExercise: vi.fn(async () => ({ queued: true })),
  checkExerciseDeletable: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true })),
}));
vi.mock("@/lib/exercises/my-exercises-store", () => store);

const ex = (id: string, name: string, over: Partial<Exercise> = {}): Exercise => ({
  id,
  name,
  normalisedName: name.toLowerCase(),
  isGlobal: false,
  ownerId: "joey",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  library.exercises = [
    ex("squat", "Squat", { isGlobal: true, ownerId: null }),
    ex("ex-1", "Romainian DL"),
    ex("ex-2", "Pin Press"),
  ];
});

describe("My exercises", () => {
  it("lists the athlete's own exercises and not the shared library", () => {
    render(<MyExercisesScreen />);
    const list = screen.getByRole("list", { name: "My exercises" });
    expect(list).toHaveTextContent("Pin Press");
    expect(list).toHaveTextContent("Romainian DL");
    expect(list).not.toHaveTextContent("Squat");
  });

  it("has a real empty state", () => {
    library.exercises = [ex("squat", "Squat", { isGlobal: true, ownerId: null })];
    render(<MyExercisesScreen />);
    expect(screen.getByText("No exercises of your own yet")).toBeInTheDocument();
  });

  it("renames one, everywhere at once", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Romainian DL" }));
    const field = screen.getByRole("textbox", { name: "Exercise name" });
    await user.clear(field);
    await user.type(field, "Romanian DL");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(library.rename).toHaveBeenCalledWith("ex-1", "Romanian DL");
    await waitFor(() => expect(store.renameMyExercise).toHaveBeenCalledWith("ex-1", "Romanian DL"));
  });

  it("refuses a name the library already has", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
    const field = screen.getByRole("textbox", { name: "Exercise name" });
    await user.clear(field);
    await user.type(field, "squat");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Squat is already in the library");
    expect(store.renameMyExercise).not.toHaveBeenCalled();
  });

  it("deletes an unused one", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(store.deleteMyExercise).toHaveBeenCalledWith("ex-2"));
    expect(store.checkExerciseDeletable).toHaveBeenCalledWith("joey", library.exercises[2], []);
    expect(library.forget).toHaveBeenCalledWith("ex-2");
  });

  it("keeps one that has been logged, and says why", async () => {
    store.checkExerciseDeletable.mockResolvedValueOnce({
      ok: false,
      message: "You've logged sets of Pin Press, so it stays. Rename it if the name is wrong.",
    });
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You've logged sets of Pin Press");
    expect(store.deleteMyExercise).not.toHaveBeenCalled();
    expect(library.forget).not.toHaveBeenCalled();
  });
});
