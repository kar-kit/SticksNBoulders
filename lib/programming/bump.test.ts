import { bumpLoad, bumpPlan, isNoBump, lineAt, parseBump } from "./bump";
import type { Prescription, WeekTree } from "./program";

const bump = (over: Partial<{ kg: number; percent: number; rpe: number }>) => ({ kg: 0, percent: 0, rpe: 0, ...over });

describe("a bumped load", () => {
  it("steps each kind by its own part of the bump", () => {
    expect(bumpLoad("75%", bump({ percent: 2.5 }))).toBe("77.5%");
    expect(bumpLoad("142.5", bump({ kg: 5 }))).toBe("147.5kg");
    expect(bumpLoad("@8", bump({ rpe: 0.5 }))).toBe("@8.5");
    expect(bumpLoad("75% @8", bump({ percent: 2.5, rpe: 0.5 }))).toBe("77.5% @8.5");
  });

  it("keeps what the cell said the percentage is of", () => {
    expect(bumpLoad("80% of tested", bump({ percent: 2.5 }))).toBe("82.5% of tested");
  });

  it("leaves a kind the bump does not touch, freeform words and an empty cell alone", () => {
    expect(bumpLoad("75%", bump({ kg: 5, rpe: 1 }))).toBeNull();
    expect(bumpLoad("@8", bump({ percent: 2.5 }))).toBeNull();
    expect(bumpLoad("heavy single", bump({ percent: 2.5, kg: 5, rpe: 1 }))).toBeNull();
    expect(bumpLoad(null, bump({ percent: 2.5 }))).toBeNull();
  });

  it("keeps an RPE on the scale, and never steps a load to nothing", () => {
    expect(bumpLoad("@9.5", bump({ rpe: 1 }))).toBe("@10");
    expect(bumpLoad("@10", bump({ rpe: 1 }))).toBeNull();
    expect(bumpLoad("@6", bump({ rpe: -1 }))).toBeNull();
    expect(bumpLoad("5%", bump({ percent: -10 }))).toBeNull();
    expect(bumpLoad("0.1", bump({ kg: 0.2 }))).toBe("0.3kg");
  });
});

describe("the bump form", () => {
  it("reads signed steps, and an empty field as no step", () => {
    expect(parseBump({ kg: "", percent: "+2.5", rpe: "-0,5" })).toEqual({ ok: true, value: { kg: 0, percent: 2.5, rpe: -0.5 } });
    expect(isNoBump({ kg: 0, percent: 0, rpe: 0 })).toBe(true);
  });

  it("refuses what is not a step, and an RPE step off the half points", () => {
    expect(parseBump({ kg: "five", percent: "", rpe: "" })).toEqual({ ok: false, reason: "Kilos is a number, like 2.5 or -5" });
    expect(parseBump({ kg: "", percent: "", rpe: "0.3" })).toEqual({ ok: false, reason: "RPE moves in half points, like 0.5" });
  });
});

describe("the plan for the copy", () => {
  const line = (id: string, exerciseId: string, position: number, load: string | null) =>
    ({ id, exerciseId, position, load }) as Prescription;
  const week = (days: Prescription[][]) =>
    ({ days: days.map((prescriptions, position) => ({ id: `d${position}`, position, prescriptions })) }) as unknown as WeekTree;

  it("lists the lines that change by their place in the week, and finds them in the copy by place", () => {
    const source = week([[line("a", "squat", 0, "@8"), line("b", "squat", 1, "75%")], [line("c", "bench", 0, "heavy")]]);
    const plan = bumpPlan(source, bump({ percent: 2.5 }));
    expect(plan).toEqual([{ dayIndex: 0, lineIndex: 1, exerciseId: "squat", from: "75%", to: "77.5%" }]);
    const copy = week([[line("a2", "squat", 0, "@8"), line("b2", "squat", 1, "75%")], [line("c2", "bench", 0, "heavy")]]);
    expect(lineAt(copy, plan[0])?.id).toBe("b2");
    // A copy not shaped like its source is not guessed at.
    expect(lineAt(week([[line("a2", "squat", 0, "@8"), line("x", "bench", 1, "75%")]]), plan[0])).toBeNull();
  });
});
