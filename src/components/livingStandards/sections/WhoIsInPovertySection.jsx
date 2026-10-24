// Who is in poverty: one dot plot for every breakdown, from the headline
// start year, 2026-27 (grey), to the headline end year (teal), with an arrow
// for the direction, the values and a change chip per row, and a dashed
// line for the reference group (all people, or all children). Family type
// and tenure come from poverty_by_group; children by number of children and
// by lone parent or couple from child_poverty_by_family. Replaces the
// Poverty by group and Child poverty by family cards.

import { useState } from "react";
import LsCard from "../LsCard";
import { CHART_LOGO } from "../../../utils/chartLogo";
import PillSelect from "../../PillSelect";
import { niceAxis } from "../../../utils/livingStandards/baseline";
import {
  formatPct,
  fyDash,
  headlineStartYear,
  headlineYear,
  periodLabel,
  round1,
  signedChange,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";

const MEASURES = {
  relative_ahc: { label: "Relative poverty (AHC)", badge: "Relative (AHC)", noun: "relative poverty rate" },
  absolute_ahc: { label: "Absolute poverty (AHC)", badge: "Absolute (AHC)", noun: "absolute poverty rate" },
};

/** Row labels as plural, sentence-case nouns. */
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

/** Child breakdowns: row label and the sentence subject for each group. */
const CHILD_SPLITS = {
  children_number: {
    label: "Children by number of children",
    badge: "Children: number",
    groups: {
      one_child: ["1 child", "Children in one-child families"],
      two_children: ["2 children", "Children in two-child families"],
      three_plus_children: ["3 or more children", "Children in families with three or more children"],
    },
  },
  children_family: {
    label: "Children: lone parent vs couple",
    badge: "Children: family",
    groups: {
      lone_parent: ["Lone-parent families", "Children in lone-parent families"],
      couple: ["Couple families", "Children in couple families"],
    },
  },
};

// Region is in the file but not shown: it is not validated against official
// regional figures (Northern Ireland comes out far above DfC's own figure).
const GROUP_BREAKDOWNS = ["family_type", "tenure"];

const at = (series, year) => (series || []).find((d) => d.year === year)?.rate;
const pct = (v) => (v == null ? null : v * 100);

/** Breakdowns the data has, each with its rows, reference line and measures. */
function breakdownsFor(data, from, to) {
  const out = {};
  const pbg = data.poverty_by_group;
  for (const id of GROUP_BREAKDOWNS) {
    const b = pbg?.breakdowns?.[id];
    if (!b) continue;
    out[id] = {
      label: b.label,
      measures: ["relative_ahc"],
      reference: "All people",
      children: false,
      rows: () =>
        Object.entries(b.groups).map(([g, label]) => {
          const cell = (y) => {
            const c = b.cells[g]?.[y];
            return c && !c.suppressed ? pct(c.relative_ahc) : null;
          };
          const name = PLURAL[g] || label;
          return { id: g, label: name, subject: name, a: cell(from), z: cell(to) };
        }),
      all: () => pct(at(data.poverty?.projection?.relative_ahc?.all, to)),
    };
  }
  const cp = data.child_poverty_by_family;
  if (cp) {
    for (const [id, split] of Object.entries(CHILD_SPLITS)) {
      out[id] = {
        label: split.label,
        badge: split.badge,
        measures: Object.keys(cp.measures).filter((m) => MEASURES[m]),
        reference: "All children",
        children: true,
        rows: (m) =>
          Object.entries(split.groups).map(([g, [label, subject]]) => ({
            id: g,
            label,
            subject,
            a: pct(at(cp.projection?.[m]?.[g], from)),
            z: pct(at(cp.projection?.[m]?.[g], to)),
          })),
        all: (m) => pct(at(cp.projection?.[m]?.all, to)),
      };
    }
  }
  return out;
}

export default function WhoIsInPovertySection({ data }) {
  const pbg = data.poverty_by_group;
  const from = headlineStartYear(data) || pbg?.years?.[0];
  const to = headlineYear(data) || pbg?.years?.[pbg.years.length - 1];
  const breakdowns = breakdownsFor(data, from, to);
  const ids = Object.keys(breakdowns);
  const [breakdownChoice, setBreakdown] = useState(ids.includes("family_type") ? "family_type" : ids[0]);
  const [measureChoice, setMeasure] = useState("relative_ahc");
  if (!ids.length) return null;
  const breakdown = breakdowns[breakdownChoice] ? breakdownChoice : ids[0];
  const b = breakdowns[breakdown];
  // A measure the breakdown lacks falls back to its first
  const measure = b.measures.includes(measureChoice) ? measureChoice : b.measures[0];
  const m = MEASURES[measure];

  const rows = b
    .rows(measure)
    // From the one-decimal values shown, so "12.2% → 11.9%" reads −0.3pp
    .map((r) => ({ ...r, d: r.a != null && r.z != null ? round1(r.z) - round1(r.a) : null }))
    .filter((r) => r.a != null || r.z != null)
    .sort((x, y) => (y.z ?? y.a) - (x.z ?? x.a));
  const allValue = b.all(measure);
  const values = [...rows.flatMap((r) => [r.a, r.z]), allValue].filter((v) => v != null);
  const axis = niceAxis(Math.max(...values));
  const [x0, x1] = axis.domain;
  const scale = (v) => ((v - x0) / (x1 - x0)) * 100;
  const pos = (v) => `${scale(v)}%`;
  const flat = (d) => d == null || round1(d) === 0;

  const top = rows[0];
  const noun = b.children ? m.noun.replace(/ poverty rate$/, " child poverty rate") : m.noun;
  const lead = top && (
    <>
      {top.subject} have the highest {noun} ({formatPct(top.z ?? top.a)} in {fyDash(to)})
      {top.d != null && (
        <>
          ,{" "}
          <strong>
            {flat(top.d) ? "unchanged" : `${top.d > 0 ? "up" : "down"} ${signedChange(Math.abs(top.d), "pp").slice(1)}`}
          </strong>{" "}
          since {fyDash(from)}
        </>
      )}
      .
    </>
  );

  const groupNotes = b.children
    ? data.child_poverty_by_family?.notes || []
    : (pbg?.notes || []).filter((n) => !/^Region/.test(n));
  const about = b.children
    ? `Share of children in households below the poverty line, after housing costs. Relative: 60% of current median income; absolute: a fixed real-terms line. Families are benefit units; the dashed line is all children.`
    : `Share of people in households below 60% of current median income, after housing costs. Family type is at benefit-unit level; a pensioner family has someone at or above State Pension age. The dashed line is all people.`;

  return (
    <LsCard
      title="Who is in poverty"
      period={periodLabel(from, to)}
      about={about}
      summary={lead}
      notes={groupNotes}
      source={<PeSource />}
      sourceText={CSV_SOURCES.pe}
      download={{
        filename: `${measure}-by-${breakdown}`,
        image: false,
        csv: () =>
          seriesCsv({
            title: `${m.label}: ${b.label.toLowerCase()}`,
            units: b.children ? "% of children" : "% of people",
            source: CSV_SOURCES.pe,
            rows: [...rows, { label: b.reference, z: allValue }],
            xKey: "label",
            xLabel: b.label,
            xFormat: String,
            series: [
              { key: "a", name: fyDash(from) },
              { key: "z", name: fyDash(to) },
              { key: "d", name: "Change (pp)" },
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
            options={ids.map((id) => ({ value: id, label: breakdowns[id].label, badge: breakdowns[id].badge }))}
          />
          <PillSelect
            variant="light"
            prefix="Measure"
            name="Poverty measure"
            value={measure}
            onChange={setMeasure}
            options={Object.entries(MEASURES).map(([id, x]) => ({
              value: id,
              label: x.label,
              badge: x.badge,
              ...(b.measures.includes(id) ? {} : { disabled: true, title: "Not available for this breakdown" }),
            }))}
          />
        </>
      }
    >
      <div className="chart-plot">
        <div
          className="dot-plot ls-dot-plot"
          role="table"
          aria-label={`${m.label}: ${b.label.toLowerCase()}, ${fyDash(from)} and ${fyDash(to)}`}
        >
          <div className="dot-head" aria-hidden="true">
            <span className="dot-label" />
            <span className="dot-plot-area">
              {allValue != null && (
                <span className="dot-all-label" style={{ left: pos(allValue) }}>
                  {b.reference} {formatPct(allValue)}
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
            // A fall in poverty is good (teal); a rise is orange
            const tone = flat(r.d) ? "flat" : r.d < 0 ? "good" : "bad";
            return (
              <div className="dot-row" role="row" key={r.id}>
                <span className="dot-label" role="rowheader">
                  {r.label}
                </span>
                <span
                  className="dot-plot-area"
                  role="cell"
                  aria-label={`${fyDash(from)} ${r.a == null ? "n/a" : formatPct(r.a)}, ${fyDash(to)} ${r.z == null ? "n/a" : formatPct(r.z)}`}
                >
                  {axis.ticks.map((t) => (
                    <span key={t} className="dot-grid" style={{ left: pos(t) }} />
                  ))}
                  {allValue != null && <span className="dot-all" style={{ left: pos(allValue) }} />}
                  {both && (
                    <span className="dot-link" style={{ left: pos(lo), width: `${scale(hi) - scale(lo)}%` }}>
                      {scale(hi) - scale(lo) > 6 && <span className={`dot-arrow ${rising ? "right" : "left"}`} />}
                    </span>
                  )}
                  {r.a != null && (
                    <span className="dot from" style={{ left: pos(r.a) }} title={`${fyDash(from)}: ${formatPct(r.a)}`} />
                  )}
                  {r.z != null && (
                    <span className="dot to" style={{ left: pos(r.z) }} title={`${fyDash(to)}: ${formatPct(r.z)}`} />
                  )}
                </span>
                <span className="dot-values" role="cell">
                  <span className="dot-nums">
                    {r.a == null ? "–" : formatPct(r.a)} → {r.z == null ? "–" : formatPct(r.z)}
                  </span>
                  {r.d != null && <span className={`dot-chip ${tone}`}>{signedChange(r.d, "pp")}</span>}
                </span>
              </div>
            );
          })}
          <div className="dot-row dot-axis" aria-hidden="true">
            <span className="dot-label" />
            <span className="dot-plot-area">
              {axis.ticks.map((t) => (
                <span key={t} className="dot-tick" style={{ left: pos(t) }}>
                  {t}%
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
