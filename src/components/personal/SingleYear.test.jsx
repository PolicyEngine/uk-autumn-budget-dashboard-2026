import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "../PersonalImpactTab";
import { resetSavedWizard } from "../HouseholdCalculator";
import { clearHouseholdImpactCache } from "../../hooks/useHouseholdImpact";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../../test/householdFixture";
import { POLICIES_FOR_TEST } from "../../test/personalPolicies";

const HOUSEHOLD_API = "https://api.test/api/household-impact";

let household;

/** Answer the household API with `respond(body)`; any other URL is a 404. */
function serve(respond) {
  household = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      if (url === HOUSEHOLD_API) {
        const body = JSON.parse(init.body);
        household.push(body);
        return respond(body, init);
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

function renderTab(props = {}) {
  return render(
    <PersonalImpactTab
      selectedPolicies={POLICIES_FOR_TEST.map((policy) => policy.id)}
      policies={POLICIES_FOR_TEST}
      year={2029}
      {...props}
    />,
  );
}

// Straight from step 1: every answer has a default
function toResults() {
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
}

const HEADLINE = /The selected policies would/;

// The form's last step, headed "Results"
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
    expect(urls.every((url) => url === HOUSEHOLD_API)).toBe(true);
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

  it("says the change in one sentence, as Spring Statement does, with the salary used and what is not included", async () => {
    serve((body) => json(householdAnswerFor(body)));
    renderTab();
    toResults();
    const panel = await results();
    const banner = (await within(panel).findByText(HEADLINE)).closest(".single-year-banner");
    expect(banner).toHaveTextContent(
      "The selected policies would raise your household's annual net income by £3,765 (+5.8%) in 2029-30",
    );
    expect(banner).toHaveClass("is-gain");
    // The change is said once: not as a tile, not in the breakdown
    expect(panel.querySelector(".single-year-tiles")).toBeNull();
    expect(panel).toHaveTextContent(
      "Your salary in 2029-30: £34,192, and your partner's £12,822, grown from 2026",
    );
    expect(panel).toHaveTextContent("Not included in this view: Rail fares freeze.");
    // Renting (the wizard's default): the rent area the API used, once
    expect(panel).toHaveTextContent("Rent area: Central Greater Manchester, the region's default.");
    expect(panel.textContent.match(/Rent area/g)).toHaveLength(1);
    // No child of 16 or over: no note on who counts as a child
    expect(panel).not.toHaveTextContent("Who counts as a child");
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
    expect(screen.getByText(/Elements are before the earnings taper/)).toBeInTheDocument();

    // The top rows add up to net income, in every column
    const parse = (text) => Number(text.replace("−", "-").replace(/[£,+]/g, ""));
    const top = [...table.querySelectorAll(".programme-row.depth-0")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => parse(cell.textContent)),
    );
    const sums = [0, 1, 2].map((col) => top.reduce((acc, row) => acc + row[col], 0));
    expect(sums).toEqual([65371, 69136, 3765]);

    // How it is calculated: closed, under the table
    const method = screen.getByText("How is this calculated?").closest("details");
    expect(method).not.toHaveAttribute("open");
    expect(within(method).getByText(/Each policy's bar is that policy on its own/)).toBeInTheDocument();
  });

  it("marks you on the earnings chart, with the marginal rate in a closed expander", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { container } = renderTab();
    toResults();
    await screen.findByRole("heading", { name: /Net income across earnings/ });
    expect(container.querySelector(".earnings-you")).toHaveTextContent("You");
    const expander = screen.getByRole("button", { name: "Marginal tax rate across earnings" });
    expect(expander).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expander);
    expect(screen.getByText("At £34,192 your marginal tax rate is 68% before and 68% after.")).toBeInTheDocument();
    expect(screen.queryByText(/publication's order/)).not.toBeInTheDocument();
  });

  it("asks again for another year, and shows nothing without a policy", async () => {
    serve((body) => json(householdAnswerFor(body)));
    const { rerender } = renderTab();
    toResults();
    await screen.findByText(HEADLINE);
    rerender(
      <PersonalImpactTab selectedPolicies={POLICIES_FOR_TEST.map((p) => p.id)} policies={POLICIES_FOR_TEST} year={2030} />,
    );
    await waitFor(() => expect(household.some((body) => body.year === 2030)).toBe(true));
    rerender(<PersonalImpactTab selectedPolicies={[]} policies={POLICIES_FOR_TEST} year={2030} />);
    expect(screen.getByText(/Select at least one policy/)).toBeInTheDocument();
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
    expect(screen.getByText("The earnings chart is not available.")).toBeInTheDocument();
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
