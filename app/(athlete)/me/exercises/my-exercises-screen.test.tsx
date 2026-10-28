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
  flagBodyweight: vi.fn(),
  setKind: vi.fn(),
  remember: vi.fn(),
  forget: vi.fn(),
  reload: vi.fn(async () => {}),
}));
vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: { status: "ready", exercises: library.exercises },
    remember: library.remember,
    rename: library.rename,
    flagBodyweight: library.flagBodyweight,
    setKind: library.setKind,
    forget: library.forget,
    reload: library.reload,
  }),
}));

const store = vi.hoisted(() => ({
  renameMyExercise: vi.fn(async () => {}),
  setMyExerciseBodyweight: vi.fn(async () => {}),
  setMyExerciseKind: vi.fn(async () => {}),
  deleteMyExercise: vi.fn(async () => ({ queued: true })),
  checkExerciseDeletable: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true })),
}));
vi.mock("@/lib/exercises/my-exercises-store", () => store);

const created = vi.hoisted(() => ({
  resolveOrCreateExercise: vi.fn(
    async (name: string, _library: unknown, actor: { userId: string }, kind?: "strength" | "cardio") => ({
      exercise: { id: "ex-new", name, normalisedName: name.toLowerCase(), isGlobal: false, ownerId: actor.userId, kind },
      created: true,
    }),
  ),
}));
vi.mock("@/lib/exercises/library", () => created);

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

  describe("the bodyweight flag (F20)", () => {
    it("flags one, locally first and then queued, without touching its name", async () => {
      const user = userEvent.setup();
      render(<MyExercisesScreen />);
      await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
      const box = screen.getByRole("checkbox", { name: /Bodyweight exercise/ });
      expect(box).not.toBeChecked();
      expect(box).toHaveAccessibleDescription("Lets you log it at 0 kg. Added weight still logs as usual.");
      await user.click(box);
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(library.flagBodyweight).toHaveBeenCalledWith("ex-2", true);
      await waitFor(() => expect(store.setMyExerciseBodyweight).toHaveBeenCalledWith("ex-2", true));
      expect(library.rename).not.toHaveBeenCalled();
      expect(store.renameMyExercise).not.toHaveBeenCalled();
    });

    it("opens a flagged one ticked, says so in the list, and can clear it", async () => {
      library.exercises = [ex("ex-3", "Ring Dip", { isBodyweight: true })];
      const user = userEvent.setup();
      render(<MyExercisesScreen />);
      const row = screen.getByRole("button", { name: "Edit Ring Dip, bodyweight" });
      expect(row).toHaveTextContent("BODYWEIGHT");
      await user.click(row);
      const box = screen.getByRole("checkbox", { name: /Bodyweight exercise/ });
      expect(box).toBeChecked();
      await user.click(box);
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(store.setMyExerciseBodyweight).toHaveBeenCalledWith("ex-3", false));
    });

    it("writes nothing when neither the name nor the flag changed", async () => {
      const user = userEvent.setup();
      render(<MyExercisesScreen />);
      await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(store.setMyExerciseBodyweight).not.toHaveBeenCalled();
      expect(store.renameMyExercise).not.toHaveBeenCalled();
      expect(library.flagBodyweight).not.toHaveBeenCalled();
    });

    it("renames and flags in one Save", async () => {
      const user = userEvent.setup();
      render(<MyExercisesScreen />);
      await user.click(screen.getByRole("button", { name: "Edit Romainian DL" }));
      const field = screen.getByRole("textbox", { name: "Exercise name" });
      await user.clear(field);
      await user.type(field, "Nordic Curl");
      await user.click(screen.getByRole("checkbox", { name: /Bodyweight exercise/ }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(store.setMyExerciseBodyweight).toHaveBeenCalledWith("ex-1", true));
      expect(store.renameMyExercise).toHaveBeenCalledWith("ex-1", "Nordic Curl");
    });

    it("puts the flag back and says so when the phone cannot store it", async () => {
      store.setMyExerciseBodyweight.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
      const user = userEvent.setup();
      render(<MyExercisesScreen />);
      await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
      await user.click(screen.getByRole("checkbox", { name: /Bodyweight exercise/ }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("That change wasn't saved");
      expect(library.flagBodyweight).toHaveBeenLastCalledWith("ex-2", false);
      // The form stays open on what was typed, so a retry is one tap.
      expect(screen.getByRole("checkbox", { name: /Bodyweight exercise/ })).toBeChecked();
    });
  });
});

describe("My exercises: cardio (F23)", () => {
  it("makes one cardio, locally first and then queued, and hides the bodyweight box while it is", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
    const box = screen.getByRole("checkbox", { name: /Cardio exercise/ });
    expect(box).toHaveAccessibleDescription(
      "Logs a time and a level instead of weight and reps. Sets already logged stay as they are.",
    );
    await user.click(box);
    expect(screen.queryByRole("checkbox", { name: /Bodyweight exercise/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(library.setKind).toHaveBeenCalledWith("ex-2", "cardio");
    await waitFor(() => expect(store.setMyExerciseKind).toHaveBeenCalledWith("ex-2", "cardio"));
    expect(store.setMyExerciseBodyweight).not.toHaveBeenCalled();
    expect(store.renameMyExercise).not.toHaveBeenCalled();
  });

  it("opens a cardio one ticked, says so in the list, and can make it strength again", async () => {
    library.exercises = [ex("ex-3", "Ski Erg", { kind: "cardio" })];
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    const row = screen.getByRole("button", { name: "Edit Ski Erg, cardio" });
    expect(row).toHaveTextContent("CARDIO");
    await user.click(row);
    await user.click(screen.getByRole("checkbox", { name: /Cardio exercise/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(store.setMyExerciseKind).toHaveBeenCalledWith("ex-3", "strength"));
  });

  it("puts the kind back if the phone cannot store the change", async () => {
    store.setMyExerciseKind.mockRejectedValueOnce(new Error("quota"));
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.click(screen.getByRole("button", { name: "Edit Pin Press" }));
    await user.click(screen.getByRole("checkbox", { name: /Cardio exercise/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(library.setKind).toHaveBeenLastCalledWith("ex-2", "strength"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That change wasn't saved");
  });

  it("adds a new cardio exercise from scratch, as cardio", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.type(screen.getByRole("textbox", { name: "New cardio exercise" }), "Ski Erg");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(created.resolveOrCreateExercise).toHaveBeenCalledWith("Ski Erg", library.exercises, { userId: "joey" }, "cardio"),
    );
    expect(library.remember).toHaveBeenCalledWith(expect.objectContaining({ id: "ex-new", kind: "cardio" }));
    expect(screen.getByRole("textbox", { name: "New cardio exercise" })).toHaveValue("");
  });

  it("refuses a name the library already has, and says where it is", async () => {
    const user = userEvent.setup();
    render(<MyExercisesScreen />);
    await user.type(screen.getByRole("textbox", { name: "New cardio exercise" }), "squat");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Squat is already in the library");
    expect(created.resolveOrCreateExercise).not.toHaveBeenCalled();
  });
});
