import { beforeEach, expect, it } from "vitest";
import { forgetUser, recallUser, rememberUser } from "./remembered-user";
import { NOT_A_COACH } from "./role";

const USER = { id: "joey", name: "Joey Pang", email: "joey@example.com" };

beforeEach(() => localStorage.clear());

it("gives the athlete back after a cold start with no signal", () => {
  rememberUser(USER, NOT_A_COACH);
  expect(recallUser()).toEqual({ user: USER, coach: NOT_A_COACH });
});

it("remembers that a coach is a coach, so the mode switch does not vanish", () => {
  const coach = { isCoach: true, athleteIds: ["a1"] };
  rememberUser(USER, coach as never);
  expect(recallUser()?.coach).toEqual(coach);
});

it("forgets on sign-out", () => {
  rememberUser(USER, NOT_A_COACH);
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
