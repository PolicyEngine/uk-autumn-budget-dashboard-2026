import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HouseholdCards from "./HouseholdCards";
import { HOUSEHOLD_EXAMPLES } from "../../utils/householdExamples";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";

// #104 review (m23, P2): a card names the measures it features only while
// the catalogue publishes every one of them. The driver's card features the
// fuel duty deferral and the road fuel VAT cut together.
const baseEntry = fixtureJson("manifest.json").measures.alpha;
const publishing = (ids) =>
  buildMeasureCatalogue({
    manifest: {
      ...fixtureJson("manifest.json"),
      measures: Object.fromEntries(ids.map((id) => [id, { ...baseEntry, name: id, years: [2029], unsupported_years: [] }])),
      combined: {},
    },
    tablesByKey: Object.fromEntries(ids.map((id) => [id, {}])),
  });

const driverTag = (catalogue) => {
  render(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <HouseholdCards examples={HOUSEHOLD_EXAMPLES} value={null} formOpen={false} formId="f" onYours={() => {}} onChoose={() => {}} presets={null} yoursChange={null} year={2029} chosen={false} yoursSelected={false} />
    </MeasureCatalogueProvider>,
  );
  const driver = screen.getByRole("button", { name: /^A driver with a long commute/ });
  return driver.querySelector(".household-card-tag")?.textContent ?? null;
};

it("names both fuel measures on the driver's card while both are published", () => {
  expect(driverTag(publishing(["fuel_duty_rise_deferral", "road_fuel_vat_cut"]))).toMatch(/fuel VAT/i);
});

it("names neither while one of them is withdrawn (on Budget day, say)", () => {
  expect(driverTag(publishing(["fuel_duty_rise_deferral", "state_pension_income_tax_protection"]))).toBeNull();
});
