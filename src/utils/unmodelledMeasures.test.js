import { describe, expect, it } from "vitest";
import { UNMODELLED_MEASURES, UNMODELLED_POINT_LABELS } from "./unmodelledMeasures";

// Short card text (Vahid, 29 Oct: "bullets, not long paragraphs"): a
// one-line summary and one short labelled point each for what changes, who
// it reaches and why we leave it out
const words = (text) => text.trim().split(/\s+/).length;

describe("Budget policies we do not model: card text", () => {
  it("gives every card a summary of 15 words and three labelled points of 12", () => {
    for (const measure of UNMODELLED_MEASURES) {
      expect(words(measure.summary), measure.id).toBeLessThanOrEqual(15);
      expect(measure.points.map((point) => point.label), measure.id).toEqual(UNMODELLED_POINT_LABELS);
      for (const { text } of measure.points) expect(words(text), `${measure.id}: ${text}`).toBeLessThanOrEqual(12);
    }
  });

  it("keeps the old paragraph fields out: their facts are in the summary and points", () => {
    for (const measure of UNMODELLED_MEASURES) {
      for (const field of ["changes", "reaches", "household", "notModelled", "heldBack"]) expect(measure[field], `${measure.id} ${field}`).toBeUndefined();
    }
  });

  it("says each fact once: no point repeats the summary or the start", () => {
    for (const measure of UNMODELLED_MEASURES) {
      for (const { text } of measure.points) {
        expect(text, measure.id).not.toBe(measure.summary);
        expect(text.includes(measure.starts), `${measure.id}: ${text}`).toBe(false);
      }
    }
  });

  it("says lower- or higher-income, never poor or rich", () => {
    for (const measure of UNMODELLED_MEASURES) {
      for (const text of [measure.summary, ...measure.points.map((point) => point.text)]) expect(text, measure.id).not.toMatch(/\b(?:poor|poorer|poorest|rich|richer|richest|wealthy)\b/i);
    }
  });
});
