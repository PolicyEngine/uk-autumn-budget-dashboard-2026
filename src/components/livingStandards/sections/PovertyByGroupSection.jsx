// Poverty and income by group: one breakdown at a time, a dot plot of
// 2025-26 (grey) to the headline end year (teal), with an arrow for the
// direction, the values and a change chip per row, and a dashed line for all
// people (poverty_by_group). Ported from PolicyEngine/uk-living-standards-outlook;
// text and figures unchanged.

import { useState } from "react";
import LsCard from "../LsCard";
import { CHART_LOGO } from "../../../utils/chartLogo";
import PillSelect from "../../PillSelect";
import { niceAxis, rangeAxis } from "../../../utils/livingStandards/baseline";
import { formatOneDp, formatPct, formatPounds, fyDash, headlineYear, round1 } from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const MEASURES = {
  relative_ahc: {
    label: "Relative poverty (AHC)",
    title: "Poverty",
    noun: "relative poverty rate",
    pick: (c) => (c.relative_ahc == null ? null : c.relative_ahc * 100),
    all: (data, year) => {
      const r = (data.poverty?.projection?.relative_ahc?.all || []).find((d) => d.year === year);
      return r?.rate == null ? null : r.rate * 100;
    },
    format: formatPct,
    tick: (v) => `${v}%`,
    // From the one-decimal values shown, so "12.2% → 11.9%" reads −0.3pp.
    change: (a, b) => round1(b) - round1(a),
    changeLabel: (d) => `${d > 0 ? "+" : "−"}${formatOneDp(Math.abs(d))}pp`,
    // A fall in poverty is good (teal); a rise is orange.
    good: (d) => d < 0,
  },
  median_equivalised_income_bhc: {
    label: "Median income (BHC, real)",
    title: "Median income",
    noun: "median income",
    pick: (c) => c.median_equivalised_income_bhc?.real ?? null,
    all: (data, year) =>
      (data.living_standards?.projection?.median_equivalised_income || []).find((d) => d.year === year)?.real ?? null,
    format: formatPounds,
    tick: (v) => formatPounds(v),
    change: (a, b) => ((b - a) / a) * 100,
    changeLabel: (d) => `${d > 0 ? "+" : "−"}${formatOneDp(Math.abs(d))}%`,
    good: (d) => d > 0,
  },
};

/** Row labels as plural, sentence-case nouns. Regions keep their names. */
const PLURAL = {
  owned_outright: "Outright owners",
  mortgage: "Mortgage holders",
  social_rent: "Social renters",
  private_rent: "Private renters",
  lone_parent: "Lone parents",
  couple_with_children: "Couples with children",
  single_no_children: "Single adults without children",
  couple_no_children: "Couples without children",
  pensioner: "Pensioner families",
};

// Not shown: the region estimates are not validated against official regional
// figures (Northern Ireland comes out far above DfC's own figure), and the
// disability split was dropped from outlook.json (review #1).
const HIDDEN = new Set(["region", "disability"]);

export default function PovertyByGroupSection({ data }) {
  const pbg = data.poverty_by_group;
  const breakdownIds = Object.keys(pbg.breakdowns).filter((id) => !HIDDEN.has(id));
  const [breakdown, setBreakdown] = useState(breakdownIds.includes("family_type") ? "family_type" : breakdownIds[0]);
  const [measure, setMeasure] = useState("relative_ahc");
  const m = MEASURES[measure];
  const from = pbg.years[0];
  const to = pbg.years.includes(headlineYear(data)) ? headlineYear(data) : pbg.years[pbg.years.length - 1];
  const b = pbg.breakdowns[breakdown];

  const rows = Object.entries(b.groups)
    .map(([id, label]) => {
      const cells = b.cells[id] || {};
      const a = cells[from] && !cells[from].suppressed ? m.pick(cells[from]) : null;
      const z = cells[to] && !cells[to].suppressed ? m.pick(cells[to]) : null;
      return { id, label: PLURAL[id] || label, a, z, d: a != null && z != null ? m.change(a, z) : null };
    })
    .filter((r) => r.a != null || r.z != null)
    .sort((x, y) => (y.z ?? y.a) - (x.z ?? x.a));
  const allValue = m.all(data, to);
  const values = [...rows.flatMap((r) => [r.a, r.z]), allValue].filter((v) => v != null);
  // Rates from zero; incomes over their range, so the dots spread out.
  const axis = measure === "relative_ahc" ? niceAxis(Math.max(...values)) : rangeAxis(values, { pad: 0.08 });
  const [x0, x1] = axis.domain;
  const pct = (v) => ((v - x0) / (x1 - x0)) * 100;
  const pos = (v) => `${pct(v)}%`;

  const top = rows[0];
  const verb = (d) => (Math.abs(d) < 0.05 ? "unchanged" : `${d > 0 ? "up" : "down"} ${m.changeLabel(d).slice(1)}`);
  const lead = top && (
    <>
      {top.label} have the highest {m.noun} ({m.format(top.z ?? top.a)} in {fyDash(to)})
      {top.d != null && (
        <>
          , <strong>{verb(top.d)}</strong> since {fyDash(from)}
        </>
      )}
      .
    </>
  );

  return (
    <LsCard
      title={`${m.title} by ${b.label.toLowerCase()}`}
      about={`Relative poverty: share of people below 60% of current median income after housing costs. Median income is in £ a year, adjusted for household size (shown for a couple with no children), in ${fyDash(data.meta.real_price_base)} prices. Family type is at benefit-unit level; a pensioner family has someone at or above State Pension age.`}
      summary={lead}
      source={<PeSource />}
      download={{
        filename: `${measure}-by-${breakdown}`,
        image: false,
        csv: () =>
          seriesCsv({
            title: `${m.label} by ${b.label.toLowerCase()}`,
            units:
              measure === "relative_ahc"
                ? "% of people"
                : `£ a year, adjusted for household size, ${fyDash(data.meta.real_price_base)} prices`,
            source: CSV_SOURCES.pe,
            rows,
            xKey: "label",
            xLabel: b.label,
            xFormat: String,
            series: [
              { key: "a", name: fyDash(from) },
              { key: "z", name: fyDash(to) },
            ],
          }),
      }}
      controls={
        <>
          <PillSelect
            variant="light"
            prefix="Breakdown"
            name="Breakdown"
            value={breakdown}
            onChange={setBreakdown}
            options={breakdownIds.map((id) => ({ value: id, label: pbg.breakdowns[id].label }))}
          />
          <PillSelect
            variant="light"
            prefix="Measure"
            name="Measure"
            value={measure}
            onChange={setMeasure}
            options={Object.entries(MEASURES).map(([id, x]) => ({ value: id, label: x.label }))}
          />
        </>
      }
    >
      <div className="chart-plot">
      <div
        className="dot-plot ls-dot-plot"
        role="table"
        aria-label={`${m.label} by ${b.label.toLowerCase()}, ${fyDash(from)} and ${fyDash(to)}`}
      >
        <div className="dot-head" aria-hidden="true">
          <span className="dot-label" />
          <span className="dot-plot-area">
            {allValue != null && (
              <span className="dot-all-label" style={{ left: pos(allValue) }}>
                All people {m.format(allValue)}
              </span>
            )}
          </span>
          <span className="dot-legend">
            <span>
              <i className="from" /> {fyDash(from)}
            </span>
            <span>
              <i className="to" /> {fyDash(to)}
            </span>
          </span>
        </div>
        {rows.map((r) => {
          const both = r.a != null && r.z != null;
          const lo = Math.min(r.a ?? r.z, r.z ?? r.a);
          const hi = Math.max(r.a ?? r.z, r.z ?? r.a);
          const rising = both && r.z > r.a;
          const tone = r.d == null || Math.abs(r.d) < 0.05 ? "flat" : m.good(r.d) ? "good" : "bad";
          return (
            <div className="dot-row" role="row" key={r.id}>
              <span className="dot-label" role="rowheader">
                {r.label}
              </span>
              <span className="dot-plot-area" role="cell" aria-label={`${fyDash(from)} ${r.a == null ? "n/a" : m.format(r.a)}, ${fyDash(to)} ${r.z == null ? "n/a" : m.format(r.z)}`}>
                {axis.ticks.map((t) => (
                  <span key={t} className="dot-grid" style={{ left: pos(t) }} />
                ))}
                {allValue != null && <span className="dot-all" style={{ left: pos(allValue) }} />}
                {both && (
                  <span className="dot-link" style={{ left: pos(lo), width: `${pct(hi) - pct(lo)}%` }}>
                    {pct(hi) - pct(lo) > 6 && <span className={`dot-arrow ${rising ? "right" : "left"}`} />}
                  </span>
                )}
                {r.a != null && <span className="dot from" style={{ left: pos(r.a) }} title={`${fyDash(from)}: ${m.format(r.a)}`} />}
                {r.z != null && <span className="dot to" style={{ left: pos(r.z) }} title={`${fyDash(to)}: ${m.format(r.z)}`} />}
              </span>
              <span className="dot-values" role="cell">
                <span className="dot-nums">
                  {r.a == null ? "–" : m.format(r.a)} → {r.z == null ? "–" : m.format(r.z)}
                </span>
                {r.d != null && <span className={`dot-chip ${tone}`}>{m.changeLabel(r.d)}</span>}
              </span>
            </div>
          );
        })}
        <div className="dot-row dot-axis" aria-hidden="true">
          <span className="dot-label" />
          <span className="dot-plot-area">
            {axis.ticks.map((t) => (
              <span key={t} className="dot-tick" style={{ left: pos(t) }}>
                {m.tick(t)}
              </span>
            ))}
          </span>
          <span className="dot-values" />
        </div>
      </div>
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </LsCard>
  );
}

PovertyByGroupSection.requires = "poverty_by_group";
