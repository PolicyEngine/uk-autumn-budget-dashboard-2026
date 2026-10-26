// The forecast vintages view: for each of the OBR's headline measures,
// the OBR's forecasts since June 2010 beside the ONS outturn, each earlier
// forecast drawn from its launch period and the newest from the latest
// outturn it reaches. It reads
// public/data/obr_forecast_vintages.json (utils/forecastVintages/load.js),
// which holds only the OBR's forecasts and the ONS's outturn: no
// PolicyEngine figure is shown here. A file that cannot be read, or that
// holds a forecast after the newest this view shows, leaves the view
// unavailable; it never shows zero in its place.
//
// It is self-contained, so it can be a view of its own (ForecastVintagesTab,
// ?tab=forecasts) or a sub-tab of another view: it loads its own file, keeps
// the measure shown in ?variable= (never ?sub=, which belongs to the view
// that holds it), and takes the link to the forecast behind the living
// standards baseline from whatever holds it.

import { useEffect, useMemo, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import ViewSwitch from "../ViewSwitch";
import Disclosure from "../Disclosure";
import UnavailableNotice from "../publication/UnavailableNotice";
import LsCard from "../livingStandards/LsCard";
import { useVariableParam } from "./useVariableParam";
import VintageChart, { legendItems } from "./VintageChart";
import { buildChartCsv } from "../../utils/chartCsv";
import { NEWEST_SHOWN, loadForecastVintages } from "../../utils/forecastVintages/load";
import { OUTTURN_KEY, UNIT_ORDER, buildView, checkSentence, pointsIn } from "../../utils/forecastVintages/view";
import "../livingStandards/LivingStandards.css";
import "./ForecastVintages.css";

// Shown first: the measure the view was modelled on
export const DEFAULT_VARIABLE = "rhdi_per_person";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const NEWEST_LABEL = `${MONTHS[NEWEST_SHOWN.month - 1]} ${NEWEST_SHOWN.year}`;

export const SOURCE_LINE = "ONS (outturn), OBR (forecast)";

// How each kind of OBR forecast is drawn (utils/forecastVintages/transforms.js)
const DRAWN = {
  growth:
    "The OBR forecasts this measure as growth, so each forecast's line starts on the outturn and grows at that forecast's rates.",
  index:
    "The OBR forecasts this measure as an index, so each forecast's line starts on the outturn and moves with that forecast's index.",
  level: "Each forecast is drawn as the OBR published it.",
};

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Where the forecasts' lines start, from the file's launch rules. A
 * re-anchored newest forecast starts elsewhere (its own note says where),
 * so then this is about the earlier forecasts only, and says nothing when
 * they are hidden.
 */
export function startsSentence(rules, frequency, annual, { reanchored = false, earlier = true } = {}) {
  const rule = annual
    ? "The last whole calendar year up to the quarter it starts from in the quarterly view."
    : rules?.[frequency];
  if (!rule) return null;
  const whose = reanchored ? earlier && "Each earlier forecast's" : earlier ? "Each forecast's" : "The forecast's";
  if (!whose) return null;
  return `${whose} dashed line starts at its launch period, or where its figures start if that is later. The launch period is ${lowerFirst(rule)}`;
}

const POINT_NAMES = {
  start: (view) => `the outturn at the start of this parliament (${view.label(view.start)})`,
  latest: (view, p) => `the latest outturn (${view.label(p.x)})`,
  end: (view) => `the ${view.newest.label} forecast at the end of this parliament (${view.label(view.end)})`,
};

/** "A", "A and B", "A, B and C". */
const listOf = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0]);

/** What the labelled points are, for those shown (`points`, in the brush's range). */
export function pointsSentence(view, points = view.points) {
  const names = points.map((p) => POINT_NAMES[p.role](view, p));
  if (!names.length) return null;
  return `The labelled points are ${listOf(names)}.`;
}

/**
 * The card's notes for a view that can be drawn: the measure's own notes,
 * its sources, how its forecasts are drawn, what cannot be drawn, what the
 * outturn was checked against, and what £ means for a quarterly measure.
 */
export function cardNotes(variable, view, { showPast }) {
  const measure = view.measure;
  const newest = view.vintages[view.vintages.length - 1];
  const undrawn = showPast ? view.undrawn : [];
  return [
    ...(variable.notes || []),
    `Outturn: ${measure.outturn_source}.`,
    `Forecasts: ${measure.forecast_source}.`,
    DRAWN[measure.kind],
    newest.reanchored &&
      `The ${newest.label} forecast starts from the latest outturn it reaches, ${view.label(newest.anchor)}, and is carried on from there by its own ${measure.kind === "index" ? "index" : "growth"}.`,
    undrawn.length > 0 &&
      `${listOf(undrawn)} ${undrawn.length > 1 ? "forecasts" : "forecast"} cannot be drawn in this view, so ${undrawn.length > 1 ? "they are" : "it is"} left out.`,
    checkSentence(measure.check, variable.frequency),
    variable.frequency === "quarterly" &&
      view.unit === "level" &&
      "In £, each quarter's amount is shown at an annual rate (times four); with A, each calendar year is the total of its four quarters.",
  ].filter(Boolean);
}

/**
 * The CSV download: a row per period shown, the outturn and each forecast
 * drawn as columns; a period a series does not cover is blank, never zero.
 */
export function vintageCsv({ title, units, view, rows, notes = [] }) {
  return buildChartCsv({
    title: `${title}: OBR forecasts and ONS outturn`,
    units,
    source: SOURCE_LINE,
    columns: [
      { key: "period", label: "Period" },
      { key: OUTTURN_KEY, label: "Outturn", decimals: 4 },
      ...view.vintages.map((v) => ({ key: v.key, label: `${v.label} forecast`, decimals: 4 })),
    ],
    rows: rows.map((row) => ({ ...row, period: view.label(row.x) })),
    notes,
  });
}

/** The single toggles beside the unit switch: F, H and A. */
function Toggles({ toggles }) {
  return (
    <div className="obr-view-switch is-compact fv-toggles" role="group" aria-label="Chart options">
      {toggles.map((t) => (
        <button
          key={t.letter}
          type="button"
          className="obr-view-option"
          aria-pressed={t.on}
          aria-label={t.label}
          title={t.disabled ? t.disabledTitle : t.label}
          disabled={t.disabled}
          onClick={t.onToggle}
        >
          <span aria-hidden="true">{t.letter}</span>
        </button>
      ))}
    </div>
  );
}

/** The chart card for one measure: its unit, options, chart and notes. */
function VintageCard({ data, variable, variableOptions, onVariable }) {
  const [unitBy, setUnitBy] = useState({});
  const [showPast, setShowPast] = useState(true);
  const [history, setHistory] = useState(false);
  const [annual, setAnnual] = useState(false);
  const [brush, setBrush] = useState({ key: null, range: null });

  const units = UNIT_ORDER.filter((unit) => variable.units[unit]);
  const unit = units.includes(unitBy[variable.id]) ? unitBy[variable.id] : variable.default_unit;
  const quarterly = variable.frequency === "quarterly";
  const annualOn = quarterly && annual;
  // Everything drawn from the file, so whatever cannot be drawn leaves
  // this measure unavailable rather than the view broken
  const { view, notes } = useMemo(() => {
    try {
      const built = buildView(data, variable, { unit, annual: annualOn, showPast });
      return { view: built, notes: built.unavailable ? [] : cardNotes(variable, built, { showPast }) };
    } catch (error) {
      return { view: { unavailable: `This measure cannot be drawn: ${error.message}` }, notes: [] };
    }
  }, [data, variable, unit, annualOn, showPast]);

  const chartKey = `${variable.id}|${unit}|${annualOn}|${showPast}|${history}`;
  const rowCount = view.rows?.length ?? 0;
  const range =
    brush.key === chartKey && brush.range ? brush.range : [history ? 0 : (view.windowStart ?? 0), Math.max(0, rowCount - 1)];
  const annualised = quarterly && !annualOn && unit === "level" && variable.units.level?.annualise;

  const controls = (
    <>
      <PillSelect
        variant="light"
        prefix="Show"
        name="Measure"
        value={variable.id}
        onChange={onVariable}
        options={variableOptions}
      />
      {units.length > 1 && (
        <ViewSwitch
          compact
          label="Unit"
          value={unit}
          onChange={(next) => setUnitBy((current) => ({ ...current, [variable.id]: next }))}
          options={units.map((u) => ({ value: u, label: variable.units[u].label, title: variable.units[u].axis }))}
        />
      )}
      <Toggles
        toggles={[
          { letter: "F", label: "Earlier forecasts", on: showPast, onToggle: () => setShowPast((v) => !v) },
          { letter: "H", label: "Full history", on: history, onToggle: () => setHistory((v) => !v) },
          {
            letter: "A",
            label: "Annual totals",
            on: annualOn,
            disabled: !quarterly,
            disabledTitle: "Annual totals: this measure is already annual",
            onToggle: () => setAnnual((v) => !v),
          },
        ]}
      />
      {annualised && <span className="fv-note">Quarterly annualised (×4)</span>}
    </>
  );

  if (view.unavailable) {
    return (
      <LsCard title={variable.label} icon="trend" summary={`Source: ${SOURCE_LINE}`} controls={controls}>
        <div className="chart-plot">
          <UnavailableNotice reason={view.unavailable} />
        </div>
      </LsCard>
    );
  }

  const shownRows = view.rows.slice(range[0], range[1] + 1);
  const newest = view.vintages[view.vintages.length - 1];
  const earlier = view.vintages.length > 1;
  const csvUnits = `${view.axisLabel}${annualised ? ", quarterly annualised (×4)" : ""}`;
  const about = [
    startsSentence(data.meta.launch_rules, variable.frequency, annualOn, { reanchored: newest.reanchored, earlier }),
    pointsSentence(view, pointsIn(view.points, shownRows)),
  ]
    .filter(Boolean)
    .join(" ");

  const csv = () => vintageCsv({ title: variable.label, units: csvUnits, view, rows: shownRows, notes });

  return (
    <LsCard
      title={variable.label}
      icon="trend"
      summary={`Source: ${SOURCE_LINE}`}
      controls={controls}
      about={about}
      notes={notes}
      source={`Source: ${SOURCE_LINE}. Each file, with its address and SHA-256 checksum, is listed under Sources below.`}
      sourceText={SOURCE_LINE}
      download={{ filename: `obr-forecasts-${variable.id}-${unit}`, csv, legendItems: legendItems(view, showPast) }}
    >
      <VintageChart
        view={view}
        showPast={showPast}
        range={range}
        onRange={(next) => setBrush({ key: chartKey, range: next })}
        chartKey={chartKey}
      />
    </LsCard>
  );
}

/** Every file the view is built from, with its address and checksum. */
function SourceList({ sources }) {
  const sha = (s) => (
    <code className="fv-sha" title={s.sha256}>
      {s.sha256.slice(0, 12)}
    </code>
  );
  return (
    <>
      <h4>OBR forecasts</h4>
      <ul className="fv-sources">
        {sources.obr.map((s) => (
          <li key={s.id}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
            {s.archive_url && (
              <>
                {" "}
                (
                <a href={s.archive_url} target="_blank" rel="noopener noreferrer">
                  archived copy
                </a>
                )
              </>
            )}
            , SHA-256 {sha(s)}
          </li>
        ))}
      </ul>
      <h4>ONS outturn</h4>
      <ul className="fv-sources">
        {sources.ons.map((s) => (
          <li key={s.cdid}>
            <a href={s.page} target="_blank" rel="noopener noreferrer">
              {s.cdid} ({s.dataset})
            </a>
            : {s.title}, released {s.release_date}, SHA-256 {sha(s)}
          </li>
        ))}
        {sources.hpi && (
          <li>
            <a href={sources.hpi.page} target="_blank" rel="noopener noreferrer">
              {sources.hpi.title}
            </a>
            , SHA-256 {sha(sources.hpi)}
          </li>
        )}
      </ul>
    </>
  );
}

/**
 * The link to the forecast behind the living standards baseline: `href` for
 * a new tab, `onShow` to show it in place, `label` its name where it is.
 */
function RelatedLink({ related }) {
  return (
    <p className="fv-related">
      The OBR forecast behind PolicyEngine&apos;s living standards baseline, as calendar-year growth, is in{" "}
      <a
        href={related.href}
        onClick={(event) => {
          if (!related.onShow) return;
          event.preventDefault();
          related.onShow();
        }}
      >
        {related.label}
      </a>
      .
    </p>
  );
}

function ForecastsView({ data, active, related }) {
  // The measures in the file's order, the default first in the address
  const ids = data.variables.map((v) => v.id);
  const values = ids.includes(DEFAULT_VARIABLE) ? [DEFAULT_VARIABLE, ...ids.filter((id) => id !== DEFAULT_VARIABLE)] : ids;
  const [variableId, setVariableId] = useVariableParam(values, active);
  const variable = data.variables.find((v) => v.id === variableId) ?? data.variables[0];
  const variableOptions = data.variables.map((v) => ({ value: v.id, label: v.label, suffix: "" }));
  const meta = data.meta;

  return (
    <div className="results-container fv-view">
      <SectionHeading
        title="OBR forecasts beside the outturn"
        subtitle={`The OBR's forecasts from June 2010 to ${NEWEST_LABEL}, beside the ONS outturn. These are the OBR's and the ONS's figures, not PolicyEngine's.`}
      />
      <section id="forecasts-chart" className="report-section ls-section">
        <div className="charts-grid">
          <VintageCard data={data} variable={variable} variableOptions={variableOptions} onVariable={setVariableId} />
        </div>
      </section>
      <section className="report-section fv-more">
        <Disclosure title="What this view leaves out">
          <ul className="fv-list">
            {meta.left_out.map((item) => (
              <li key={item.what}>
                <strong>{item.what}.</strong> {item.why}
              </li>
            ))}
            {meta.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Disclosure>
        <Disclosure title="Sources">
          <SourceList sources={meta.sources} />
        </Disclosure>
        {related && <RelatedLink related={related} />}
      </section>
    </div>
  );
}

/**
 * The forecast vintages view, wherever it is mounted.
 *
 * @param {boolean} [active] - Whether it is shown (kept mounted while hidden)
 * @param {{href: string, label: string, onShow?: () => void}} [related] -
 *   The link to the forecast behind the living standards baseline
 */
export default function ForecastVintagesView({ active = true, related }) {
  const [state, setState] = useState({ loading: true, data: null, error: null, newer: false });

  useEffect(() => {
    let live = true;
    loadForecastVintages().then((result) => {
      if (live) setState({ loading: false, ...result });
    });
    return () => {
      live = false;
    };
  }, []);

  const { loading, data, error, newer } = state;
  if (loading) {
    return (
      <p className="view-status" role="status">
        Loading OBR forecasts…
      </p>
    );
  }
  if (newer) {
    return (
      <UnavailableNotice reason="OBR forecasts are unavailable">
        <p>
          The forecasts file holds a forecast after {NEWEST_LABEL}, which this view shows once it has been checked.
        </p>
      </UnavailableNotice>
    );
  }
  if (error || !data) {
    return (
      <UnavailableNotice reason="OBR forecasts are unavailable">
        <p>The forecasts file could not be read{error ? ` (${error})` : ""}. No figures are shown in its place.</p>
      </UnavailableNotice>
    );
  }
  return <ForecastsView data={data} active={active} related={related} />;
}
