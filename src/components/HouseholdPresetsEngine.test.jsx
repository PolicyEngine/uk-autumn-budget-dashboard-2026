import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "./PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { fixtureJson } from "../test/publicationFixture";
import { resetSavedWizard } from "./HouseholdCalculator";
import { clearHouseholdImpactCache } from "../hooks/useHouseholdImpact";
import { clearBasisIncomeCache } from "../hooks/useBasisIncome";
import { presetRequests, resetPresetResults } from "../utils/householdPresets";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";
import { POLICIES_FOR_TEST } from "../test/personalPolicies";
import { approvedDefinition, route, withReportedDefinitions } from "../test/definitionsFixture";

// #104 review (m23, P1): the examples' precomputed answers are checked
// against the engine every published measure's receipts record, whatever is
// selected when they load. With no measure selected the page expects no
// engine, and a file from another engine used to be seeded then and shown
// later, unchecked, with no request. #136: and against each one's approved
// definition, which the file records as the precompute bound it; a file
// with none, or another for any measure, is never used either.
const HOUSEHOLD_API = "https://api.test/api/household-impact";
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = HOUSEHOLD_FIXTURE.engine;
const PUBLISHED_ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };
const STALE_ENGINE = { ...PUBLISHED_ENGINE, "policyengine-uk": "0.0.0-stale" };
const SUPPORTED = POLICIES_FOR_TEST.filter((p) => HOUSEHOLD_FIXTURE.included.includes(p.id)).map((p) => p.id);
const MEASURES = POLICIES_FOR_TEST.filter((p) => SUPPORTED.includes(p.id));
// What every measure's receipt approved, and so what the file must record
const DEFINITIONS = Object.fromEntries(SUPPORTED.map((id) => [id, approvedDefinition(id)]));
const [CHANGED] = [...SUPPORTED].sort();
const OTHER_DEFINITIONS = { ...DEFINITIONS, [CHANGED]: { ...DEFINITIONS[CHANGED], reform: { ...DEFINITIONS[CHANGED].reform, reform_sha256: "e".repeat(64) } } };

const baseEntry = fixtureJson("manifest.json").measures.alpha;
const catalogue = buildMeasureCatalogue({
  manifest: {
    ...fixtureJson("manifest.json"),
    measures: Object.fromEntries(
      POLICIES_FOR_TEST.map((p) => [p.id, { ...baseEntry, ...p, years: [2026, 2027, 2028, 2029, 2030, 2031], unsupported_years: [] }]),
    ),
    combined: {},
  },
  tablesByKey: Object.fromEntries(POLICIES_FOR_TEST.map((p) => [p.id, { engine: PUBLISHED_ENGINE, definition: approvedDefinition(p.id) }])),
});
const Wrapper = ({ children }) => <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const headlineCard = () => document.querySelector(".result-card");
function householdItem(name) {
  const region = screen.getByRole("region", { name: "Choose a household" });
  return within(region).queryByRole("button", { name }) ?? within(region).getByRole("option", { name });
}

// The presets file, under `engine` and recording `definitions` (no key at
// all for null, as a file written before them has), each answer
// with a marker headline (+£4,242 a year) so where a result came from shows
// on screen
let household;
function servePresets(engine, definitions = DEFINITIONS) {
  household = [];
  const entries = presetRequests(SUPPORTED).map(({ preset_id, year, request }) => {
    const answer = householdAnswerFor(request);
    return { preset_id, year, request, response: { ...answer, net_income: { ...answer.net_income, baseline: 10000, reform: 14242, change: 4242 } } };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (String(url).endsWith("/data/household_presets.json")) return json({ policies: SUPPORTED, engine, ...(definitions === null ? {} : { definitions }), entries });
      if (route(url) === HOUSEHOLD_API) {
        household.push(JSON.parse(init.body));
        return withReportedDefinitions(json(householdAnswerFor(JSON.parse(init.body))), url);
      }
      return json({ detail: "not found" }, 404);
    }),
  );
}

// No measure selected while the presets load, then every measure, then an
// example chosen
async function chooseExampleAfterClearing() {
  const { rerender } = render(<PersonalImpactTab selectedPolicies={[]} policies={MEASURES} year={2029} />, { wrapper: Wrapper });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  rerender(<PersonalImpactTab selectedPolicies={SUPPORTED} policies={MEASURES} year={2029} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  fireEvent.click(householdItem(/^A graduate on £35,000/));
  await waitFor(() => expect(headlineCard()).not.toBeNull(), { timeout: 3000 });
}

beforeEach(() => {
  resetSavedWizard();
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  resetPresetResults();
  window.history.replaceState({}, "", "/?tab=personal");
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
  vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the examples' precomputed answers and the receipts' engine", () => {
  it("refuses a file from another engine with every measure selected from the start, and asks the API", async () => {
    servePresets(STALE_ENGINE);
    render(<PersonalImpactTab selectedPolicies={SUPPORTED} policies={MEASURES} year={2029} />, { wrapper: Wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.click(householdItem(/^A graduate on £35,000/));
    await waitFor(() => expect(headlineCard()).not.toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(document.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull(), { timeout: 3000 });
    expect(household.length).toBeGreaterThan(0);
    expect(headlineCard().textContent).not.toContain("4,242");
  });

  it("refuses it too when it loaded while no measure was selected", async () => {
    servePresets(STALE_ENGINE);
    await chooseExampleAfterClearing();
    await waitFor(() => expect(document.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull(), { timeout: 3000 });
    expect(household.length).toBeGreaterThan(0);
    expect(headlineCard().textContent).not.toContain("4,242");
  });

  it("still shows a file from the published engine at once, asking nothing, however the selection got there", async () => {
    servePresets(PUBLISHED_ENGINE);
    await chooseExampleAfterClearing();
    await waitFor(() => expect(headlineCard().textContent).toContain("4,242"), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(household).toHaveLength(0);
  });
});

describe("the examples' precomputed answers and the receipts' definitions (PR 136)", () => {
  it.each([
    ["records none (written before them)", null],
    ["records another for a measure", OTHER_DEFINITIONS],
    ["leaves a measure out", Object.fromEntries(Object.entries(DEFINITIONS).filter(([id]) => id !== CHANGED))],
  ])("refuses a file that %s, however the selection got there, and asks the API", async (_, definitions) => {
    servePresets(PUBLISHED_ENGINE, definitions);
    await chooseExampleAfterClearing();
    await waitFor(() => expect(document.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull(), { timeout: 3000 });
    expect(household.length).toBeGreaterThan(0);
    expect(headlineCard().textContent).not.toContain("4,242");
  });
});
