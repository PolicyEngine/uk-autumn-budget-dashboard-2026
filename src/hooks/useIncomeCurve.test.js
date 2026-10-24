import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useIncomeCurve, { curveFor, parseCurve } from "./useIncomeCurve";
import { COMBINED_REFORM_ID } from "../utils/policyConfig";
import { buildMeasureCatalogue, isCatalogueRowDisplayable, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { ALPHA, BETA, COMBINED, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

vi.mock("../utils/publication/flat", () => ({ loadVerifiedFlatCsv: vi.fn() }));
import { loadVerifiedFlatCsv } from "../utils/publication/flat";
afterEach(cleanup);

const HEADER =
  "reform_id,reform_name,year,household,x_variable,income,baseline_net_income,reform_net_income";

const CSV = [
  HEADER,
  `${COMBINED_REFORM_ID},Autumn Budget 2026 (combined),2029,single_renter,employment_income,0.0,1000.0,900.0`,
  `${COMBINED_REFORM_ID},Autumn Budget 2026 (combined),2029,single_renter,employment_income,500.0,1400.0,1300.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,0.0,1100.0,1050.0`,
  `a,"Measure A, with a comma",2029,single_renter,employment_income,500.0,1500.0,1450.0`,
  `b,Measure B,2029,single_renter,employment_income,0.0,1000.0,980.0`,
  `b,Measure B,2029,single_renter,employment_income,500.0,1400.0,1380.0`,
  `a,"Measure A, with a comma",2029,pensioner_couple,private_pension_income,0.0,5000.0,4000.0`,
  `a,"Measure A, with a comma",2030,single_renter,employment_income,0.0,7000.0,6000.0`,
].join("\n");

describe("the example households' curves", () => {
  it("parse every column, a quoted measure name included", () => {
    const rows = parseCurve(CSV);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toEqual({
      reformId: "a",
      year: 2029,
      household: "single_renter",
      income: 0,
      baseline: 1100,
      reformNet: 1050,
    });
  });

  it("sum the selected measures' changes on the combined package's baseline", () => {
    const curve = curveFor(parseCurve(CSV), {
      household: "single_renter",
      year: 2029,
      policies: ["a", "b"],
    });
    expect(curve).toEqual([
      { income: 0, baseline: 1000, difference: -70, reform: 930 },
      { income: 500, baseline: 1400, difference: -70, reform: 1330 },
    ]);
  });

  it("keep households and years apart", () => {
    const rows = parseCurve(CSV);
    const pensioners = curveFor(rows, { household: "pensioner_couple", year: 2029, policies: ["a"] });
    expect(pensioners).toEqual([]);
    expect(curveFor(rows, { household: "lone_parent", year: 2029, policies: ["a"] })).toEqual([]);
  });
});


describe("approved example-household baseline", () => {
  const rows = [
    { reformId: ALPHA, household: "example", year: YEAR, income: 0, baseline: 190, reformNet: 200 },
    { reformId: BETA, household: "example", year: YEAR, income: 0, baseline: 195, reformNet: 200 },
    { reformId: COMBINED, household: "example", year: YEAR, income: 0, baseline: 185, reformNet: 200 },
  ];
  it("uses the combined baseline rather than a member baseline", () => {
    const catalogue = buildMeasureCatalogue(measureCatalogueFixture({ held: false }));
    expect(curveFor(rows.filter((row) => isCatalogueRowDisplayable(catalogue, row.reformId, row.year)), { household: "example", year: YEAR, policies: [ALPHA, BETA], combinedId: catalogue.combinedId })).toEqual([{ income: 0, baseline: 185, difference: 15, reform: 200 }]);
  });
  it.each(["staged", "withdrawn", "not_computable"])("shows no absolute levels when the combined run is %s", (status) => {
    const fixture = measureCatalogueFixture({ held: false });
    fixture.manifest.combined[COMBINED].status = status;
    const catalogue = buildMeasureCatalogue(fixture);
    expect(curveFor(rows.filter((row) => isCatalogueRowDisplayable(catalogue, row.reformId, row.year)), { household: "example", year: YEAR, policies: [ALPHA, BETA], combinedId: catalogue.combinedId })).toEqual([]);
  });
  it("requires the approved baseline at every income point", () => {
    const missingPoint = { reformId: ALPHA, household: "example", year: YEAR, income: 100, baseline: 190, reformNet: 200 };
    expect(curveFor([...rows, missingPoint], { household: "example", year: YEAR, policies: [ALPHA], combinedId: COMBINED })).toEqual([]);
  });
});


it.each(["staged", "withdrawn", "not_computable"])("the real income curve hook supplies no figure for a %s combined run", async (status) => {
  const fixture = measureCatalogueFixture({ held: false });
  fixture.manifest.combined[COMBINED].status = status;
  const catalogue = buildMeasureCatalogue(fixture);
  const csv = [HEADER,
    `${ALPHA},Alpha,${YEAR},single_renter,employment_income,0,190,200`,
    `${BETA},Beta,${YEAR},single_renter,employment_income,0,195,200`,
    `${COMBINED},Combined,${YEAR},single_renter,employment_income,0,185,200`,
  ].join("\n");
  vi.mocked(loadVerifiedFlatCsv).mockResolvedValue(csv);
  const wrapper = ({ children }) => createElement(MeasureCatalogueProvider, { catalogue }, children);
  const { result } = renderHook(() => useIncomeCurve({ household: "single_renter", year: YEAR, policies: [ALPHA, BETA] }), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual([]);
});
