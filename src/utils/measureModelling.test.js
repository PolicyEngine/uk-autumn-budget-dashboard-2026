import { describe, expect, it } from "vitest";
import { measureModellingFacts, modellingFacts, MODELLING_NOTE, sentences } from "./measureModelling";

describe("measure modelling, read from the published wording", () => {
  it("reads fact and limitation chips by wording alone", () => {
    const text = "Candidate measure. VAT falls to 15%, fully passed through to pump prices; spending on fuel is held fixed. Day-weighted to fiscal years. Applied in Great Britain, so households in Scotland are approximate. The data identify no apprentices, so the cost includes them. Gains are imputed, so the base is likely 1.5 to 1.7 times too high.";
    const { facts, limits } = modellingFacts(text);
    expect(facts).toEqual(["Day-weighted", "Spending held fixed", "Full pass-through", "Great Britain only", "Imputed data"]);
    expect(limits.map((limit) => limit.label)).toEqual(["Approximate for Scotland", "Data limit: no apprentices flagged", "Known limitation"]);
    expect(limits[2].sentence).toBe("Gains are imputed, so the base is likely 1.5 to 1.7 times too high.");
    expect(modellingFacts("Wages are held fixed.").facts).toEqual(["Wages held fixed"]);
    expect(modellingFacts("A plain measure.")).toEqual({ facts: [], limits: [] });
  });

  it("leaves out what the card's own text already states", () => {
    const text = "Paid in Great Britain, so households in Scotland are approximate. The data identify no apprentices.";
    const { facts, limits } = modellingFacts(text, "Paid to households in Great Britain; eligibility in Scotland is approximate.");
    expect(facts).toEqual([]);
    expect(limits.map(({ label, said }) => [label, said])).toEqual([["Approximate for Scotland", true], ["Data limit: no apprentices flagged", false]]);
    expect(modellingFacts(text).limits.every((limit) => !limit.said)).toBe(true);
  });

  it("adds the one modelling note only to its measure", () => {
    const other = { id: "another_measure", description: "Published." };
    expect(measureModellingFacts(other).notePoints).toEqual([]);
    expect(measureModellingFacts({ ...other, id: MODELLING_NOTE.id }).notePoints).toEqual(sentences(MODELLING_NOTE.note));
  });

  it("keeps the modelling note neutral: no outside organisation, and only a government figure", () => {
    // Dashboard text names no think tank or outside analyst and compares
    // with no outside estimate. A figure of ours needs a receipt (review of
    // 3d52cff, finding 3), so the note's one figure is HMRC's, dated.
    expect(MODELLING_NOTE.note).not.toMatch(/Resolution Foundation|Tax Policy Associates|Institute|Foundation|Associates|think tank/i);
    const priced = sentences(MODELLING_NOTE.note).filter((sentence) => sentence.includes("£"));
    expect(priced.length).toBeGreaterThan(0);
    for (const sentence of priced) {
      expect(sentence).toMatch(/\bHMRC\b/);
      expect(sentence).toMatch(/2025-26/);
    }
    expect(MODELLING_NOTE.note).not.toMatch(/\bthe model\b|PolicyEngine/i);
  });
});
