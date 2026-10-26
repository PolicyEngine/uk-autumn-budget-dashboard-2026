import { CHART_COLOURS } from "../../utils/chartTheme";

/**
 * Net income's layers across earnings, in stacking order outward from
 * zero: income and benefits above it, taxes and deductions below. Each
 * reads one or more of the API's net_income_parts (in £, taxes negative)
 * and takes the marginal rate card's colour for the same programme, so the
 * two cards read as a pair. Child Benefit and its charge share one colour,
 * the benefit above zero and the charge below, and one legend key.
 */
export const NET_LAYERS = [
  {
    key: "market_income",
    label: "Earnings and other income",
    from: ["employment_income", "other_income"],
    color: CHART_COLOURS.marketIncome,
  },
  { key: "universal_credit", label: "Universal Credit", color: CHART_COLOURS.mtrUniversalCredit },
  { key: "child_benefit", label: "Child Benefit", color: CHART_COLOURS.mtrChildBenefit },
  { key: "other_benefits", label: "Other benefits", color: CHART_COLOURS.mtrOtherBenefits },
  { key: "income_tax", label: "Income tax", color: CHART_COLOURS.mtrIncomeTax },
  { key: "national_insurance", label: "National Insurance", color: CHART_COLOURS.mtrNationalInsurance },
  { key: "student_loan", label: "Student loan", color: CHART_COLOURS.mtrStudentLoan },
  { key: "council_tax", label: "Council Tax", color: CHART_COLOURS.netCouncilTax },
  {
    key: "child_benefit_charge",
    label: "Child Benefit charge",
    color: CHART_COLOURS.mtrChildBenefit,
    legendKey: "child_benefit",
  },
  {
    key: "pension_contributions",
    label: "Pension contributions",
    color: CHART_COLOURS.pensionContributions,
  },
  { key: "other_taxes", label: "Other taxes", color: CHART_COLOURS.mtrOther },
];

// A layer under £1 at every point is left off the chart and legend
const NEGLIGIBLE = 1;

/** A layer's £ at one point of the API's parts. */
const layerValue = (layer, point) => (layer.from ?? [layer.key]).reduce((sum, name) => sum + (point?.[name] ?? 0), 0);

/**
 * The rows to draw for one view: per sweep point, each layer's £ (`before`
 * or `after` the policies, or the `change` between them) and the total
 * (net income, or its change).
 *
 * @param {Array<{income: number, before: number, after: number, change: number}>} points
 * @param {{before: Object[], after: Object[]}} netParts - normaliseHouseholdImpact's sweep.netParts
 * @param {"before"|"after"|"change"} view
 */
export function layerRows(points, netParts, view) {
  return points.map((point, i) => {
    const row = { income: point.income, total: view === "change" ? point.change : point[view] };
    NET_LAYERS.forEach((layer) => {
      const before = layerValue(layer, netParts.before[i]);
      const after = layerValue(layer, netParts.after[i]);
      row[layer.key] = view === "change" ? after - before : view === "before" ? before : after;
    });
    return row;
  });
}

/** The layers some row uses, in stacking order. */
export function layersInUse(rows) {
  return NET_LAYERS.filter((layer) => rows.some((row) => Math.abs(row[layer.key] ?? 0) >= NEGLIGIBLE));
}

/**
 * Each layer's band at each row, stacked outward from zero in layer order:
 * a positive value above what is already above zero, a negative one below
 * what is already below. {key: [{lo, hi}]}, and the stack's reach (for the
 * axis).
 */
export function stackLayers(rows, layers) {
  const bands = Object.fromEntries(layers.map((layer) => [layer.key, []]));
  let top = 0;
  let bottom = 0;
  rows.forEach((row) => {
    let up = 0;
    let down = 0;
    layers.forEach((layer) => {
      const value = row[layer.key] ?? 0;
      if (value >= 0) {
        bands[layer.key].push({ lo: up, hi: up + value });
        up += value;
      } else {
        bands[layer.key].push({ lo: down + value, hi: down });
        down += value;
      }
    });
    top = Math.max(top, up, row.total);
    bottom = Math.min(bottom, down, row.total);
  });
  return { bands, top, bottom };
}

/**
 * The legend's keys for the layers drawn: one per colour, Child Benefit
 * and its charge as one key when both are drawn.
 */
export function layerLegendItems(layers) {
  const keys = new Set(layers.map((layer) => layer.key));
  const both = keys.has("child_benefit") && keys.has("child_benefit_charge");
  const items = [];
  layers.forEach((layer) => {
    if (both && layer.key === "child_benefit_charge") return;
    if (both && layer.key === "child_benefit") {
      items.push({
        label: "Child Benefit and its charge",
        color: layer.color,
        info: "Child Benefit is drawn above zero and the High Income Child Benefit Charge, which takes it back between £60,000 and £80,000 of income, below zero.",
      });
      return;
    }
    items.push({ label: layer.label, color: layer.color });
  });
  return items;
}
