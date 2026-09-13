import { render, screen, act } from "@testing-library/react";
import ElapsedTimer, { formatElapsed } from "../ElapsedTimer";

describe("formatElapsed", () => {
  it("formats 0 seconds as 00:00", () => {
    expect(formatElapsed(0)).toBe("00:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(59)).toBe("00:59");
  });

  it("rolls over to minutes at 60 seconds", () => {
    expect(formatElapsed(60)).toBe("01:00");
  });

  it("formats minutes and seconds under an hour", () => {
    expect(formatElapsed(125)).toBe("02:05");
    expect(formatElapsed(3599)).toBe("59:59");
  });

  it("switches to h:mm:ss format at exactly one hour", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
  });

  it("formats multi-hour durations with zero-padded minutes/seconds", () => {
    expect(formatElapsed(3661)).toBe("1:01:01");
    expect(formatElapsed(7325)).toBe("2:02:05");
  });
});

describe("ElapsedTimer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders 00:00 immediately when startedAt is now", () => {
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<ElapsedTimer startedAt="2026-01-01T00:00:00.000Z" />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("ticks up once per second", () => {
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<ElapsedTimer startedAt="2026-01-01T00:00:00.000Z" />);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText("00:03")).toBeInTheDocument();
  });

  it("never shows negative elapsed time if startedAt is slightly in the future (clock skew)", () => {
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<ElapsedTimer startedAt="2026-01-01T00:00:05.000Z" />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });
});
