// A by-year statistic (poverty rate, inequality) for a selection with no
// run of its own: each selected measure's own figure, never added up.
// "This year": one horizontal bar per measure for the selected year, from a
// zero line, sorted by size, the value at the bar's end; measures that read
// as zero are left out and counted. "Year by year": a compact table of
// measures by years, each cell shaded by size and sign (a fall in the
// gain colour, a rise in the loss colour) with its value.

import { CHART_LOGO } from "../utils/chartLogo";
import { fiscalYearTick, shortFiscalYearTick } from "../utils/chartTheme";
import { DISPLAY_YEARS } from "../utils/displayYears";
import "./MeasureEffectsView.css";

export const EFFECT_VIEWS = [
  { value: "year", label: "This year" },
  { value: "years", label: "Year by year" },
];

const reads = (value, decimals) => value !== null && Number(Math.abs(value).toFixed(decimals)) !== 0;

/**
 * The selected year's bars: measures with a value that reads as non-zero,
 * largest first, and how many were left out.
 * byMeasure: [{id, name, colour, points: [{year, value}]}]
 */
export function yearEffects(byMeasure, year, decimals) {
  const all = byMeasure.map((m) => ({ ...m, value: m.points.find((p) => p.year === year)?.value ?? null }));
  const shown = all.filter((m) => reads(m.value, decimals)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { rows: shown, hidden: all.length - shown.length };
}

/** Measures with any year reading as non-zero, largest (in the selected year, then any) first. */
export function yearsEffects(byMeasure, year, decimals) {
  const size = (m) => Math.abs(m.points.find((p) => p.year === year)?.value ?? 0);
  const peak = (m) => Math.max(0, ...m.points.map((p) => Math.abs(p.value ?? 0)));
  const shown = byMeasure
    .filter((m) => m.points.some((p) => reads(p.value, decimals)))
    .sort((a, b) => size(b) - size(a) || peak(b) - peak(a));
  return { rows: shown, hidden: byMeasure.length - shown.length };
}

export default function MeasureEffectsView({ byMeasure, metric, selectedYear, view, narrow }) {
  const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${metric.format(v)}`;
  const { rows, hidden } =
    view === "years" ? yearsEffects(byMeasure, selectedYear, metric.decimals) : yearEffects(byMeasure, selectedYear, metric.decimals);
  const max = Math.max(
    1e-12,
    ...rows.flatMap((m) => (view === "years" ? m.points.map((p) => Math.abs(p.value ?? 0)) : [Math.abs(m.value)])),
  );
  const anyNegative = view !== "years" && rows.some((m) => m.value < 0);
  const anyPositive = view !== "years" && rows.some((m) => m.value > 0);
  // The zero line: at the left when every bar goes one way, centred when both
  const zero = anyNegative && anyPositive ? 50 : anyNegative ? 100 : 0;
  const span = anyNegative && anyPositive ? 50 : 100;
  const hiddenLine =
    hidden > 0 ? `${hidden} ${hidden === 1 ? "measure" : "measures"} with no effect hidden` : null;

  return (
    <div className="mev-wrap">
      {rows.length === 0 ? (
        <p className="mev-empty" role="status">
          None of the selected measures changes this on its own{view === "years" ? "" : ` in ${fiscalYearTick(selectedYear)}`}.
        </p>
      ) : view === "years" ? (
        <div className="mev-table-wrap">
          <table className="mev-table">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                {DISPLAY_YEARS.map((year) => (
                  <th scope="col" key={year} className={year === selectedYear ? "is-selected" : undefined}>
                    {narrow ? shortFiscalYearTick(year) : fiscalYearTick(year)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <th scope="row" title={m.fullName ?? m.name}>
                    {m.name}
                  </th>
                  {DISPLAY_YEARS.map((year) => {
                    const v = m.points.find((p) => p.year === year)?.value ?? null;
                    const on = reads(v, metric.decimals);
                    const strength = on ? Math.round(15 + 70 * Math.min(1, Math.abs(v) / max)) : 0;
                    return (
                      <td
                        key={year}
                        className={`${on ? (v < 0 ? "is-fall" : "is-rise") : "is-none"}${year === selectedYear ? " is-selected" : ""}`}
                        style={on ? { "--mev-strength": `${strength}%` } : undefined}
                      >
                        {v === null ? "" : on ? signed(v) : "0"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mev-bars" role="table" aria-label={`${metric.title}, each measure on its own, ${fiscalYearTick(selectedYear)}`}>
          {rows.map((m) => {
            const width = (Math.abs(m.value) / max) * span;
            const left = m.value < 0 ? zero - width : zero;
            return (
              <div className="mev-row" role="row" key={m.id}>
                <span className="mev-label" role="rowheader" title={m.fullName ?? m.name}>
                  {m.name}
                </span>
                <span className="mev-track" role="cell">
                  <span className="mev-zero" style={{ left: `${zero}%` }} />
                  <span className="mev-bar" style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%`, background: m.colour }} />
                </span>
                <span className="mev-value" role="cell">
                  {signed(m.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {hiddenLine && <p className="mev-hidden">{hiddenLine}</p>}
      <div className="mev-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </div>
  );
}
