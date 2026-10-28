import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { netDotTitled } from "./chartMotion";

describe("netDotTitled", () => {
  it("names the dot (Recharts gives each point role=img) with its value", () => {
    const Dot = netDotTitled((row) => `${row.label}: net change ${row.netChange}`);
    const { container } = render(
      <svg>
        <g role="img">
          <Dot cx={10} cy={20} payload={{ label: "16 to 24", netChange: "+£12" }} />
        </g>
      </svg>,
    );
    const group = container.querySelector("g[role=img]");
    expect(group.children[0].tagName.toLowerCase()).toBe("title");
    expect(group.children[0]).toHaveTextContent("16 to 24: net change +£12");
    expect(group.querySelector("circle")).toHaveAttribute("r", "3.5");
  });

  it.each([undefined, null, NaN])("draws nothing for a point with no place (%s)", (coordinate) => {
    const Dot = netDotTitled(() => "unused");
    const { container } = render(<svg><Dot cx={5} cy={coordinate} payload={{ netChange: null }} /></svg>);
    expect(container.querySelector("title")).toBeNull();
    expect(container.querySelector("circle")).toBeNull();
  });
});
