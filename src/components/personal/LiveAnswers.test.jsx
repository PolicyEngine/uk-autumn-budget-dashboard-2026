/**
 * The result card, its waterfall and the marginal rate sentence, from real
 * answers of the household API as main computes them (the test app at
 * f32e8e76, 27 October 2026, policyengine 6.10.2, every published measure,
 * 2027-28): the figures the page shows must be the API's own.
 *
 *   couple-kids-uc  three measures move it (electricity VAT, fuel duty, road fuel VAT)
 *   hicbc-3kids     £70,000 with three children: the Child Benefit charge in the rate
 *   ni-elec         Northern Ireland: zero VAT on electricity is Great Britain only (#187)
 *
 * Requests: tools in issue "Household calculator before Budget day".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "../PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { resetSavedWizard } from "../HouseholdCalculator";
import { clearHouseholdImpactCache } from "../../hooks/useHouseholdImpact";
import { clearBasisIncomeCache } from "../../hooks/useBasisIncome";
import { resetPresetResults } from "../../utils/householdPresets";
import { approvedDefinition, route, withReportedDefinitions } from "../../test/definitionsFixture";
import LIVE from "../../test/fixtures/householdLiveAnswers2027.json";

const HOUSEHOLD_API = "https://api.test/api/household-impact";
const POLICY_IDS = LIVE["couple-kids-uc"].answer.included;
const POLICIES = POLICY_IDS.map((id) => ({ id, name: id.replace(/_/g, " ") }));
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = LIVE["couple-kids-uc"].answer.engine;
const ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };

const baseEntry = fixtureJson("manifest.json").measures.alpha;
const catalogue = buildMeasureCatalogue({
  manifest: {
    ...fixtureJson("manifest.json"),
    measures: Object.fromEntries(
      POLICIES.map((policy) => [policy.id, { ...baseEntry, ...policy, years: [2027, 2028, 2029, 2030, 2031], unsupported_years: [] }]),
    ),
    combined: {},
  },
  tablesByKey: Object.fromEntries(POLICIES.map((policy) => [policy.id, { engine: ENGINE, definition: approvedDefinition(policy.id) }])),
});

/**
 * Serve `answer` as the API would for each stage, beside the definitions an
 * API running the approved code reports (PR 136).
 */
function serve(answer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (route(url) !== HOUSEHOLD_API) return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
      const { include = [] } = JSON.parse(init.body);
      const staged = {
        ...answer,
        by_policy: include.includes("by_policy") ? answer.by_policy : null,
        sweep: include.includes("sweep") ? answer.sweep : null,
      };
      return withReportedDefinitions(
        new Response(JSON.stringify(staged), { status: 200, headers: { "Content-Type": "application/json" } }),
        url,
      );
    }),
  );
}

function renderAndCalculate() {
  render(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <PersonalImpactTab selectedPolicies={POLICY_IDS} policies={POLICIES} year={2027} />
    </MeasureCatalogueProvider>,
  );
  const region = screen.getByRole("region", { name: "Choose a household" });
  const yours =
    within(region).queryByRole("button", { name: /^Your household/ }) ??
    within(region).getByRole("option", { name: /^Your household/ });
  if (document.getElementById(yours.getAttribute("aria-controls"))?.dataset.open !== "true") fireEvent.click(yours);
  fireEvent.click(screen.getByRole("button", { name: /^Calcul/ }));
}

const pounds = (value) => `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));

beforeEach(() => {
  resetSavedWizard();
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  resetPresetResults();
  window.history.replaceState({}, "", "/?tab=personal");
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the page's figures are the household API's own (real answers, 2027-28)", () => {
  for (const id of ["couple-kids-uc", "hicbc-3kids", "ni-elec"]) {
    it(`${id}: the result card, its waterfall and the marginal rate sentence`, async () => {
      const { answer } = LIVE[id];
      serve(answer);
      renderAndCalculate();
      const before = Math.round(answer.net_income.baseline);
      const after = Math.round(answer.net_income.reform);
      const change = after - before;
      const card = await waitFor(() => {
        const found = document.querySelector(".result-card");
        expect(found).not.toBeNull();
        return found;
      });
      // The headline figure is the API's net income change, in whole pounds
      await waitFor(() =>
        expect(card.querySelector(".result-value").textContent).toBe(
          change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${pounds(change)}`,
        ),
      );
      // The waterfall runs from the API's net income before to after
      const ends = [...card.querySelectorAll(".waterfall-row.is-total")].map((row) => row.textContent);
      expect(ends).toEqual([`Net income before${pounds(before)}`, `Net income after${pounds(after)}`]);
      // Its steps, once the split by policy is in: one per measure the API
      // says moves the household, adding up to the headline
      await waitFor(() => expect(document.querySelector('.net-income-waterfall[data-split="ready"]')).not.toBeNull());
      const steps = [...card.querySelectorAll(".waterfall-row.is-step")];
      const moving = answer.by_policy.measures.filter((m) => m.status !== "not_affected" && Math.round(m.change) !== 0);
      expect(steps.map((step) => step.dataset.row).sort()).toEqual(moving.map((m) => m.id).sort());
      const sum = steps.map((step) => parse(step.querySelectorAll("text")[1].textContent)).reduce((a, b) => a + b, 0);
      expect(sum).toBe(change);
      // The marginal rate at your salary is the API's own point
      const own = answer.sweep.own_point;
      const rate = Math.round(own.reform_marginal_rate * 100);
      const salary = pounds(own.employment_income);
      expect(
        await screen.findByText((text) => text.startsWith(`At ${salary} your marginal tax rate is `) && text.includes(`${rate}%`)),
      ).toBeInTheDocument();
    });
  }
});
