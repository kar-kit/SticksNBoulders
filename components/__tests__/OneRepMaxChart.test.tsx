import { render, screen } from "@testing-library/react";
import OneRepMaxChart from "../OneRepMaxChart";

describe("OneRepMaxChart", () => {
  it("shows a placeholder message with zero points", () => {
    render(<OneRepMaxChart points={[]} />);
    expect(screen.getByText(/log a few more sessions/i)).toBeInTheDocument();
  });

  it("shows a placeholder message with only one point (can't draw a line)", () => {
    render(<OneRepMaxChart points={[{ date: "2026-01-01", estimatedKg: 100 }]} />);
    expect(screen.getByText(/log a few more sessions/i)).toBeInTheDocument();
  });

  it("renders an SVG polyline with one coordinate per point when there are 2+ points", () => {
    const points = [
      { date: "2026-01-01", estimatedKg: 100 },
      { date: "2026-01-08", estimatedKg: 110 },
      { date: "2026-01-15", estimatedKg: 105 },
    ];
    const { container } = render(<OneRepMaxChart points={points} />);

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const coords = polyline!.getAttribute("points")!.trim().split(" ");
    expect(coords).toHaveLength(3);

    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
  });

  it("does not throw when every point has the same estimated 1RM (zero range)", () => {
    const points = [
      { date: "2026-01-01", estimatedKg: 100 },
      { date: "2026-01-08", estimatedKg: 100 },
    ];
    expect(() => render(<OneRepMaxChart points={points} />)).not.toThrow();
  });
});
