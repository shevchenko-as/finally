import React from "react";
import { render, container } from "@testing-library/react";
import Sparkline from "@/components/Sparkline";

describe("Sparkline", () => {
  it("renders an SVG element", () => {
    const { container } = render(<Sparkline data={[100, 102, 101, 103]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders empty SVG with less than 2 data points", () => {
    const { container } = render(<Sparkline data={[100]} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector("polyline")).not.toBeInTheDocument();
  });

  it("renders polyline with 2+ data points", () => {
    const { container } = render(<Sparkline data={[100, 105, 103]} />);
    expect(container.querySelector("polyline")).toBeInTheDocument();
  });

  it("respects custom width and height", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} width={120} height={40} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("120");
    expect(svg?.getAttribute("height")).toBe("40");
  });
});
