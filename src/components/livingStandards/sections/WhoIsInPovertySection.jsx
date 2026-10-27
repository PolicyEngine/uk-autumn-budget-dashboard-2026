// Who is in poverty: one bar per group for the end year (teal, its value at
// the bar's end), a dark tick at the start year's value, a change chip per
// row, and a dashed line for the reference group (all people, or all
// children), labelled once above the rows. Changes here are tenths of a
// point, so a bar with a tick reads where two overlapping dots did not. Family type
// and tenure come from poverty_by_group; children by number of children and
// by lone parent or couple from child_poverty_by_family. Replaces the
// Poverty by group and Child poverty by family cards.

import { useRef, useState } from "react";
import LsCard from "../LsCard";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../../FloatingTooltip";
import { CHART_COLOURS } from "../../../utils/chartTheme";
import { CHART_LOGO } from "../../../utils/chartLogo";
import { povertyMeasureOptions } from "../PovertyMeasurePills";
import ControlBar from "../../ControlBar";
import { yearsOption } from "../controlOptions";
import { defaultRange, useYearRange } from "../../../utils/livingStandards/yearRange";
import { usePovertyMeasure } from "../../../utils/livingStandards/povertyMeasure";
import { niceAxis } from "../../../utils/livingStandards/baseline";
import {
  formatPct,
  fyDash,
  periodLabel,
  round1,
  signedChange,
} from "../../../utils/livingStandards/outlook";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";
import { METHOD_ANCHORS } from "../../methodology/anchors";

const MEASURES = {
  relative_ahc: { label: "Relative poverty (AHC)", badge: "Relative (AHC)", noun: "relative poverty rate" },
  absolute_ahc: { label: "Absolute poverty (AHC)", badge: "Absolute (AHC)", noun: "absolute poverty rate" },
  relative_bhc: { label: "Relative poverty (BHC)", badge: "Relative (BHC)", noun: "relative poverty rate (BHC)" },
  absolute_bhc: { label: "Absolute poverty (BHC)", badge: "Absolute (BHC)", noun: "absolute poverty rate (BHC)" },
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
      measures: Object.keys(pbg.measures ?? {}).filter((m) => MEASURES[m]),
      reference: "All people",
      children: false,
      rows: (m) =>
        Object.entries(b.groups).map(([g, label]) => {
          const cell = (y) => {
            const c = b.cells[g]?.[y];
            return c && !c.suppressed ? pct(c[m]) : null;
          };
          const name = PLURAL[g] || label;
          return { id: g, label: name, subject: name, a: cell(from), z: cell(to) };
        }),
      all: (m) => pct(at(data.poverty?.projection?.[m]?.all, to)),
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
  const years = pbg?.years ?? [];
  // The two years compared: chosen by the reader, 2027-28 to 2031-32 at first
  const [[from, to], setRange] = useYearRange(years, defaultRange(years));
  const breakdowns = breakdownsFor(data, from, to);
  const ids = Object.keys(breakdowns);
  const [breakdownChoice, setBreakdown] = useState(ids.includes("family_type") ? "family_type" : ids[0]);
  // One measure for the sub-tab's tiles and both cards (usePovertyMeasure);
  // a breakdown without it (the child ones) falls back to its first
  const [measureChoice, setMeasure] = usePovertyMeasure();
  const plotRef = useRef(null);
  // Cleared when the breakdown or measure changes, so it never shows a row
  // that has gone
  const { tip, handlers } = useFloatingTooltip(plotRef, `${breakdownChoice}-${measureChoice}`);
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
  // One plain sentence on the card; the poverty line and family types are
  // defined in About this chart
  const change =
    top?.d == null
      ? ""
      : flat(top.d)
        ? `, the same as in ${fyDash(from)}`
        : `, ${top.d > 0 ? "up" : "down"} ${Math.abs(round1(top.d)).toFixed(1)} points since ${fyDash(from)}`;
  const short = top && (
    <>
      Under current law, {top.subject.toLowerCase()} have the highest {noun}: <strong>{formatPct(top.z ?? top.a)}</strong> in{" "}
      {fyDash(to)}
      {change}.
    </>
  );

  const groupNotes = b.children
    ? data.child_poverty_by_family?.notes || []
    : (pbg?.notes || []).filter((n) => !/^Region/.test(n));
  // The poverty line and housing costs of the measure shown
  const line = measure.startsWith("absolute")
    ? "a fixed line (60% of the 2024-25 median income) held constant in real terms"
    : "60% of current median income";
  const housing = measure.endsWith("ahc") ? "after housing costs" : "before housing costs";
  const about = b.children
    ? `Share of children in households below ${line}, ${housing}. Families are benefit units; the dashed line is all children.`
    : `Share of people in households below ${line}, ${housing}. A pensioner family is a benefit unit with someone at or above State Pension age. The dashed line is all people.`;

  return (
    <LsCard
      title="Who is in poverty"
      icon="users"
      period={periodLabel(from, to)}
      about={about}
      summary={short}
      notes={groupNotes}
      source={<PeSource />}
      info={{
        how: [
          `The line is ${line}, ${housing}.`,
          b.children
            ? "Families are benefit units; the dashed line is all children."
            : "Family type is at benefit-unit level; a pensioner family has someone at or above State Pension age.",
        ],
        method: { anchor: METHOD_ANCHORS.lsNotes, label: "Notes on the poverty data" },
      }}
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
        // The card's one Options pill: the years compared, the breakdown,
        // then the poverty measure
        <ControlBar
          name="Who is in poverty"
          options={[
            yearsOption(years, [from, to], setRange),
            {
              label: "Breakdown",
              value: breakdown,
              onChange: setBreakdown,
              options: ids.map((id) => ({ value: id, label: breakdowns[id].label, summary: breakdowns[id].badge ?? breakdowns[id].label })),
            },
            ...povertyMeasureOptions(measure, b.measures, setMeasure),
          ]}
        />
      }
    >
      <div className="chart-plot">
        <div
          ref={plotRef}
          style={{ position: "relative" }}
          className="ls-bars"
          role="table"
          aria-label={`${m.label}: ${b.label.toLowerCase()}, ${fyDash(to)}, with ${fyDash(from)} marked`}
        >
          {/* The reference group's value, said once above the rows */}
          {allValue != null && (
            <div className="ls-bar-row ls-bar-head" aria-hidden="true">
              <span className="ls-bar-label" />
              <span className="ls-bar-area">
                <span className="ls-bar-all-label" style={{ left: pos(allValue) }}>
                  {b.reference} {formatPct(allValue)}
                </span>
              </span>
              <span className="ls-bar-chip-cell" />
            </div>
          )}
          {rows.map((r) => {
            // A fall in poverty is good (teal); a rise is orange
            const tone = flat(r.d) ? "flat" : r.d < 0 ? "good" : "bad";
            const end = r.z ?? r.a;
            // The value sits past the bar's end, or inside it near the axis end
            const inside = scale(end) > 82;
            return (
              <div className="ls-bar-row" role="row" key={r.id}>
                <span className="ls-bar-label" role="rowheader">
                  {r.label}
                </span>
                <span
                  className="ls-bar-area has-tooltip"
                  role="cell"
                  tabIndex={0}
                  aria-label={`${fyDash(to)} ${r.z == null ? "n/a" : formatPct(r.z)}, ${fyDash(from)} ${r.a == null ? "n/a" : formatPct(r.a)}`}
                  {...handlers(
                    r.id,
                    <TooltipRows
                      label={`${r.label}: ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`}
                      rows={[
                        {
                          key: "to",
                          name: fyDash(to),
                          text: r.z == null ? "n/a" : formatPct(r.z),
                          color: CHART_COLOURS.after,
                        },
                        {
                          key: "from",
                          name: fyDash(from),
                          text: r.a == null ? "n/a" : formatPct(r.a),
                          color: CHART_COLOURS.before,
                        },
                        ...(r.d == null
                          ? []
                          : [
                              {
                                key: "change",
                                name: "Change",
                                text: flat(r.d) ? "No change" : signedChange(r.d, "pp"),
                                color: flat(r.d)
                                  ? CHART_COLOURS.noChange
                                  : r.d < 0
                                    ? CHART_COLOURS.gain
                                    : CHART_COLOURS.loss,
                              },
                            ]),
                        ...(allValue == null
                          ? []
                          : [
                              {
                                key: "all",
                                name: `${b.reference}, ${fyDash(to)}`,
                                text: formatPct(allValue),
                                color: CHART_COLOURS.reference,
                              },
                            ]),
                      ]}
                    />,
                  )}
                >
                  {axis.ticks.map((t) => (
                    <span key={t} className="ls-bar-grid" style={{ left: pos(t) }} />
                  ))}
                  {end != null && (
                    <span className="ls-bar-fill" style={{ width: pos(end) }}>
                      <span className={`ls-bar-value ${inside ? "inside" : ""}`}>{formatPct(end)}</span>
                    </span>
                  )}
                  {allValue != null && <span className="ls-bar-all" style={{ left: pos(allValue) }} />}
                  {r.a != null && r.z != null && <span className="ls-bar-start" style={{ left: pos(r.a) }} />}
                </span>
                <span className="ls-bar-chip-cell" role="cell">
                  {r.d != null && <span className={`dot-chip ${tone}`}>{flat(r.d) ? "no change" : signedChange(r.d, "pp")}</span>}
                </span>
              </div>
            );
          })}
          <div className="ls-bar-row ls-bar-axis" aria-hidden="true">
            <span className="ls-bar-label" />
            <span className="ls-bar-area">
              {axis.ticks.map((t) => (
                <span key={t} className="ls-bar-tick" style={{ left: pos(t) }}>
                  {t}%
                </span>
              ))}
            </span>
            <span className="ls-bar-chip-cell" />
          </div>
          <FloatingTooltip tip={tip} />
        </div>
      </div>
      <div className="chart-legend">
        <span className="dot-legend ls-bar-legend">
          <span>
            <i className="ls-key-bar" /> {fyDash(to)} rate
          </span>
          <span>
            <i className="ls-key-start" /> {fyDash(from)}
          </span>
          {allValue != null && (
            <span>
              <i className="ls-key-all" /> {b.reference.toLowerCase()}
            </span>
          )}
        </span>
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </LsCard>
  );
}
