import { describe, expect, it } from "vitest";
import { placeStepLabels, stepSentence } from "./TrendCard";

// A plot 400 wide from x 60, 300 tall from y 16; six years; £-300 to £300
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const band = (width) => {
  const scale = (year) => {
    const i = YEARS.indexOf(year);
    return i < 0 ? undefined : 60 + (i * width) / YEARS.length;
  };
  scale.bandwidth = () => width / YEARS.length;
  return scale;
};
const axes = (width = 400) => ({
  xAxis: { x: 60, width, scale: band(width) },
  yAxis: { y: 16, height: 300, scale: (value) => 16 + 150 - (value / 300) * 150 },
});

describe("step labels", () => {
  it("puts each box at the plot's top or bottom edge, inside the plot, off the drawn lines", () => {
    const { xAxis, yAxis } = axes();
    // A line rising to £250 in 2027 (near the top), then falling to -£200 in 2030
    const line = [0, 250, 250, 250, -200, -200];
    const notes = [
      { year: 2027, step: 250, text: "Zero VAT on electricity" },
      { year: 2030, step: -450, text: "Threshold freeze" },
    ];
    const labels = placeStepLabels({
      notes,
      xAxis,
      yAxis,
      valueAt: (year) => line[YEARS.indexOf(year)],
      paths: [line],
      years: YEARS,
    });
    expect(labels).toHaveLength(2);
    const top = yAxis.y + 2;
    const bottom = yAxis.y + yAxis.height - 2 - labels[0].height;
    for (const label of labels) {
      expect([top, bottom]).toContain(label.top);
      expect(label.left).toBeGreaterThanOrEqual(xAxis.x);
      expect(label.left + label.width).toBeLessThanOrEqual(xAxis.x + xAxis.width);
    }
    // The rise's line runs along the top from 2027: its label goes to the foot
    expect(labels[0].top).toBe(bottom);
  });

  it("sends a second label that would meet the first to the other edge", () => {
    const { xAxis, yAxis } = axes();
    const notes = [
      { year: 2028, step: 100, text: "A long measure name here" },
      { year: 2029, step: 100, text: "Another long measure name" },
    ];
    const labels = placeStepLabels({ notes, xAxis, yAxis, valueAt: () => 0, years: YEARS });
    expect(labels).toHaveLength(2);
    expect(labels[0].top).not.toBe(labels[1].top);
  });

  it("draws nothing when a label cannot fit across the plot", () => {
    const { xAxis, yAxis } = axes(120);
    const notes = [{ year: 2028, step: 100, text: "Zero VAT on electricity" }];
    expect(placeStepLabels({ notes, xAxis, yAxis, valueAt: () => 0, years: YEARS })).toBeNull();
  });

  it("names on a phone the steps the headline does not", () => {
    const notes = [
      { year: 2027, measureId: "vat" },
      { year: 2030, measureId: "freeze" },
    ];
    const names = { vat: "zero VAT on electricity", freeze: "threshold freeze" };
    const nameIn = (id) => names[id];
    expect(stepSentence(notes, "People gain £50; in 2030-31 the threshold freeze moves it to −£20.", nameIn)).toBe(
      "The biggest step comes in 2027-28 from the zero VAT on electricity.",
    );
    expect(stepSentence(notes, null, nameIn)).toBe(
      "The biggest steps come in 2027-28 from the zero VAT on electricity and in 2030-31 from the threshold freeze.",
    );
    expect(stepSentence(notes.slice(1), "…; in 2030-31 the threshold freeze moves it to −£20.", nameIn)).toBeNull();
  });
});
