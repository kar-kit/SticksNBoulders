import { beforeEach, expect, it } from "vitest";
import { forgetUser, recallUser, rememberUser } from "./remembered-user";
import { NO_MODE } from "./mode";
import { NOT_A_COACH } from "./role";

const USER = { id: "joey", name: "Joey Pang", email: "joey@example.com" };

beforeEach(() => localStorage.clear());

it("gives the athlete back after a cold start with no signal", () => {
  rememberUser(USER, NOT_A_COACH, NO_MODE);
  expect(recallUser()).toEqual({ user: USER, coach: NOT_A_COACH, prefs: NO_MODE });
});

it("keeps the side they last used, so an offline cold start opens there", () => {
  rememberUser(USER, NOT_A_COACH, { mode: "coach", choseCoach: true });
  expect(recallUser()?.prefs).toEqual({ mode: "coach", choseCoach: true });
});

it("reads a record from before modes existed as never having chosen", () => {
  // Every phone that already has the app installed holds one of these.
  localStorage.setItem("snb.last-user", JSON.stringify({ user: USER, coach: NOT_A_COACH }));
  expect(recallUser()?.prefs).toEqual(NO_MODE);
});

it("does not trust a tampered mode in the cached record", () => {
  localStorage.setItem(
    "snb.last-user",
    JSON.stringify({ user: USER, coach: NOT_A_COACH, prefs: { mode: "admin", choseCoach: "yes" } }),
  );
  expect(recallUser()?.prefs).toEqual(NO_MODE);
});

it("remembers that a coach is a coach, so the mode switch does not vanish", () => {
  const coach = { isCoach: true, athleteIds: ["a1"] };
  rememberUser(USER, coach as never, NO_MODE);
  expect(recallUser()?.coach).toEqual(coach);
});

it("forgets on sign-out", () => {
  rememberUser(USER, NOT_A_COACH, NO_MODE);
  forgetUser();
  expect(recallUser()).toBeNull();
});

it("returns nothing rather than throwing when storage is unavailable", () => {
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = () => {
    throw new Error("blocked");
  };
  expect(recallUser()).toBeNull();
  Storage.prototype.getItem = original;
});
