import { render } from "@testing-library/react";
import PageSpinner from "../PageSpinner";

describe("PageSpinner", () => {
  it("renders a single spinning element", () => {
    const { container } = render(<PageSpinner />);
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  });
});
