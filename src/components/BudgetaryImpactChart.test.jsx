import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BudgetaryImpactChart, { measureOrder } from "./BudgetaryImpactChart";
import { POLICY_COLORS } from "../utils/policyConfig";

// Recharts ResponsiveContainer measures the parent in jsdom and refuses
// to render its children when width / height resolve to zero. Replace it
// with a fixed-size wrapper so the BarChart renders deterministic ticks.
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div data-testid="recharts-responsive-container" style={{ width: 800, height: 500 }}>
        {children}
      </div>
    ),
  };
});

const mockData = [
  {
    year: 2026,
    "Threshold freeze to 2031-32": 0,
    "Business Asset Disposal Relief restricted": 0.4,
    "Fuel duty rises deferred": -1.2,
    "Employer NI relief for under-25s": -6.2,
    "Warm Home Discount top-up": -0.5,
    netImpact: -7.5,
  },
  {
    year: 2027,
    "Threshold freeze to 2031-32": 4.2,
    "Business Asset Disposal Relief restricted": 0.4,
    "Fuel duty rises deferred": -0.5,
    "Employer NI relief for under-25s": -6.3,
    "Warm Home Discount top-up": 0,
    netImpact: -2.2,
  },
];

describe("BudgetaryImpactChart", () => {
  it("renders a recharts ResponsiveContainer", () => {
    render(<BudgetaryImpactChart data={mockData} />);
    expect(
      screen.getByTestId("recharts-responsive-container"),
    ).toBeInTheDocument();
  });

  it("orders each group by size, largest first, raisers before costs", () => {
    const order = measureOrder(mockData).filter((name) => name in mockData[0]);
    expect(order).toEqual([
      "Threshold freeze to 2031-32",
      "Business Asset Disposal Relief restricted",
      "Employer NI relief for under-25s",
      "Fuel duty rises deferred",
      "Warm Home Discount top-up",
    ]);
  });

  it("shades each group darkest for its largest measure", () => {
    const luminance = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const costs = ["Employer NI relief for under-25s", "Fuel duty rises deferred", "Warm Home Discount top-up"];
    const levels = costs.map((name) => luminance(POLICY_COLORS[name]));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});
