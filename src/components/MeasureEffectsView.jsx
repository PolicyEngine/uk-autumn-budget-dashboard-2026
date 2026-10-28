// A by-year statistic (poverty rate, inequality) for a selection with no
// run of its own: each selected measure's own figure, never added up.
// "This year": one horizontal bar per measure for the selected year, from a
// zero line, sorted by size, the value at the bar's end; then every selected
// measure with no change that year, as a row with no bar, "No change" and
// why (noPovertyEffectReason), so no selected measure goes missing; a small
// non-zero change keeps its bar ("under 0.001pp"), coloured by direction and
// shaded by size, the largest darkest. "Year by year": a compact table of
// measures by years, each cell shaded by size and sign (for poverty, a fall
// in the gain colour and a rise in the loss colour; for inequality, one
// neutral colour, as a change in inequality is no household's gain or loss)
// with its value.

import { CHART_LOGO } from "../utils/chartLogo";
import MeasureRowLabel from "./MeasureRowLabel";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { CHART_COLOURS, fiscalYearTick, magnitudeColours, shortFiscalYearTick } from "../utils/chartTheme";

// An inequality bar: the neutral teal-slate (SummaryMetricChart's INEQUALITY_FILL)
const INEQUALITY_BAR = CHART_COLOURS.highlight;
import { useDisplayYears } from "../utils/displayYears";
import { noPovertyEffectReason } from "../utils/legendMembership";
import "./MeasureEffectsView.css";

export const EFFECT_VIEWS = [
  { value: "year", label: "This year" },
  { value: "years", label: "Year by year" },
];

const reads = (value, decimals) => value !== null && Number(Math.abs(value).toFixed(decimals)) !== 0;

/**
 * The selected year's bars: measures with a non-zero value (however small),
 * largest first, as {rows}; the rest (exactly 0, or not published that
 * year), in the selection's order, as {none}: each still a row, with no bar.
 * byMeasure: [{id, name, colour, points: [{year, value}]}]
 */
export function yearEffects(byMeasure, year) {
  const all = byMeasure.map((m) => ({ ...m, value: m.points.find((p) => p.year === year)?.value ?? null }));
  const moves = (m) => m.value !== null && m.value !== 0;
  const rows = all.filter(moves).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { rows, none: all.filter((m) => !moves(m)) };
}

/** Every measure, largest (in the selected year, then any) first; those
 * with no change in any year last, still a row. */
export function yearsEffects(byMeasure, year) {
  const size = (m) => Math.abs(m.points.find((p) => p.year === year)?.value ?? 0);
  const peak = (m) => Math.max(0, ...m.points.map((p) => Math.abs(p.value ?? 0)));
  const rows = [...byMeasure].sort((a, b) => size(b) - size(a) || peak(b) - peak(a));
  return { rows, none: [] };
}

export default function MeasureEffectsView({ byMeasure, metric, selectedYear, view, narrow, years: yearsProp }) {
  const shownYears = useDisplayYears();
  const years = yearsProp ?? shownYears;
  const { byId } = useMeasureCatalogue();
  // A change too small to read at the metric's precision says so, never "0"
  const smallest = 10 ** -metric.decimals;
  const signed = (v) => (reads(v, metric.decimals) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${metric.format(v)}` : `under ${metric.format(smallest)}`);
  const { rows, none } = view === "years" ? yearsEffects(byMeasure, selectedYear) : yearEffects(byMeasure, selectedYear);
  // Why a measure changes nothing this year, in the metric's terms
  const fallback = metric.choices === "inequality" ? "no change in inequality" : "no one crosses the poverty line";
  const reasonOf = (m) =>
    noPovertyEffectReason(byId?.get(m.id) ?? { id: m.id, name: m.fullName ?? m.name }, selectedYear, fallback);
  const max = Math.max(
    1e-12,
    ...rows.flatMap((m) => (view === "years" ? m.points.map((p) => Math.abs(p.value ?? 0)) : [Math.abs(m.value)])),
  );
  // Each bar by direction and size: for poverty, a fall in the gain ramp
  // and a rise in the loss ramp, the largest the darkest (magnitudeColours);
  // for inequality, one neutral colour (no household's gain or loss). The
  // measure's own colour is the dot by its name
  const barColours =
    view === "years"
      ? []
      : metric.choices === "inequality"
        ? rows.map(() => INEQUALITY_BAR)
        : magnitudeColours(rows.map((m) => m.value), { better: (v) => v < 0 });
  const anyNegative = view !== "years" && rows.some((m) => m.value < 0);
  const anyPositive = view !== "years" && rows.some((m) => m.value > 0);
  // The zero line: at the left when every bar goes one way, centred when both
  const zero = anyNegative && anyPositive ? 50 : anyNegative ? 100 : 0;
  const span = anyNegative && anyPositive ? 50 : 100;

  return (
    <div className="mev-wrap">
      {rows.length === 0 && none.length === 0 ? (
        <p className="mev-empty" role="status">
          None of the selected policies changes this on its own{view === "years" ? "" : ` in ${fiscalYearTick(selectedYear)}`}.
        </p>
      ) : view === "years" ? (
        <div className="mev-table-wrap">
          <table className={`mev-table${metric.choices === "inequality" ? " is-neutral" : ""}`}>
            <thead>
              <tr>
                <th scope="col">Policy</th>
                {years.map((year) => (
                  <th scope="col" key={year} className={year === selectedYear ? "is-selected" : undefined}>
                    {narrow ? shortFiscalYearTick(year) : fiscalYearTick(year)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    <MeasureRowLabel measure={byId?.get(m.id) ?? { id: m.id, name: m.fullName ?? m.name, color: m.colour }} name={m.name} colour={m.colour} />
                  </th>
                  {years.map((year) => {
                    const point = m.points.find((p) => p.year === year);
                    const v = point?.value ?? null;
                    const on = reads(v, metric.decimals);
                    const strength = on ? Math.round(15 + 70 * Math.min(1, Math.abs(v) / max)) : 0;
                    return (
                      <td
                        key={year}
                        className={`${on ? (v < 0 ? "is-fall" : "is-rise") : "is-none"}${year === selectedYear ? " is-selected" : ""}`}
                        style={on ? { "--mev-strength": `${strength}%` } : undefined}
                      >
                        {/* Withheld by the floor of survey households: said, never 0 */}
                        {v === null ? (point?.withheld ? "Not published" : "") : on ? signed(v) : "0"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mev-bars" role="table" aria-label={`${metric.title}, each policy on its own, ${fiscalYearTick(selectedYear)}`}>
          {rows.map((m, index) => {
            const width = (Math.abs(m.value) / max) * span;
            const left = m.value < 0 ? zero - width : zero;
            return (
              <div
                className={`mev-row row-band${index % 2 === 0 ? " is-banded" : ""}`}
                role="row"
                key={m.id}
                tabIndex={0}
                aria-label={`${m.fullName ?? m.name}: ${signed(m.value)}`}
              >
                <span className="mev-label" role="rowheader">
                  <MeasureRowLabel measure={byId?.get(m.id) ?? { id: m.id, name: m.fullName ?? m.name, color: m.colour }} name={m.name} colour={m.colour} />
                </span>
                <span className="mev-track" role="cell">
                  <span className="mev-zero" style={{ left: `${zero}%` }} />
                  <span className="mev-bar" style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%`, background: barColours[index] }} />
                </span>
                <span className="mev-value row-band-value" role="cell">
                  {signed(m.value)}
                </span>
              </div>
            );
          })}
          {none.map((m, index) => (
            <div
              className={`mev-row mev-row--none row-band${(rows.length + index) % 2 === 0 ? " is-banded" : ""}`}
              role="row"
              key={m.id}
              tabIndex={0}
              aria-label={`${m.fullName ?? m.name}: ${m.value === null ? "not published" : `no change, ${reasonOf(m)}`}`}
            >
              <span className="mev-label" role="rowheader">
                <MeasureRowLabel measure={byId?.get(m.id) ?? { id: m.id, name: m.fullName ?? m.name, color: m.colour }} name={m.name} colour={m.colour} />
              </span>
              {/* No bar: "No change" and why, across the track and value columns */}
              <span className="mev-value mev-value--none" role="cell">
                {/* Not published that year is never said to be no change */}
                <span className="mev-none-main row-band-value">{m.value === null ? "Not published" : "No change"}</span>
                {m.value !== null && <span className="mev-reason">{reasonOf(m)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mev-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}
