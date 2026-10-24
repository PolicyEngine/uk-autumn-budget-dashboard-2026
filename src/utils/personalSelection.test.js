import { describe, expect, it } from "vitest";
import { personalSelection } from "./personalSelection";

const measure = {
  id: "published", label: "Published measure", displayable: true, years: [2026, 2029], unsupported_years: [],
  personal: { key: "impact_published", model: "personal", reviewed: true, description: "Reviewed household implementation.", years: [2026, 2029] },
};
const results = { years: { 2026: {}, 2029: {} }, policies: {
  impact_published: { years: { 2026: { net_income_change: 10 }, 2029: { net_income_change: 20 } } },
  published: { years: { 2026: { net_income_change: 999 }, 2029: { net_income_change: 999 } } },
} };

describe("reviewed personal impact contracts", () => {
  it("reads only the explicitly mapped impact series", () => {
    const selection = personalSelection([measure.id], [measure], results);
    expect(selection.modelled.map((item) => item.key)).toEqual(["impact_published"]);
    expect(selection.unmodelled).toEqual([]);
  });

  it.each([
    ["no model-year contract", { ...measure, personal: { key: "impact_published" } }],
    ["lifetime mapping", { ...measure, personal: { ...measure.personal, model: "lifecycle" } }],
    ["unsupported publication year", { ...measure, years: [2029], unsupported_years: [2026] }],
    ["unsupported personal year", { ...measure, personal: { ...measure.personal, years: [2029], unsupported_years: [2026] } }],
    ["non-impact column", { ...measure, personal: { ...measure.personal, key: "published" } }],
  ])("withholds a finite API figure for %s", (_, published) => {
    const selection = personalSelection([measure.id], [published], results);
    expect(selection.modelled).toEqual([]);
    expect(selection.unmodelled).toEqual([measure.label]);
  });
});
