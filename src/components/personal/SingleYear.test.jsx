import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "../PersonalImpactTab";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";
import { resetSavedWizard } from "../HouseholdCalculator";
import { clearHouseholdImpactCache } from "../../hooks/useHouseholdImpact";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../../test/householdFixture";
import { POLICIES_FOR_TEST } from "../../test/personalPolicies";
import { APPROVED_COMMIT, approvedDefinition, requestedDefinitions, route, withReportedDefinitions } from "../../test/definitionsFixture";

const HOUSEHOLD_API = "https://api.test/api/household-impact";
// The receipts' model versions, which the household fixture's answer runs:
// Personal impact shows nothing when the two differ.
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = HOUSEHOLD_FIXTURE.engine;
const PUBLISHED_ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };
const SUPPORTED_POLICY_IDS = POLICIES_FOR_TEST.filter((policy) => HOUSEHOLD_FIXTURE.included.includes(policy.id)).map((policy) => policy.id);

let household;

/**
 * Answer the household API with `respond(body)`, beside the definitions an
 * API running the approved code reports (or `definitionFor(id)` at each
 * requested commit); any other URL is a 404.
 */
function serve(respond, definitionFor) {
  household = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (route(url) === HOUSEHOLD_API) {
        const body = JSON.parse(init.body);
        household.push(body);
        return withReportedDefinitions(await respond(body, init), url, definitionFor);
      }
      return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    }),
  );
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetSavedWizard();
  clearHouseholdImpactCache();
  window.history.replaceState({}, "", "/?tab=personal");
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", HOUSEHOLD_API);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const baseEntry = fixtureJson("manifest.json").measures.alpha;
const testCatalogue = buildMeasureCatalogue({
  manifest: {
    ...fixtureJson("manifest.json"),
    measures: Object.fromEntries(POLICIES_FOR_TEST.map((policy) => [policy.id, {
      ...baseEntry, ...policy, years: [2026, 2027, 2028, 2029, 2030, 2031], unsupported_years: [],
    }])),
    combined: {},
  },
  tablesByKey: Object.fromEntries(POLICIES_FOR_TEST.map((policy) => [policy.id, { engine: PUBLISHED_ENGINE, definition: approvedDefinition(policy.id) }])),
});
function PublishedMeasures({ children }) {
  return <MeasureCatalogueProvider catalogue={testCatalogue}>{children}</MeasureCatalogueProvider>;
}

function renderTab(props = {}) {
  return render(
    <PersonalImpactTab
      selectedPolicies={SUPPORTED_POLICY_IDS}
      policies={POLICIES_FOR_TEST}
      year={2029}
      {...props}
    />,
    { wrapper: PublishedMeasures },
  );
}

// The results are beside the form from the start: every answer has a
// default, and they update as the answers change
function toResults() {}

const HEADLINE = /The selected policies would/;

// The headline, beside the form
const results = () => screen.findByRole("region", { name: "Results" });

describe("Personal impact's results", () => {
  it("show the household calculation alone: no sub-tabs (an old ?sub= link is ignored), only the household route", async () => {
    window.history.replaceState({}, "", "/?tab=personal&sub=multi");
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prices/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/lifetime/i)).not.toBeInTheDocument();
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => route(url) === HOUSEHOLD_API)).toBe(true);
    // Each names every selected measure's approved commit, in id order
    for (const url of urls) {
      expect(requestedDefinitions(url)).toEqual([...SUPPORTED_POLICY_IDS].sort().map((id) => [id, APPROVED_COMMIT]));
    }
  });
});

describe("the household calculation, from the fixture", () => {
  it("asks for the headline first, then the breakdown, with the wizard's answers", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    expect(household.map((body) => body.include)).toEqual([[], ["by_policy", "sweep"]]);
    const [first] = household;
    expect(first.year).toBe(2029);
    expect(first.household).toMatchObject({
      // The form's defaults (utils/householdDefaults.js)
      age: 30,
      employment_income: 34200,
      region: "NORTH_WEST",
      tenure: "RENT_PRIVATELY",
      monthly_rent: 975,
      student_loan_plan: "NONE",
      has_partner: false,
      claims_universal_credit: true,
      petrol_spending: 620,
      diesel_spending: 340,
      council_tax_band: "D",
      salary_year: 2026,
      children: [],
    });
    expect(first.household).not.toHaveProperty("children_ages");
  });

  it("says the change in one sentence, then one line of what it assumes", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    const panel = await results();
    const banner = (await within(panel).findByText(HEADLINE)).closest(".single-year-banner");
    expect(banner).toHaveTextContent(
      "The selected policies would raise your household's annual net income by £3,765 (+5.8%) in 2029-30",
    );
    expect(banner).toHaveClass("is-gain");
    // The change is said once: not as a tile, not in the breakdown, and no
    // sentence repeating what the headline says
    expect(panel.querySelector(".single-year-tiles")).toBeNull();
    expect(panel).not.toHaveTextContent("before and after the selected policies.");
    // One line of assumptions, short items, for the supported selection.
    const assumptions = panel.querySelector("dl.single-year-assumptions");
    expect(assumptions).toHaveTextContent(
      "Salary in 2029-30: £34,192, partner £12,822 (grown from 2026 with OBR earnings)",
    );
    expect(assumptions).toHaveTextContent("Rent area: Central Greater Manchester (region default)");
    expect(assumptions).not.toHaveTextContent("not modelled");
    expect(panel).not.toHaveTextContent("spreads a national cost");
    expect(panel.textContent.match(/Rent area/g)).toHaveLength(1);
    // No child of 16 or over: no item on who counts as a child
    expect(panel).not.toHaveTextContent("Children 16 to 19");
  });

  it("draws one bar per policy that changes the household, adding up to the change", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    const bars = [...container.querySelectorAll(".policy-bar")];
    expect(bars.map((bar) => bar.dataset.policy)).toEqual([
      "two_child_limit",
      "threshold_freeze_extension",
      "salary_sacrifice_cap",
      "fuel_duty_freeze",
    ]);
    const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));
    const sum = bars
      .map((bar) => parse(bar.querySelector(".policy-bar-value").textContent))
      .reduce((a, b) => a + b, 0);
    const headline = container.querySelector(".single-year-amount").textContent;
    expect(sum).toBe(parse(headline));
    expect(sum).toBe(3765);
    expect(screen.getByText(/No effect on your household: Dividend tax increase/)).toBeInTheDocument();
    expect(container.querySelector('[data-policy="interaction"]')).toBeNull();
  });

  it("breaks net income down as Spring Statement does: market income, taxes, benefits", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    const table = await screen.findByRole("table");
    const rowNames = () =>
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent.replace(/[▸▾]/g, ""));
    expect(rowNames()).toEqual(["Market income", "Taxes", "Benefits", "Net income"]);
    for (const name of ["Before", "After", "Change"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    // Net income: before and after only; its change is the sentence above
    const net = within(table).getByRole("row", { name: /Net income/ });
    expect(net).toHaveTextContent("£65,371£69,136");
    expect(net).not.toHaveTextContent("£3,765");

    // Each top row opens to its taxes or benefits, closed at first
    expect(within(table).queryByText("Income tax")).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /Taxes/ }));
    const incomeTax = within(table).getByRole("row", { name: /Income tax/ });
    expect(incomeTax).toHaveTextContent("−£4,164−£4,360−£196");
    expect(within(incomeTax).getByText("−£196")).toHaveClass("is-loss");
    // And a programme to its parts
    fireEvent.click(within(table).getByRole("button", { name: /Income tax/ }));
    expect(within(table).getByText("On earnings")).toBeInTheDocument();

    // The top rows add up to net income, in every column
    const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));
    const top = [...table.querySelectorAll(".programme-row.depth-0")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => parse(cell.textContent)),
    );
    const sums = [0, 1, 2].map((col) => top.reduce((acc, row) => acc + row[col], 0));
    expect(sums).toEqual([65371, 69136, 3765]);

    // About these figures: closed under the table, then the rows' notes
    // and the method as definition lists
    const about = screen.getByRole("button", { name: "About these figures" });
    expect(about).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Elements are before the earnings taper/)).not.toBeInTheDocument();
    fireEvent.click(about);
    expect(about).toHaveAttribute("aria-expanded", "true");
    const panel = about.closest(".disclosure");
    expect(panel).toHaveClass("disclosure-in-card");
    const terms = [...panel.querySelectorAll("dt")].map((term) => term.textContent);
    expect(terms).toContain("Universal Credit");
    expect(terms).toContain("Change by policy");
    expect(within(panel).getByText(/Elements are before the earnings taper/).tagName).toBe("DD");
    expect(within(panel).getByText(/Each policy's bar is that policy on its own/)).toBeInTheDocument();
  });

  it("marks you on the earnings chart, with the marginal rate in its own card beside it", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    await screen.findByRole("heading", { name: /Net income across earnings/ });
    expect(container.querySelector(".earnings-you")).toHaveTextContent("You");
    // Always shown, not in an expander
    expect(screen.queryByRole("button", { name: "Marginal tax rate across earnings" })).not.toBeInTheDocument();
    const pair = container.querySelector(".single-year-chart-pair");
    expect(within(pair).getByRole("heading", { name: "Marginal tax rate across earnings, 2029-30" })).toBeInTheDocument();
    expect(pair.children).toHaveLength(2);
    expect(screen.getByText("At £34,192 your marginal tax rate is 68% before and 68% after.")).toBeInTheDocument();
    expect(screen.queryByText(/publication's order/)).not.toBeInTheDocument();
  });

  it("asks again for another year, and shows nothing without a policy", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = renderTab();
    toResults();
    await screen.findByText(HEADLINE);
    rerender(
      <PersonalImpactTab selectedPolicies={SUPPORTED_POLICY_IDS} policies={POLICIES_FOR_TEST} year={2030} />,
    );
    await waitFor(() => expect(household.some((body) => body.year === 2030)).toBe(true));
    rerender(<PersonalImpactTab selectedPolicies={[]} policies={POLICIES_FOR_TEST} year={2030} />);
    expect(screen.getByText(/Select at least one policy/)).toBeInTheDocument();
  });
});

describe("while a new answer loads", () => {
  /** Serve the first answers at once, then hold every later request until released. */
  function serveSlowly() {
    const held = [];
    let slow = false;
    serve((body) => {
      if (!slow) return json(householdAnswerFor(body));
      return new Promise((resolve) => held.push(() => resolve(json(householdAnswerFor(body)))));
    });
    return {
      slowDown: () => {
        slow = true;
      },
      releaseAll: () => held.splice(0).forEach((release) => release()),
      held,
    };
  }

  const banner = () => screen.getByText(HEADLINE).closest(".single-year-banner");
  const stalePart = () => screen.getByText(HEADLINE).closest(".single-year-stale");
  const details = (container) => container.querySelector(".single-year-details");

  it("keeps the old figures under their own year, greyed, until the new year's answer arrives", async () => {
    const server = serveSlowly();
    const { rerender, container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    expect(banner()).toHaveTextContent("in 2029-30");
    expect(stalePart()).toBeNull();
    server.slowDown();
    const ids = SUPPORTED_POLICY_IDS;
    rerender(<PersonalImpactTab selectedPolicies={ids} policies={POLICIES_FOR_TEST} year={2030} />);
    // At once, and still after the debounce and while the request is held
    for (const wait of [0, 600]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      expect(banner()).toHaveTextContent("in 2029-30");
      expect(banner()).not.toHaveTextContent("2030-31");
      expect(stalePart()).toHaveClass("is-stale");
      expect(details(container)).toHaveClass("is-stale");
      expect(screen.getByRole("heading", { name: /Change in net income by policy, 2029-30/ })).toBeInTheDocument();
      expect(screen.getByText(/Updating for 2030-31/)).toBeInTheDocument();
    }
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    server.releaseAll();
    await waitFor(() => expect(banner()).toHaveTextContent("in 2030-31"));
    expect(stalePart()).toBeNull();
    expect(screen.queryByText(/Updating for/)).not.toBeInTheDocument();
    // The breakdown stage: the old bars stay greyed under their year until it lands
    await waitFor(() => expect(server.held.length).toBeGreaterThan(0));
    expect(details(container)).not.toHaveClass("is-stale");
    server.releaseAll();
    await screen.findByRole("heading", { name: /Change in net income by policy, 2030-31/ });
  });

  it("greys a deselected policy's bar rather than showing it as current", async () => {
    const server = serveSlowly();
    const { rerender, container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Change in net income by policy/ });
    server.slowDown();
    const ids = SUPPORTED_POLICY_IDS.slice(1);
    rerender(<PersonalImpactTab selectedPolicies={ids} policies={POLICIES_FOR_TEST} year={2029} />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(stalePart()).toHaveClass("is-stale");
    expect(details(container)).toHaveClass("is-stale");
    expect(details(container)).toHaveAttribute("aria-busy", "true");
    server.releaseAll();
    await waitFor(() => expect(stalePart()).toBeNull());
  });
});

describe("the household calculation's errors", () => {
  it("names a refused child's age as the children's, not yours", async () => {
    serve(() =>
      json({ detail: [{ loc: ["body", "household", "children", 0, "age"], msg: "Input should be less than or equal to 19" }] }, 422),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Children's ages: Input should be less than or equal to 19");
  });

  it("says what to do about a child of 20 or over", async () => {
    serve(() =>
      json(
        {
          detail: [
            {
              type: "less_than_equal",
              loc: ["body", "household", "children", 0, "age"],
              msg: "Input should be less than or equal to 19",
            },
          ],
        },
        422,
      ),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Children's ages: Children are 0 to 19.");
    expect(alert).toHaveTextContent("leave them out");
  });

  it("names the answers the API refused", async () => {
    serve(() =>
      json(
        {
          detail: [
            { loc: ["body", "household", "monthly_rent"], msg: "Input should be less than or equal to 100000" },
            { loc: ["body", "household", "age"], msg: "Input should be greater than or equal to 16" },
          ],
        },
        422,
      ),
    );
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Results are not available here.");
    expect(alert).toHaveTextContent("Monthly rent: Input should be less than or equal to 100000");
    expect(alert).toHaveTextContent("Age: Input should be greater than or equal to 16");
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("says when the build has no API URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "");
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    expect(await screen.findByRole("alert")).toHaveTextContent("NEXT_PUBLIC_HOUSEHOLD_API_URL is not set");
    expect(household).toEqual([]);
  });

  it("offers to try again after a server error, and recovers", async () => {
    let fail = true;
    serve((body) => (fail ? json({ detail: "boom" }, 500) : json(householdAnswerFor(body))));
    renderTab();
    toResults();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("answered with an error (500)");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(HEADLINE)).toBeInTheDocument();
  });

  it("keeps the headline when only the breakdown fails", async () => {
    serve((body) =>
      body.include.length ? json({ detail: "boom" }, 503) : json(householdAnswerFor(body)),
    );
    renderTab();
    toResults();
    expect(await screen.findByText("The split by policy is not available.")).toBeInTheDocument();
    expect(screen.getByText("The earnings charts are not available.")).toBeInTheDocument();
    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("gives up on a calculation that takes too long", async () => {
    serve((_body, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const { postHouseholdImpact, buildHouseholdRequest } = await import("../../utils/householdImpactApi");
    const body = buildHouseholdRequest(
      { current_age: 30, current_salary: 30000, children_ages: "" },
      { year: 2029, policies: ["two_child_limit"] },
    );
    await expect(postHouseholdImpact(body, { timeoutMs: 20 })).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringMatching(/took longer than/),
    });
  });
});

describe("an unavailable household calculation", () => {
  it.each(["mixed", "only unmodelled"])("keeps the wizard but suppresses %s aggregate results", async (selection) => {
    const unmodelledId = HOUSEHOLD_FIXTURE.not_modelled[0].id;
    const ids = selection === "mixed" ? [...SUPPORTED_POLICY_IDS, unmodelledId] : [unmodelledId];
    serve((body) => {
      const answer = structuredClone(householdAnswerFor(body));
      // An API label never overrides the publication catalogue's label.
      answer.not_modelled[0].name = "A different API label";
      if (selection === "only unmodelled") {
        answer.net_income.reform = answer.net_income.baseline;
        answer.net_income.change = 0;
      }
      return json(answer);
    });
    renderTab({ selectedPolicies: ids });
    const panel = await results();
    expect(await within(panel).findByText("Personal impact is unavailable for this selection")).toBeInTheDocument();
    expect(panel).toHaveTextContent(POLICIES_FOR_TEST.find((policy) => policy.id === unmodelledId).name);
    expect(panel).not.toHaveTextContent("A different API label");
    expect(panel).not.toHaveTextContent("£0");
    expect(screen.queryByText(HEADLINE)).toBeNull();
    expect(screen.queryByRole("region", { name: "Your household's results" })).toBeNull();
    expect(screen.getByRole("heading", { name: "More details" })).toBeInTheDocument();
    expect(household.length).toBeGreaterThan(0);
  });
});

describe("the fixture", () => {
  it("is a real answer: per-policy rows plus the residual make the change", () => {
    const { by_policy: byPolicy, net_income: net } = HOUSEHOLD_FIXTURE;
    const singles = byPolicy.measures.reduce((sum, row) => sum + row.change, 0);
    expect(singles + byPolicy.residual).toBeCloseTo(net.change, 1);
    expect(byPolicy.combined).toBe(net.change);
    expect(Object.keys(HOUSEHOLD_FIXTURE).sort()).toEqual(
      [
        "area",
        "by_policy",
        "dependants",
        "dependants_note",
        "engine",
        "fiscal_year",
        "included",
        "net_income",
        "not_in_breakdown",
        "not_modelled",
        "programmes",
        "salary_used",
        "sweep",
        "year",
      ].sort(),
    );
    expect(HOUSEHOLD_FIXTURE.sweep.points).toHaveLength(HOUSEHOLD_FIXTURE.sweep.marginal_rates.length + 1);
  });
});

// W5's page follow-up to #125 (coordinator's ruling): measures the API's
// code computes from other definitions are listed unavailable, with the
// existing remove action, and no figure is shown
describe("a household calculation from other definitions", () => {
  const [changedId] = [...SUPPORTED_POLICY_IDS].sort();
  const changedName = POLICIES_FOR_TEST.find((policy) => policy.id === changedId).name;
  const otherDefinition = (id) => {
    const definition = approvedDefinition(id);
    return id === changedId ? { ...definition, reform: { ...definition.reform, binding: "code_revision" } } : definition;
  };

  it("lists the measure unavailable, says how it differs, and offers to remove it", async () => {
    serve((body) => json(householdAnswerFor(body)), otherDefinition);
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    const region = await results();
    expect(await within(region).findByText("Personal impact is unavailable for the selected measures")).toBeInTheDocument();
    expect(within(region).getByText(/does not compute these measures from the definitions/)).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual([`${changedName}: its reform binding differs`]);
    expect(within(region).queryByText(HEADLINE)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your household's results" })).not.toBeInTheDocument();
    // No figure beside the form (the form's own answers show their pounds)
    expect(region.textContent).not.toMatch(/£\d/);
    fireEvent.click(within(region).getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith([changedId]);
    // Refused at the headline: the breakdown was never asked for
    expect(household.map((body) => body.include)).toEqual([[]]);
  });

  it("shows the results once the API computes every measure from its approved definition", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText("Personal impact is unavailable for the selected measures")).not.toBeInTheDocument();
  });
  // Review of 0608183, finding 7: a build that reports no definitions
  // (one before #125) gives nothing to tell the measures apart by
  it("says the answers can't be checked when the API reports no definitions, and offers to ask again, not to remove every measure", async () => {
    let reports = false;
    household = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const body = JSON.parse(init.body);
      household.push(body);
      const answer = json(householdAnswerFor(body));
      return reports ? withReportedDefinitions(answer, url) : answer;
    }));
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    const region = await results();
    expect(await within(region).findByText("Personal impact can't be checked right now")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    expect(within(region).queryByText(HEADLINE)).not.toBeInTheDocument();
    expect(region.textContent).not.toMatch(/£\d/);
    expect(screen.queryByRole("region", { name: "Your household's results" })).not.toBeInTheDocument();
    // Asked again once the API reports them, it answers
    reports = true;
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    expect(await within(await results()).findByText(HEADLINE)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    expect(household.map((body) => body.include)).toEqual([[], [], ["by_policy", "sweep"]]);
  });

  // Review of 0608183, finding 2: published before the deploy that
  // registers it, or after a rollback past it
  it("lists a measure the running code doesn't register as unavailable, with the remove action", async () => {
    serve((body) => json({
      detail: [{ type: "value_error", loc: ["body", "policies"], msg: `Value error, Unknown measures: ${changedId}`, input: body.policies, ctx: { error: {} } }],
    }, 422));
    const remove = vi.fn();
    renderTab({ onRemoveUnavailable: remove });
    const region = await results();
    expect(await within(region).findByText("Personal impact is unavailable for the selected measures")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      `${changedName}: the running code cannot bind it: not a measure the running code registers`,
    ]);
    fireEvent.click(within(region).getByRole("button", { name: /^Remove .* from the selection$/ }));
    expect(remove).toHaveBeenCalledWith([changedId]);
  });
});
