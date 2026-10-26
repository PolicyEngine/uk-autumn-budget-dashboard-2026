import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PolicyCards, {
  BUDGET_DAY_MONTH,
  TIMELINE_START_YEAR,
  TIMELINE_YEARS,
  durationLabel,
  timelineDescription,
  timelineSpan,
} from "./PolicyCards";
import { buildMeasureCatalogue } from "../utils/measureCatalogue";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { ALPHA, BETA, HELD, measureCatalogueFixture } from "../test/measureCatalogueFixture";

const catalogue = buildMeasureCatalogue(measureCatalogueFixture());
const detailsById = Object.fromEntries(POLICY_DETAILS.map((policy) => [policy.id, policy]));

// A published catalogue measure under a real id, so policyDetails.js adds
// its card text (#185 on #104: the catalogue decides membership and names)
// as the publication describes it (reforms.py's description, which the
// entry records as `writtenFor`)
const published = (id, name, direction = "cost") => ({
  ...catalogue.byId.get(ALPHA),
  id,
  seriesKey: `measure:${id}`,
  name,
  label: name,
  description: detailsById[id]?.writtenFor ?? catalogue.byId.get(ALPHA).description,
  direction,
});

describe("the card details (policyDetails.js)", () => {
  it("give every entry a card's fields, and a temporary one its end", () => {
    for (const policy of POLICY_DETAILS) {
      for (const field of ["summary", "starts", "type", "details", "inForce"]) {
        expect(policy[field], `${policy.id} ${field}`).toBeTruthy();
      }
      expect(Boolean(policy.ends), policy.id).toBe(Boolean(policy.inForce.to));
    }
  });

  it("never repeat a revenue figure in a card", () => {
    for (const policy of POLICY_DETAILS) {
      const text = [policy.summary, policy.details].join(" ");
      expect(text, policy.id).not.toMatch(/£[\d.]+ ?(bn|billion)/);
    }
  });
});

describe("PolicyCards", () => {
  it("shows selected verified catalogue measures grouped and coloured like the charts", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    for (const [heading, id] of [["Raises revenue", BETA], ["Costs revenue", ALPHA]]) {
      const group = screen.getByRole("region", { name: heading });
      const measure = catalogue.byId.get(id);
      expect(within(group).getAllByRole("listitem")).toHaveLength(1);
      expect(group).toHaveTextContent(measure.label);
      // No card details for a mock id: the published description
      expect(group).toHaveTextContent(measure.description);
      expect(within(group).getByRole("listitem").style.getPropertyValue("--policy-accent")).toBe(measure.color);
    }
    expect(screen.queryByText(catalogue.byId.get(HELD).label)).not.toBeInTheDocument();
  });

  it("keeps neutral measures in their own group and leaves empty groups out", () => {
    const policy = { ...catalogue.byId.get(ALPHA), direction: "neutral" };
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} />);
    expect(screen.getByRole("heading", { name: "Other measures" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Raises revenue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Costs revenue" })).not.toBeInTheDocument();
  });

  it("shows no cards when the catalogue has no verified measures", () => {
    const unverified = buildMeasureCatalogue({ manifest: measureCatalogueFixture().manifest });
    render(<PolicyCards policies={unverified.measures} selectedPolicies={[ALPHA, BETA, HELD]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("gives a card with details its type, start and end, with the modelling closed until opened", () => {
    const id = "warm_home_discount_top_up";
    render(<PolicyCards policies={[published(id, "Warm Home Discount top-up")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Warm Home Discount top-up" })).toBeTruthy();
    expect(card).toHaveTextContent("StartsWinter 2026-27");
    expect(card).toHaveTextContent("EndsAfter one winter");
    expect(card.querySelector(".policy-card-topline")).toHaveTextContent("BenefitTemporary");
    expect(within(card).getByRole("img", { name: /^In force from October 2026 to March 2027 \(one winter\)\.$/ })).toBeTruthy();
    const source = within(card).getByRole("link", { name: /Warm Home Discount/ });
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    const details = card.querySelector("details");
    expect(details.open).toBe(false);
    fireEvent.click(within(card).getByText("How it is modelled"));
    expect(details.open).toBe(true);
  });

  it("marks a lasting measure as continuing, with no end date", () => {
    const id = "badr_lifetime_limit_cut";
    render(<PolicyCards policies={[published(id, "Business Asset Disposal Relief restricted", "revenue")]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(card).not.toHaveTextContent("Ends");
    expect(card.querySelector(".policy-card-ends")).toBeEmptyDOMElement();
    expect(card).not.toHaveTextContent("Temporary");
    const timeline = within(card).getByRole("img", { name: "In force from April 2027; no end date." });
    expect(timeline).toHaveTextContent("Continues");
    expect(timeline).toHaveTextContent("Budget");
    expect(timeline.textContent).not.toMatch(/BudgetContinues/);
    expect(timeline.querySelectorAll(".ptl-span")).toHaveLength(1);
  });

  it("shows a measure changed since its details were written as published, with none of their figures or dates", () => {
    const id = "fuel_duty_rise_deferral";
    const changed = { ...published(id, "Fuel duty rises deferred"), description: "Fuel duty stays at 52.95p a litre until April 2028." };
    render(<PolicyCards policies={[changed]} selectedPolicies={[id]} />);
    const card = screen.getByRole("listitem");
    expect(card).toHaveTextContent(changed.description);
    expect(card).not.toHaveTextContent(detailsById[id].summary);
    // The rows stay, for the grid, but empty: as for a measure with no entry
    expect(card.querySelector(".policy-card-start")).toBeEmptyDOMElement();
    expect(card.querySelector(".policy-card-type")).toBeEmptyDOMElement();
    expect(card).not.toHaveTextContent("Temporary");
    expect(card.querySelector("details")).toBeNull();
    expect(screen.queryByRole("img", { name: /^In force/ })).toBeNull();
  });

  it("shows fuel duty's two-step restore as diamonds", () => {
    const id = "fuel_duty_rise_deferral";
    render(<PolicyCards policies={[published(id, "Fuel duty rises deferred")]} selectedPolicies={[id]} />);
    const timeline = screen.getByRole("img", { name: /^In force from January 2027;/ });
    expect(timeline.querySelectorAll(".ptl-diamond")).toHaveLength(2);
  });

  it("counts each group's measures", () => {
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA, BETA]} />);
    expect(screen.getByRole("region", { name: "Raises revenue" })).toHaveTextContent("1 measure");
    expect(screen.getByRole("region", { name: "Costs revenue" })).toHaveTextContent("1 measure");
  });

  it("asks for only that measure's effect", () => {
    const onShowEffect = vi.fn();
    render(<PolicyCards policies={catalogue.measures} selectedPolicies={[ALPHA]} onShowEffect={onShowEffect} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`effect of ${catalogue.byId.get(ALPHA).label}`) }));
    expect(onShowEffect).toHaveBeenCalledWith(ALPHA);
  });
});

describe("the in-force timeline", () => {
  it("places each measure's months on the charts' years", () => {
    const vat = timelineSpan({ from: "2026-12", to: "2027-05" });
    expect(vat.left).toBeCloseTo(8 / 72);
    expect(vat.width).toBeCloseTo(6 / 72);
    const freeze = timelineSpan({ from: `${TIMELINE_START_YEAR + TIMELINE_YEARS - 1}-04` });
    expect(freeze.left).toBeCloseTo(5 / 6);
    expect(freeze.left + freeze.width).toBeCloseTo(1);
  });

  it("counts a temporary measure's months", () => {
    expect(durationLabel(detailsById.road_fuel_vat_cut)).toBe("6 months");
    expect(durationLabel(detailsById.domestic_electricity_zero_vat)).toBe("18 months");
    expect(durationLabel(detailsById.warm_home_discount_top_up)).toBe("One winter");
    expect(timelineDescription(detailsById.road_fuel_vat_cut)).toBe(
      "In force from December 2026 to May 2027 (6 months).",
    );
  });

  it("puts Budget day in late October 2026", () => {
    expect(BUDGET_DAY_MONTH).toBeGreaterThan(6.8);
    expect(BUDGET_DAY_MONTH).toBeLessThan(7);
  });

  it("keeps every measure's span on the timeline", () => {
    for (const policy of POLICY_DETAILS) {
      const { left, width } = timelineSpan(policy.inForce);
      expect(left, policy.id).toBeGreaterThanOrEqual(0);
      expect(width, policy.id).toBeGreaterThan(0);
      expect(left + width, policy.id).toBeLessThanOrEqual(1);
    }
  });
});

describe("what changes (the model's parameters, policy_parameters.json)", () => {
  // The file the page serves, written by `uk-budget-data policy-table`
  const file = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"),
  );
  const alpha = catalogue.byId.get(ALPHA);
  const mock = {
    measures: {
      [ALPHA]: {
        description: alpha.description,
        rows: [
          {
            label: "A threshold",
            unit: "gbp",
            primary: true,
            points: [2026, 2027, 2028, 2029, 2030, 2031].map((year) => ({
              key: String(year),
              label: `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
              year,
              before: 1000,
              after: year >= 2027 ? 1200 : 1000,
            })),
            source: { before: { kind: "engine_parameter" }, after: { kind: "measure_parameter_change" } },
          },
          {
            label: "A rate",
            unit: "percent",
            primary: false,
            points: [{ key: "2027", label: "2027-28", year: 2027, before: 0.2, after: 0.15 }],
            source: { before: { kind: "engine_parameter" }, after: { kind: "modifier_constant" } },
          },
        ],
      },
    },
  };

  it("shows each card's table from the file, the years that differ first", () => {
    const id = "badr_lifetime_limit_cut";
    render(
      <PolicyCards
        policies={[published(id, "Business Asset Disposal Relief restricted", "revenue")]}
        selectedPolicies={[id]}
        parameterTables={file}
      />,
    );
    const table = screen.getByRole("region", { name: "What changes" });
    const lines = within(table).getAllByRole("row").filter((row) => row.classList.contains("pspec-line"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("2027-28 to 2031-32£1,000,000£500,000−£500,000");
    expect(lines[0].querySelector(".pspec-chip")).toHaveClass("is-loss");
  });

  it("puts a card's table between its summary and its timing", () => {
    render(<PolicyCards policies={[alpha]} selectedPolicies={[ALPHA]} parameterTables={mock} />);
    const card = screen.getByRole("listitem");
    const order = [...card.children].map((child) => child.className);
    expect(order.indexOf("policy-card-spec")).toBe(order.indexOf("policy-card-summary") + 1);
    expect(order.indexOf("policy-card-when")).toBe(order.indexOf("policy-card-spec") + 1);
  });

  it("collapses to the primary rows' changes, and opens every year and row", () => {
    render(<PolicyCards policies={[alpha]} selectedPolicies={[ALPHA]} parameterTables={mock} />);
    const table = screen.getByRole("region", { name: "What changes" });
    const lines = () => table.querySelectorAll(".pspec-line");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toHaveTextContent("2027-28 to 2031-32£1,000£1,200+£200");
    expect(lines()[0].querySelector(".pspec-chip")).toHaveClass("is-gain");
    expect(table).not.toHaveTextContent("A rate");
    const button = within(table).getByRole("button", { name: "Show all years" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(lines()).toHaveLength(7);
    expect(lines()[0]).toHaveTextContent("2026-27£1,000£1,000No change");
    expect(table).toHaveTextContent("A rate");
    expect(lines()[6]).toHaveTextContent("2027-2820%15%−5pp");
    expect(within(table).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("marks a hovered line's years on the timeline", () => {
    const policy = { ...alpha, inForce: { from: "2027-04" } };
    render(<PolicyCards policies={[policy]} selectedPolicies={[ALPHA]} parameterTables={mock} />);
    const card = screen.getByRole("listitem");
    expect(card.querySelector(".ptl-year-band")).toBeNull();
    fireEvent.mouseEnter(card.querySelector(".pspec-line"));
    const band = card.querySelector(".ptl-year-band");
    expect(parseFloat(band.style.left)).toBeCloseTo(100 / 6);
    expect(parseFloat(band.style.width)).toBeCloseTo(500 / 6);
    expect([...card.querySelectorAll(".policy-timeline-labels > .is-lit")].map((label) => label.textContent.trim().slice(0, 7))).toEqual([
      "2027-28", "2028-29", "2029-30", "2030-31", "2031-32",
    ]);
    fireEvent.mouseLeave(card.querySelector(".pspec-line"));
    expect(card.querySelector(".ptl-year-band")).toBeNull();
  });

  it("shows no table for a measure described otherwise than when the file was built, keeping the empty slot", () => {
    const changed = { ...alpha, description: "Changed on Budget day." };
    render(<PolicyCards policies={[changed]} selectedPolicies={[ALPHA]} parameterTables={mock} />);
    const card = screen.getByRole("listitem");
    expect(screen.queryByRole("region", { name: "What changes" })).toBeNull();
    expect(card.querySelector(".policy-card-spec")).toBeEmptyDOMElement();
  });

  it("shows no table without the file", () => {
    render(<PolicyCards policies={[alpha]} selectedPolicies={[ALPHA]} parameterTables={null} />);
    expect(screen.queryByRole("region", { name: "What changes" })).toBeNull();
  });
});
