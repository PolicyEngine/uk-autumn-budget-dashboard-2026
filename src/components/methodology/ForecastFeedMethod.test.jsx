import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ForecastFeedMethod from "./ForecastFeedMethod";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";

const outlookWith = (note) => ({ meta: { headline_end_year_note: note, policyengine_uk: "2.151.0" }, forecast: { sections: [] } });
const stub = (data) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));

afterEach(() => {
  cleanup();
  clearOutlookCache();
  vi.unstubAllGlobals();
});

describe("How the forecast feeds the baseline", () => {
  it("stays neutral before the outlook provenance loads", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ForecastFeedMethod />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading.*forecast provenance/);
    expect(screen.queryByRole("link", { name: /March|October 2026/ })).toBeNull();
    expect(screen.queryByText(/past the OBR forecast/)).toBeNull();
  });

  it("does not label an unrecognised provenance record as March", async () => {
    stub(outlookWith(""));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/forecast provenance is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /March|October 2026/ })).toBeNull();
  });

  it("separates a new comparison-input readback from older population projections", async () => {
    const data = outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply.");
    data.forecast.model_inputs = {
      mode: "native", model_version: "2.174.1",
      parameter_changes: {
        "gov.economic_assumptions.yoy_growth.obr.per_capita.gdp": { values: { "2027-01-01.2027-12-31": 0.01 } },
        "gov.economic_assumptions.yoy_growth.obr.per_capita.non_labour_income": { values: { "2027-01-01.2027-12-31": 0.04 } },
      },
    };
    stub(data);
    render(<ForecastFeedMethod />);
    expect(await screen.findByText("Native comparison inputs in policyengine-uk 2.174.1")).toBeInTheDocument();
    expect(screen.getByText(/population projections still record policyengine-uk 2.151.0/)).toHaveTextContent(/Loading this readback does not update those projections/);
    expect(screen.queryByText(/pre-measures forecast uses the/)).toBeNull();
    expect(screen.getByText(/GDP per person/)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link").filter((link) => link.textContent.includes("gov.economic_assumptions"))) {
      expect(link.href).toContain("/blob/2.174.1/");
      expect(link.href).not.toContain("/blob/2.151.0/");
    }
    expect(screen.getByText(/published OBR comparison series retain their own sources and rounding/)).toBeInTheDocument();
    expect(screen.getByText(/OBR-published comparison series show growth in calendar-year averages/)).toHaveTextContent(/dated statutory inputs: September CPI and May–July earnings forecast adjustments/);
    expect(screen.queryByText(/Each rate is the growth in a calendar year/)).toBeNull();
  });

  it("keeps same-version projections comparison-only without their pre-Budget basis", async () => {
    const data = outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply.");
    data.meta.policyengine_uk = "2.174.1";
    data.forecast.model_inputs = { mode: "native", model_version: "2.174.1", parameter_changes: { "gov.economic_assumptions.statutory_uprating_inputs.forecast_gap.cpi_september": {} } };
    stub(data);
    render(<ForecastFeedMethod />);
    expect(await screen.findByText("Native comparison inputs in policyengine-uk 2.174.1")).toBeInTheDocument();
    expect(screen.getByText(/A matching pre-Budget policy and forecast basis is not recorded/)).toHaveTextContent(/Loading this readback does not update those projections/);
    expect(screen.queryByText(/pre-measures forecast uses the/)).toBeNull();
  });

  it("describes native projection inputs only with matching model and recorded policy basis", async () => {
    const data = outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply.");
    data.meta.policyengine_uk = "2.174.1";
    data.forecast.model_inputs = { mode: "native", model_version: "2.174.1", parameter_changes: { "gov.economic_assumptions.statutory_uprating_inputs.forecast_gap.cpi_september": {} } };
    // Synthetic UI metadata only. The real builder verifies the full
    // policy/forecast payload and content hash before writing an artifact.
    data.meta.policy_basis = {
      schema: "uk-budget-dashboard/outlook-policy-basis/v1",
      applied_before_data_load: true,
      sha256: "f".repeat(64),
      policy_record: { native_model_version: "2.174.1" },
      forecast: { model_version: "2.174.1", mode: "native" },
    };
    stub(data);
    render(<ForecastFeedMethod />);
    expect(await screen.findByText("Native economic inputs in policyengine-uk 2.174.1")).toBeInTheDocument();
    expect(screen.getByText(/pre-measures forecast uses the/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading this readback does not update/)).toBeNull();
  });

  it("names the October 2026 EFO and the year it ends in, once the outlook is run on it", async () => {
    stub(outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/last calendar year, 2031, covers 2031-32/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /October 2026/ })).toBeInTheDocument();
    expect(screen.queryByText(/past the OBR forecast/)).toBeNull();
  });

  // policyengine-uk 2.151.2 and later raise the minimum guarantee with the
  // earnings floor of the Social Security Administration Act 1992, section
  // 150A(2) (minimum_guarantee.yaml: uprating indices.earnings_uprating);
  // 2.151.0 raised it with CPI, which the page said until the engine moved
  it("says the Pension Credit guarantee rises with average earnings, not CPI", async () => {
    stub(outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/The Pension Credit guarantee rises with average earnings, the least the law allows\./)).toBeInTheDocument();
    expect(screen.queryByText(/raises the Pension Credit guarantee with CPI/)).toBeNull();
  });

  it("names the March 2026 EFO for an outlook run on it", async () => {
    stub(outlookWith("2031-32 is past the OBR March 2026 forecast, so it uses policyengine-uk's long-run assumptions (CPI 2.0%, earnings growth 3.3%)."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/CPI 2\.0%, earnings growth 3\.3%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /March 2026/ })).toBeInTheDocument();
  });
});
