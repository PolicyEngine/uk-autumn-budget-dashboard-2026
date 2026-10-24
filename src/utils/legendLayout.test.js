import { describe, it, expect, vi } from "vitest";
import { legendGrid, LEGEND_COLUMN_GAP } from "./legendLayout";

// The dashboard's nine measures: six raise revenue, three cost it
const counts = [6, 3];

describe("legendGrid", () => {
  it("evens out a half-width card: two columns, not one long and one short", () => {
    const grid = legendGrid({ available: 490, itemWidth: 265, counts });
    expect(grid.columns).toBe(2);
    // Within the card, centred block no wider than the space
    expect(grid.width).toBeLessThanOrEqual(490);
  });

  it("uses three columns at full width (3 + 3 rows, then 3), not a ragged four", () => {
    const grid = legendGrid({ available: 1100, itemWidth: 265, counts });
    expect(grid.columns).toBe(3);
    expect(grid.columnWidth).toBe(265);
    expect(grid.width).toBe(3 * 265 + 2 * LEGEND_COLUMN_GAP);
  });

  it("falls to one column on a phone, never wider than the space", () => {
    const grid = legendGrid({ available: 320, itemWidth: 265, counts });
    expect(grid.columns).toBe(1);
    expect(legendGrid({ available: 200, itemWidth: 265, counts }).width).toBe(200);
  });

  it("never makes more columns than the largest group has items", () => {
    expect(legendGrid({ available: 2000, itemWidth: 100, counts: [2] }).columns).toBe(2);
  });
});

vi.mock("./textMeasure", () => ({
  // 6px a character, as a stand-in for canvas text measuring
  measureTextWidth: (text) => String(text).length * 6,
  wrapText: (text, maxWidth) => {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (next.length * 6 > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    return line ? [...lines, line] : lines;
  },
  estimateTextHeight: () => 0,
}));

describe("createGroupedLegend (export)", () => {
  const item = (label, group) => ({ label, color: "#000", type: "rect", group });
  const items = [
    ...["Threshold freeze extension", "Dividend tax increase (+2pp)", "Savings income tax increase (+2pp)",
      "Property income tax increase (+2pp)", "Salary sacrifice cap", "Freeze student loan repayment thresholds"]
      .map((label) => item(label, "raise")),
    ...["2 child limit repeal", "Fuel duty freeze extension", "Rail fares freeze"].map((label) => item(label, "cost")),
    { label: "Net change", color: "#000", type: "line" },
  ];

  it("matches the screen: headings span, items in the shared columns", async () => {
    const { createGroupedLegend } = await import("./exportChartAsSvg");
    const { element } = createGroupedLegend(items, 1100);
    const texts = [...element.querySelectorAll("text")];
    const x = (label) =>
      Number(texts.find((t) => t.textContent === label).getAttribute("x"));
    // Three columns: the 1st, 4th (raise) and 1st cost item share a left edge
    expect(x("Threshold freeze extension")).toBe(x("Property income tax increase (+2pp)"));
    expect(x("Threshold freeze extension")).toBe(x("2 child limit repeal"));
    expect(x("Dividend tax increase (+2pp)")).toBe(x("Fuel duty freeze extension"));
    // Headings at the block's left
    expect(x("Raise revenue")).toBeLessThan(x("Threshold freeze extension"));
  });
});
