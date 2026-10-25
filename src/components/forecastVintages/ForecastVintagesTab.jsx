// The OBR forecasts view: for each of the OBR's headline measures, every
// OBR forecast since June 2010 beside the ONS outturn, each forecast drawn
// from the period it was made in. It reads
// public/data/obr_forecast_vintages.json (utils/forecastVintages/load.js),
// which holds only the OBR's forecasts and the ONS's outturn: no
// PolicyEngine figure is shown here. A file that cannot be read, or that
// holds a forecast after the newest this view shows, leaves the view
// unavailable; it never shows zero in its place.

import { useEffect, useMemo, useState } from "react";
import SectionHeading from "../SectionHeading";
import PillSelect from "../PillSelect";
import ViewSwitch from "../ViewSwitch";
import Disclosure from "../Disclosure";
import UnavailableNotice from "../publication/UnavailableNotice";
import LsCard from "../livingStandards/LsCard";
import { useSubTabParam } from "../SubTabs";
import VintageChart, { legendItems } from "./VintageChart";
import { buildChartCsv } from "../../utils/chartCsv";
import { NEWEST_SHOWN, loadForecastVintages } from "../../utils/forecastVintages/load";
import { OUTTURN_KEY, UNIT_ORDER, buildView, checkSentence } from "../../utils/forecastVintages/view";
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
    "The OBR forecasts this measure as growth, so each forecast's line starts on the outturn in the period it was made and grows at that forecast's rates.",
  index:
    "The OBR forecasts this measure as an index, so each forecast's line starts on the outturn in the period it was made and moves with that forecast's index.",
  level: "Each forecast is drawn as the OBR published it.",
};

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/** Where each forecast's line starts, from the file's launch rules. */
export function startsSentence(rules, frequency, annual) {
  const rule = annual
    ? "The last whole calendar year up to the quarter it starts from in the quarterly view."
    : rules?.[frequency];
  return rule ? `Each dashed line is one OBR forecast, from its launch period: ${lowerFirst(rule)}` : null;
}

const POINT_NAMES = {
  start: (view) => `the outturn at the start of this parliament (${view.label(view.start)})`,
  latest: (view, p) => `the latest outturn (${view.label(p.x)})`,
  end: (view) => `the ${view.newest.label} forecast at the end of this parliament (${view.label(view.end)})`,
};

/** What the labelled points are, for those the view has. */
export function pointsSentence(view) {
  const names = view.points.map((p) => POINT_NAMES[p.role](view, p));
  if (!names.length) return null;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `The labelled points are ${list}.`;
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
  const view = useMemo(() => {
    try {
      return buildView(data, variable, { unit, annual: annualOn, showPast });
    } catch (error) {
      return { unavailable: `This measure cannot be drawn: ${error.message}` };
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

  const measure = view.measure;
  const shownRows = view.rows.slice(range[0], range[1] + 1);
  const newest = view.vintages[view.vintages.length - 1];
  const csvUnits = `${view.axisLabel}${annualised ? ", quarterly annualised (×4)" : ""}`;
  const notes = [
    ...(variable.notes || []),
    `Outturn: ${measure.outturn_source}.`,
    `Forecasts: ${measure.forecast_source}.`,
    DRAWN[measure.kind],
    newest.reanchored &&
      `The ${newest.label} forecast starts from the latest outturn it reaches, ${view.label(newest.anchor)}, and is carried on from there by its own ${measure.kind === "index" ? "index" : "growth"}.`,
    checkSentence(measure.check, variable.frequency),
    quarterly &&
      unit === "level" &&
      "In £, each quarter's amount is shown at an annual rate (times four); with A, each calendar year is the total of its four quarters.",
  ].filter(Boolean);
  const about = [startsSentence(data.meta.launch_rules, variable.frequency, annualOn), pointsSentence(view)]
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

/** A link to another view, as the Methodology view's. */
function ViewLink({ tab, sub, onShowTab, children }) {
  return (
    <a
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}`}
      onClick={(event) => {
        if (!onShowTab) return;
        event.preventDefault();
        onShowTab(tab, sub);
      }}
    >
      {children}
    </a>
  );
}

function ForecastsView({ data, active, onShowTab }) {
  // The measures in the file's order, the default first in the address
  const ids = data.variables.map((v) => v.id);
  const values = ids.includes(DEFAULT_VARIABLE) ? [DEFAULT_VARIABLE, ...ids.filter((id) => id !== DEFAULT_VARIABLE)] : ids;
  const [variableId, setVariableId] = useSubTabParam(values, active);
  const variable = data.variables.find((v) => v.id === variableId) ?? data.variables[0];
  const variableOptions = data.variables.map((v) => ({ value: v.id, label: v.label, suffix: "" }));
  const meta = data.meta;

  return (
    <div className="results-container fv-view">
      <SectionHeading
        title="OBR forecasts beside the outturn"
        subtitle={`Each OBR forecast from June 2010 to ${NEWEST_LABEL}, drawn from the period it was made in, beside the ONS outturn. These are the OBR's and the ONS's figures, not PolicyEngine's.`}
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
        <p className="fv-related">
          The OBR forecast behind PolicyEngine&apos;s living standards baseline, as calendar-year growth, is in{" "}
          <ViewLink tab="living" sub="forecast" onShowTab={onShowTab}>
            Living standards: Forecast changes
          </ViewLink>
          .
        </p>
      </section>
    </div>
  );
}

export default function ForecastVintagesTab({ active = true, onShowTab }) {
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
  return <ForecastsView data={data} active={active} onShowTab={onShowTab} />;
}
