import { describe, expect, it } from "vitest";
import { STEP_INSET, placeStepLabels, stepSentence } from "./TrendCard";

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
    // Clear of the top gridline and the x axis
    const top = yAxis.y + STEP_INSET;
    const bottom = yAxis.y + yAxis.height - STEP_INSET - labels[0].height;
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

  it("slides a box along its edge off a line, its leader still inside the box", () => {
    const { xAxis, yAxis } = axes();
    // Lines along the top and the foot from 2029 on: a box centred over
    // 2028 would reach them at either edge
    const notes = [{ year: 2028, step: 50, text: "Zero VAT on electricity" }];
    const high = [null, null, null, 280, 280, null];
    const low = [null, null, null, -280, -280, null];
    const labels = placeStepLabels({
      notes,
      xAxis,
      yAxis,
      valueAt: () => 0,
      paths: [high, low],
      years: YEARS,
      gridValues: [-300, -150, 0, 150, 300],
    });
    expect(labels).toHaveLength(1);
    const [label] = labels;
    const lineStart = xAxis.scale(2029) + xAxis.scale.bandwidth() / 2;
    // A rise's label stays at the top, slid left off the line
    expect(label.top).toBe(yAxis.y + STEP_INSET);
    expect(label.left + label.width).toBeLessThan(lineStart - 3);
    expect(label.x).toBeGreaterThanOrEqual(label.left + 8);
    expect(label.x).toBeLessThanOrEqual(label.left + label.width - 8);
  });

  it("keeps a box off the gridlines between the edges", () => {
    const { xAxis, yAxis } = axes();
    const notes = [{ year: 2028, step: 50, text: "Threshold freeze" }];
    const labels = placeStepLabels({ notes, xAxis, yAxis, valueAt: () => 0, years: YEARS, gridValues: [-300, 0, 300] });
    const scaled = [-300, 0, 300].map(yAxis.scale);
    for (const y of scaled) expect(y < labels[0].top || y > labels[0].top + labels[0].height).toBe(true);
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
    // The plain headline names the step as "from 2030-31, when the threshold freeze applies"
    expect(
      stepSentence(notes.slice(1), "People gain about £50 a person in 2029-30 and lose about £20 from 2030-31, when the threshold freeze applies.", nameIn),
    ).toBeNull();
  });

  it("names a step from a measure ending as its end, never as it applying", () => {
    const notes = [{ year: 2028, measureId: "fuel", ends: true }];
    const nameIn = () => "fuel duty cut extended";
    expect(stepSentence(notes, null, nameIn)).toBe("The biggest step comes in 2028-29 from the end of the fuel duty cut extended.");
    expect(
      stepSentence(notes, "People gain about £36 a person in 2027-28 and lose about £5 from 2028-29, when the fuel duty cut extended has ended.", nameIn),
    ).toBeNull();
  });
});
