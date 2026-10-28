// Change in poverty by group (was "Who is in poverty"): a dumbbell per group, as the official costings chart
// and Effect of each policy draw theirs (MeasureDumbbell.css): a filled dot
// for the end year, a hollow ring for the start year, a thin neutral line
// between them, each value beside its mark, the change chip on the right,
// every second row on a faint band, and a dashed line for the reference
// group (all people, or all children), labelled once above the rows. Family
// type and tenure come from poverty_by_group; children by number of
// children and by lone parent or couple from child_poverty_by_family.
// Replaces the Poverty by group and Child poverty by family cards.
import { useRef, useState } from "react";
import LsCard from "../LsCard";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "../../FloatingTooltip";
import { CHART_COLOURS, fitTicks } from "../../../utils/chartTheme";
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
import useElementWidth from "../../../hooks/useElementWidth";
import { seriesCsv } from "../../../utils/livingStandards/csv";
import { CSV_SOURCES, PeSource } from "../sources";
import { METHOD_ANCHORS } from "../../methodology/anchors";
import "../../youngPeople/MeasureDumbbell.css";

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
  // People in the family, not the Pensioners tile's people over State
  // Pension age: the two rates can differ
  pensioner: "People in pensioner families",
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

// Value labels: their width without a canvas (12px tabular figures), and
// their distance from a mark's centre (the ring's radius and a gap)
const labelWidth = (text) => text.length * 6.8;
const LABEL_GAP = 11;
// A label may run this far past the plot, into the column gap
const LABEL_SPILL = 8;

/**
 * A row's value labels, as the official costings chart places them: each
 * on the outer side of its mark (the lower value to the left, the higher
 * to the right), one label where the two read the same, and both on one
 * side ("21.4% → 21.9%") where an outer side has no room. `scale` maps a
 * value to % of the plot; `width` is the plot's width in px (0 until
 * measured: everything fits).
 */
export function valueLabels(r, scale, width) {
  const px = (v) => (scale(v) / 100) * width;
  const fitsRight = (v, text) => !width || px(v) + LABEL_GAP + labelWidth(text) <= width + LABEL_SPILL;
  const fitsLeft = (v, text) => !width || px(v) - LABEL_GAP - labelWidth(text) >= -LABEL_SPILL;
  const one = (v, text, kind) =>
    fitsRight(v, text) ? { key: kind, at: v, side: "right", kind, text } : { key: kind, at: v, side: "left", kind, text };
  if (r.a == null && r.z == null) return [];
  if (r.a == null) return [one(r.z, formatPct(r.z), "to")];
  if (r.z == null) return [one(r.a, formatPct(r.a), "from")];
  const from = formatPct(r.a);
  const to = formatPct(r.z);
  if (from === to) return [one(r.z, to, "to")];
  const rise = r.z > r.a;
  const [lo, hi] = rise ? [r.a, r.z] : [r.z, r.a];
  const [loText, hiText] = rise ? [from, to] : [to, from];
  if (fitsLeft(lo, loText) && fitsRight(hi, hiText)) {
    return [
      { key: "lo", at: lo, side: "left", kind: rise ? "from" : "to", text: loText },
      { key: "hi", at: hi, side: "right", kind: rise ? "to" : "from", text: hiText },
    ];
  }
  const both = `${from} → ${to}`;
  return [fitsRight(hi, both) ? { key: "both", at: hi, side: "right", kind: "both", text: both } : { key: "both", at: lo, side: "left", kind: "both", text: both }];
}

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

// A title for what it shows, the change (Pavel's review, PM1); the years are
// in the card's period and sentence, as on every card here
export const TITLE = "Change in poverty by group";
export const FELL_BACK_NOTE = "Child breakdowns are published after housing costs only; showing AHC.";

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
  // The plot's width, so a value label that would run out of it moves
  const [plotWidthRef, plotWidth] = useElementWidth();
  // Cleared when the breakdown, the measure drawn or the years change, so it
  // never shows a row or figure that has gone (Pavel's review, PM3)
  const { tip, handlers } = useFloatingTooltip(plotRef, `${breakdownChoice}-${measureChoice}-${from}-${to}`);
  if (!ids.length) return null;
  const breakdown = breakdowns[breakdownChoice] ? breakdownChoice : ids[0];
  const b = breakdowns[breakdown];
  // A measure the breakdown lacks falls back to its first
  const measure = b.measures.includes(measureChoice) ? measureChoice : b.measures[0];
  const m = MEASURES[measure];
  // The reader chose a measure this breakdown lacks (before housing costs on
  // a child breakdown): said on the card, and the pill shows the one drawn
  // (Pavel's review, PM2)
  const fellBack = measure !== measureChoice;

  const rows = b
    .rows(measure)
    // From the one-decimal values shown, so "12.2% → 11.9%" reads −0.3pp
    .map((r) => ({ ...r, d: r.a != null && r.z != null ? round1(r.z) - round1(r.a) : null }))
    .filter((r) => r.a != null || r.z != null)
    .sort((x, y) => (y.z ?? y.a) - (x.z ?? x.a));
  const allValue = b.all(measure);
  const values = [...rows.flatMap((r) => [r.a, r.z]), allValue].filter((v) => v != null);
  const roundAxis = niceAxis(Math.max(...values));
  // Only the ticks whose labels fit the measured plot (always 0%)
  const axis = { ...roundAxis, ticks: fitTicks(roundAxis.ticks, roundAxis.domain, plotWidth, (t) => `${t}%`) };
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
      title={TITLE}
      icon="users"
      period={periodLabel(from, to)}
      about={about}
      summary={
        fellBack ? (
          <>
            {short} <span className="ls-fell-back">{FELL_BACK_NOTE}</span>
          </>
        ) : (
          short
        )
      }
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
          name={TITLE}
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
          className="measure-dumbbell ls-poverty-dumbbell"
          role="table"
          aria-label={`${m.label}: ${b.label.toLowerCase()}, ${fyDash(to)} beside ${fyDash(from)}`}
        >
          {/* The reference group's value, said once above the rows, and the
              change column's heading */}
          <div className="measure-dumbbell-row ls-dumbbell-head" aria-hidden="true">
            <span className="measure-dumbbell-name" />
            <span className="measure-dumbbell-plot">
              {allValue != null && (
                <span className="ls-dumbbell-all-label" style={{ left: pos(allValue) }}>
                  {b.reference} {formatPct(allValue)}
                </span>
              )}
            </span>
            <span className="measure-dumbbell-values">Change</span>
          </div>
          {rows.map((r, index) => {
            // A fall in poverty is good (the gain colour); a rise is the loss colour
            const tone = flat(r.d) ? "" : r.d < 0 ? "more" : "less";
            const labels = valueLabels(r, scale, plotWidth);
            return (
              <div
                key={r.id}
                className={`measure-dumbbell-row row-band has-tooltip${index % 2 === 0 ? " is-banded" : ""}`}
                role="row"
                tabIndex={0}
                aria-label={`${r.label}: ${fyDash(to)} ${r.z == null ? "n/a" : formatPct(r.z)}, ${fyDash(from)} ${r.a == null ? "n/a" : formatPct(r.a)}`}
                {...handlers(
                  r.id,
                  <TooltipRows
                    label={`${r.label}: ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`}
                    rows={[
                      {
                        key: "to",
                        name: fyDash(to),
                        text: r.z == null ? "n/a" : formatPct(r.z),
                        color: CHART_COLOURS.gain,
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
                              color: flat(r.d) ? CHART_COLOURS.noChange : r.d < 0 ? CHART_COLOURS.gain : CHART_COLOURS.loss,
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
                <span className="measure-dumbbell-name" role="rowheader">
                  <span className="measure-dumbbell-label">{r.label}</span>
                </span>
                <span className="measure-dumbbell-plot" role="cell">
                  {axis.ticks.map((t) => (
                    <span key={t} className={`measure-dumbbell-grid${t === 0 ? " is-zero" : ""}`} style={{ left: pos(t) }} />
                  ))}
                  {allValue != null && <span className="ls-dumbbell-all" style={{ left: pos(allValue) }} />}
                  {r.a != null && r.z != null && !flat(r.d) && (
                    <span
                      className="measure-dumbbell-link"
                      style={{ left: pos(Math.min(r.a, r.z)), width: `${scale(Math.max(r.a, r.z)) - scale(Math.min(r.a, r.z))}%` }}
                    />
                  )}
                  {r.a != null && <span className="measure-dumbbell-ring" style={{ left: pos(r.a) }} />}
                  {r.z != null && <span className="measure-dumbbell-dot" style={{ left: pos(r.z) }} />}
                  {labels.map((l) => (
                    <span key={l.key} className={`ls-dumbbell-value ${l.side} ${l.kind}`} style={{ left: pos(l.at) }}>
                      {l.text}
                    </span>
                  ))}
                </span>
                <span className="measure-dumbbell-values" role="cell">
                  {r.d != null && <span className={`measure-dumbbell-gap ${tone}`}>{flat(r.d) ? "no change" : signedChange(r.d, "pp")}</span>}
                </span>
              </div>
            );
          })}
          {/* The ticks, then the unit, as the dumbbell's own axis */}
          <div className="measure-dumbbell-axis" aria-hidden="true">
            <div className="measure-dumbbell-row">
              <span className="measure-dumbbell-name" />
              <span className="measure-dumbbell-plot" ref={plotWidthRef}>
                {axis.ticks.map((t) => (
                  <span key={t} className="measure-dumbbell-tick" style={{ left: pos(t) }}>
                    {t}%
                  </span>
                ))}
              </span>
              <span className="measure-dumbbell-values" />
            </div>
            <p className="measure-dumbbell-unit">{b.children ? "Share of children in poverty" : "Share of people in poverty"}</p>
          </div>
          <FloatingTooltip tip={tip} />
        </div>
      </div>
      <div className="chart-legend">
        <span className="measure-dumbbell-legend">
          <span>
            <i className="dot" /> {fyDash(to)}
          </span>
          <span>
            <i className="ring" /> {fyDash(from)}
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
