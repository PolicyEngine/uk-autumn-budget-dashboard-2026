/**
 * Whatever one field of the forecasts file holds, the loader
 * (utils/forecastVintages/load.js) refuses the file or the page draws it
 * truly. The fields changed: every key of every object, at every depth,
 * of all sixteen variables and both measures; of other lists, the first
 * and last items (and any item, sampled, in A); of a series, its first,
 * a middle and its last periods, the period after its last, one two
 * after (a gap) and a key that is no period. Each is changed in turn: to
 * nothing, to the wrong type, to text the page reads as a name (a unit, a
 * frequency, "__proto__"), to a neighbour's value, and to nearby numbers.
 *
 * - The loader accepts exactly the changes FILE_OK accepts (A). FILE_OK
 *   is written here, apart from the loader, from what the build can write
 *   (src/uk_budget_data/forecast_vintages/build.py) and what the page
 *   needs of each field. Its kind and check rules are the ones the build
 *   and the loader share (check_kind and check_as_read in the build);
 *   utils/forecastVintages/kind.test.js and check.test.js hold both to the
 *   same cases, and kind.test.js shows a forecast's figures after its
 *   launch, within the bounds every figure keeps, never change whether a
 *   file is taken.
 * - A file it accepts draws every view on an axis that holds every point,
 *   or gives one of the builder's reasons why the view cannot be drawn (a
 *   % change on a series that falls below zero, say), naming the view's
 *   newest forecast where it names one; never a zero or an empty chart.
 *   Whether the reason is true of the data is not checked here;
 *   view.test.js checks each on files made to give it. A change to a field that holds no figure leaves every figure,
 *   and every view drawn, as it was; a field the page does not read
 *   leaves every word as it was too (B).
 * - It mounts on its default unit, showing what the builder makes of that
 *   view and nothing else: its reason it cannot be drawn, or a chart with
 *   a line for each forecast and the outturn, each through its own
 *   series' points on one axis, and the view's labelled points with their
 *   values, in the window it opens on (C).
 *
 * WHAT_IT_HOLDS names every field the file has. A field it does not name
 * fails the test, so a field added to the file must be added there.
 */
import { readFileSync } from "node:fs";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { cleanup, render, screen, within } from "@testing-library/react";
import ForecastVintagesView, { cardNotes, drawnNote, pointsSentence, startsSentence, vintageCsv } from "./ForecastVintagesView";
import { chartLayout, legendItems, xTicks } from "./VintageChart";
import { forecastVintagesProblem, resetForecastVintages } from "../../utils/forecastVintages/load";
import { OUTTURN_KEY, UNIT_ORDER, buildView, pointsIn, stepDecimals } from "../../utils/forecastVintages/view";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 900, height: 440 }}>{cloneElement(children, { width: 900, height: 440 })}</div>
    ),
  };
});

const TEXT = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
const DATA = JSON.parse(TEXT);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------
// What the file may hold, from what the build writes (build.py), the
// brief and the file's own words (meta.launch_rules), not from load.js
// ---------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The newest forecast shown (the brief: March 2026)
const NEWEST = 2026 * 12 + 3;
// No figure in the file comes near this in its own units
const LIMIT = 1e9;

const str = (v) => typeof v === "string" && v.length > 0;
const plain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMIT;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const missing = (v) => v === undefined || v === null;
const distinct = (xs) => new Set(xs).size === xs.length;
const https = (v) => typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v);
const hex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const day = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const slug = (v) => typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(v);
const among = (list) => (v) => typeof v === "string" && list.includes(v);

/** "2024", 2024, "2024-25" or "2024Q2" as a number counting periods; null if it is none. */
function periodNo(key, frequency) {
  const s = frequency === "calendar" && Number.isInteger(key) ? String(key) : key;
  if (typeof s !== "string") return null;
  let m;
  let year;
  let no;
  if (frequency === "calendar" && (m = /^(\d{4})$/.exec(s))) [year, no] = [+m[1], +m[1]];
  else if (frequency === "fiscal" && (m = /^(\d{4})-(\d{2})$/.exec(s)) && +m[2] === (+m[1] + 1) % 100) [year, no] = [+m[1], +m[1]];
  else if (frequency === "quarterly" && (m = /^(\d{4})Q([1-4])$/.exec(s))) [year, no] = [+m[1], +m[1] * 4 + +m[2] - 1];
  else return null;
  return year >= 1900 && year <= 2100 ? no : null;
}

const periodText = (no, frequency) =>
  frequency === "quarterly"
    ? `${Math.floor(no / 4)}Q${(no % 4) + 1}`
    : frequency === "fiscal"
      ? `${no}-${String((no + 1) % 100).padStart(2, "0")}`
      : String(no);

// The launch rules in the file's words: two quarters before the quarter
// of publication; the calendar year before; the last complete fiscal
// year (April to March) before
function launchOf(frequency, year, month) {
  if (frequency === "quarterly") return year * 4 + Math.floor((month - 1) / 3) - 2;
  if (frequency === "calendar") return year - 1;
  return month >= 4 ? year - 1 : year - 2;
}

/** {period: number}, with no period missing between its ends, as a Map; null if not. */
function seriesOf(values, frequency) {
  if (!plain(values)) return null;
  const out = new Map();
  for (const [k, v] of Object.entries(values)) {
    const t = periodNo(k, frequency);
    if (t === null || !num(v)) return null;
    out.set(t, v);
  }
  const ts = [...out.keys()].sort((a, b) => a - b);
  if (!ts.length || ts.some((t, i) => i > 0 && t !== ts[i - 1] + 1)) return null;
  return out;
}

const firstOf = (series) => [...series.keys()].reduce((a, b) => Math.min(a, b));

function vintageOk(v, frequency, kind) {
  if (!plain(v) || !int(v.year, 1900, 2100) || !int(v.month, 1, 12)) return false;
  if (!slug(v.id) || v.label !== `${MONTH_NAMES[v.month - 1]} ${v.year}`) return false;
  const launch = launchOf(frequency, v.year, v.month);
  if (periodNo(v.launch, frequency) !== launch) return false;
  const values = seriesOf(v.values, frequency);
  if (!values) return false;
  // From its launch period on, or (not an index) the period after, and
  // two periods or more (the build's vintage_record)
  const first = firstOf(values);
  if (values.size < 2) return false;
  return kind === "index" ? first === launch : first === launch || first === launch + 1;
}

// The kind rule the build and the loader share (check_kind in build.py):
// every growth rate under 100% either way and every index above zero;
// each forecast's figure for its launch period, an estimate of a period
// already over, near the outturn as its kind reads it (a level within
// half the outturn's largest size, a growth rate within 10 points of the
// outturn's rate, an index's ratio to the outturn within 1.5 times of
// every other forecast's), where the outturn has what that needs; one
// forecast's at least so set. The figures after the launch are forecasts
// and are never set against it
function kindReads(m, outturn, frequency) {
  const lag = frequency === "quarterly" ? 4 : 1;
  const size = Math.max(...[...outturn.values()].map(Math.abs));
  const ratios = [];
  let estimates = 0;
  for (const v of m.vintages) {
    const values = seriesOf(v.values, frequency);
    const all = [...values.values()];
    if (m.kind === "index" && all.some((x) => x <= 0)) return false;
    if (m.kind === "growth" && all.some((x) => Math.abs(x) >= 100)) return false;
    const launch = periodNo(v.launch, frequency);
    if (!values.has(launch)) continue;
    const [estimate, now, before] = [values.get(launch), outturn.get(launch), outturn.get(launch - lag)];
    const set = m.kind === "level" ? now !== undefined : m.kind === "growth" ? now !== undefined && before > 0 : now > 0;
    if (!set) continue;
    estimates += 1;
    if (m.kind === "level" && Math.abs(estimate - now) > 0.5 * size) return false;
    if (m.kind === "growth" && Math.abs(estimate - 100 * (now / before - 1)) > 10) return false;
    if (m.kind === "index") ratios.push(estimate / now);
  }
  return estimates > 0 && !(ratios.length && Math.max(...ratios) > 1.5 * Math.min(...ratios));
}

// The build's outturn check, as check_as_read (build.py) lets it be
// written: one for every measure; its gaps in the measure's own units for
// a forecast of levels, else in growth rates; a share of the value only
// where the gaps are in the value's units, and under one; a tolerance no
// finer than the four decimals a gap is written to, and a gap that is 0
// or no finer; the gap as written within the tolerance as written
function checkOk(c, m, outturn, frequency) {
  const terms = m.kind === "level" ? m.unit : "% change on a year earlier";
  if (!plain(c) || !str(c.against) || c.in !== terms || typeof c.tolerance_is_share !== "boolean") return false;
  if (!Array.isArray(c.periods) || !c.periods.length) return false;
  const ts = c.periods.map((p) => periodNo(p, frequency));
  if (ts.some((t, i) => t === null || !outturn.has(t) || (i > 0 && t <= ts[i - 1]))) return false;
  if (!num(c.tolerance) || !(c.tolerance >= 1e-4)) return false;
  if (c.tolerance_is_share && !(c.tolerance < 1 && m.kind === "level")) return false;
  const at = periodNo(c.largest_gap_period, frequency);
  if (!num(c.largest_gap) || at === null || !c.periods.includes(c.largest_gap_period)) return false;
  const gap = Math.abs(c.largest_gap);
  if (gap !== 0 && gap < 1e-4) return false;
  // A share's gap is of the OBR's figure: the build's gap is the outturn
  // less the OBR's, so the OBR's is the outturn less the gap
  if (!c.tolerance_is_share) return gap <= c.tolerance;
  return gap <= c.tolerance * Math.abs(outturn.get(at) - c.largest_gap);
}

function measureOk(m, frequency) {
  if (!plain(m) || !among(["growth", "index", "level"])(m.kind)) return false;
  if (!str(m.unit) || !str(m.outturn_source) || !str(m.forecast_source) || !int(m.decimals, 0, 6)) return false;
  const outturn = seriesOf(m.outturn, frequency);
  if (!outturn || !checkOk(m.check, m, outturn, frequency)) return false;
  if (!Array.isArray(m.vintages) || !m.vintages.length || !m.vintages.every((v) => vintageOk(v, frequency, m.kind))) return false;
  const dates = m.vintages.map((v) => v.year * 12 + v.month);
  if (!distinct(m.vintages.map((v) => v.id)) || dates.some((d, i) => i > 0 && d <= dates[i - 1])) return false;
  return dates[dates.length - 1] === NEWEST && kindReads(m, outturn, frequency);
}

function unitsOk(variable) {
  const units = variable.units;
  if (!plain(units) || !Object.keys(units).length) return false;
  for (const [unit, spec] of Object.entries(units)) {
    if (!["level", "index", "pct"].includes(unit)) return false;
    if (!plain(spec) || !str(spec.label) || !str(spec.axis) || !among(["level", "share"])(spec.from)) return false;
    // % alone is a change on a year earlier; £ alone is at an annual
    // rate, and always for a quarterly measure (the build's units check)
    if (!missing(spec.transform) && !(spec.transform === "growth" && unit === "pct")) return false;
    if (!missing(spec.annualise) && typeof spec.annualise !== "boolean") return false;
    if ((spec.annualise === true) !== (unit === "level" && variable.frequency === "quarterly")) return false;
  }
  return among(["level", "index", "pct"])(variable.default_unit) && Object.hasOwn(units, variable.default_unit);
}

function variableOk(v) {
  if (!plain(v) || !slug(v.id) || !str(v.label) || !among(["calendar", "fiscal", "quarterly"])(v.frequency)) return false;
  if (!missing(v.notes) && !(Array.isArray(v.notes) && v.notes.every(str))) return false;
  if (!unitsOk(v)) return false;
  const read = new Set(Object.values(v.units).map((spec) => spec.from));
  if (![...read].every((name) => measureOk(v[name], v.frequency))) return false;
  // A % shown as published reads a measure in %; £ or people never do
  return Object.entries(v.units).every(([unit, spec]) => {
    const inPct = v[spec.from].unit.startsWith("%");
    return !(unit === "pct" && spec.transform !== "growth" && !inPct) && !(unit === "level" && inPct);
  });
}

function metaOk(meta, frequencies) {
  if (!plain(meta)) return false;
  const { parliament, launch_rules: rules, left_out: leftOut, gaps, sources } = meta;
  if (![...frequencies].every((f) => plain(rules) && str(rules[f]))) return false;
  // A quarterly measure's annual totals are calendar years
  const dated = new Set(frequencies);
  if (dated.has("quarterly")) dated.add("calendar");
  for (const f of dated) {
    const [a, b] = [periodNo(parliament?.start?.[f], f), periodNo(parliament?.end?.[f], f)];
    if (a === null || b === null || a >= b) return false;
  }
  if (!Array.isArray(leftOut) || !leftOut.every((x) => plain(x) && str(x.what) && str(x.why))) return false;
  if (!distinct(leftOut.map((x) => x.what)) || !Array.isArray(gaps) || !gaps.every(str) || !distinct(gaps)) return false;
  if (!plain(sources)) return false;
  const { obr, ons, hpi } = sources;
  const obrOk = (x) => plain(x) && str(x.id) && str(x.title) && https(x.url) && (missing(x.archive_url) || https(x.archive_url)) && hex64(x.sha256);
  const onsOk = (x) => plain(x) && str(x.cdid) && str(x.dataset) && https(x.page) && str(x.title) && day(x.release_date) && hex64(x.sha256);
  if (!Array.isArray(obr) || !obr.length || !obr.every(obrOk) || !distinct(obr.map((x) => x.id))) return false;
  if (!Array.isArray(ons) || !ons.length || !ons.every(onsOk) || !distinct(ons.map((x) => x.cdid))) return false;
  return missing(hpi) || (plain(hpi) && https(hpi.page) && str(hpi.title) && hex64(hpi.sha256));
}

/** Whether the page may draw `data`. */
function FILE_OK(data) {
  if (!plain(data) || !Array.isArray(data.variables) || !data.variables.length) return false;
  if (!data.variables.every(variableOk) || !distinct(data.variables.map((v) => v.id))) return false;
  return metaOk(data.meta, new Set(data.variables.map((v) => v.frequency)));
}

// ---------------------------------------------------------------------
// Every field, and what a change to it may change on the page
// ---------------------------------------------------------------------

// figures: may change what is drawn; opens: chooses which view opens,
// each drawn as before (C checks the view it opens on); words: may change
// only text; unread: changes nothing the page shows
const FIGURES = "figures";
const OPENS = "opens";
const WORDS = "words";
const UNREAD = "unread";
const M = "variables.[].{measure}";
const WHAT_IT_HOLDS = {
  "": FIGURES,
  garbage: UNREAD,
  variables: FIGURES,
  "variables.[]": FIGURES,
  "variables.[].garbage": UNREAD,
  "variables.[].id": WORDS,
  "variables.[].label": WORDS,
  "variables.[].group": UNREAD,
  "variables.[].frequency": FIGURES,
  "variables.[].default_unit": OPENS,
  "variables.[].notes": WORDS,
  "variables.[].notes.[]": WORDS,
  "variables.[].units": FIGURES,
  "variables.[].units.{unit}": FIGURES,
  "variables.[].units.{unit}.garbage": UNREAD,
  "variables.[].units.{unit}.label": WORDS,
  "variables.[].units.{unit}.axis": WORDS,
  "variables.[].units.{unit}.from": FIGURES,
  "variables.[].units.{unit}.transform": FIGURES,
  "variables.[].units.{unit}.annualise": FIGURES,
  [M]: FIGURES,
  [`${M}.garbage`]: UNREAD,
  [`${M}.kind`]: FIGURES,
  // How figures are written (£, %, decimals), not the figures
  [`${M}.unit`]: WORDS,
  [`${M}.decimals`]: WORDS,
  [`${M}.outturn_source`]: WORDS,
  [`${M}.forecast_source`]: WORDS,
  [`${M}.outturn`]: FIGURES,
  [`${M}.outturn.{period}`]: FIGURES,
  [`${M}.check`]: WORDS,
  [`${M}.check.garbage`]: UNREAD,
  [`${M}.check.against`]: WORDS,
  [`${M}.check.in`]: WORDS,
  [`${M}.check.periods`]: WORDS,
  [`${M}.check.periods.[]`]: WORDS,
  [`${M}.check.tolerance`]: WORDS,
  [`${M}.check.tolerance_is_share`]: WORDS,
  [`${M}.check.largest_gap`]: WORDS,
  [`${M}.check.largest_gap_period`]: WORDS,
  [`${M}.vintages`]: FIGURES,
  [`${M}.vintages.[]`]: FIGURES,
  [`${M}.vintages.[].garbage`]: UNREAD,
  [`${M}.vintages.[].id`]: WORDS,
  [`${M}.vintages.[].label`]: WORDS,
  [`${M}.vintages.[].year`]: FIGURES,
  [`${M}.vintages.[].month`]: FIGURES,
  [`${M}.vintages.[].launch`]: FIGURES,
  [`${M}.vintages.[].values`]: FIGURES,
  [`${M}.vintages.[].values.{period}`]: FIGURES,
  meta: FIGURES,
  "meta.garbage": UNREAD,
  "meta.built_by": UNREAD,
  // The newest forecast's name comes from load.js's NEWEST_SHOWN
  "meta.newest_vintage": UNREAD,
  "meta.parliament": FIGURES,
  "meta.parliament.garbage": UNREAD,
  "meta.parliament.start": FIGURES,
  "meta.parliament.start.{frequency}": FIGURES,
  "meta.parliament.end": FIGURES,
  "meta.parliament.end.{frequency}": FIGURES,
  "meta.launch_rules": WORDS,
  "meta.launch_rules.{frequency}": WORDS,
  "meta.left_out": WORDS,
  "meta.left_out.[]": WORDS,
  "meta.left_out.[].garbage": UNREAD,
  "meta.left_out.[].what": WORDS,
  "meta.left_out.[].why": WORDS,
  "meta.gaps": WORDS,
  "meta.gaps.[]": WORDS,
  "meta.sources": WORDS,
  "meta.sources.garbage": UNREAD,
  "meta.sources.obr": WORDS,
  "meta.sources.obr.[]": WORDS,
  "meta.sources.obr.[].garbage": UNREAD,
  "meta.sources.obr.[].id": WORDS,
  "meta.sources.obr.[].title": WORDS,
  "meta.sources.obr.[].url": WORDS,
  "meta.sources.obr.[].archive_url": WORDS,
  "meta.sources.obr.[].file": UNREAD,
  "meta.sources.obr.[].member": UNREAD,
  "meta.sources.obr.[].sha256": WORDS,
  "meta.sources.ons": WORDS,
  "meta.sources.ons.[]": WORDS,
  "meta.sources.ons.[].garbage": UNREAD,
  "meta.sources.ons.[].cdid": WORDS,
  "meta.sources.ons.[].dataset": WORDS,
  "meta.sources.ons.[].file": UNREAD,
  "meta.sources.ons.[].page": WORDS,
  "meta.sources.ons.[].release_date": WORDS,
  "meta.sources.ons.[].retrieved": UNREAD,
  "meta.sources.ons.[].sha256": WORDS,
  "meta.sources.ons.[].title": WORDS,
  "meta.sources.ons.[].url": UNREAD,
  "meta.sources.hpi": WORDS,
  "meta.sources.hpi.garbage": UNREAD,
  "meta.sources.hpi.file": UNREAD,
  "meta.sources.hpi.latest_month": UNREAD,
  "meta.sources.hpi.page": WORDS,
  "meta.sources.hpi.retrieved": UNREAD,
  "meta.sources.hpi.sha256": WORDS,
  "meta.sources.hpi.title": WORDS,
  "meta.sources.hpi.url": UNREAD,
};

/** A field's place in WHAT_IT_HOLDS: list items as [], and the keys that vary as {period}, {unit}, {frequency} and {measure}. */
function patternOf(path) {
  const parts = path.map((key, i) => {
    const before = path[i - 1];
    if (typeof key === "number") return "[]";
    if (before === "outturn" || before === "values") return "{period}";
    if (before === "units") return "{unit}";
    if (before === "launch_rules" || ((before === "start" || before === "end") && path[i - 2] === "parliament")) return "{frequency}";
    if (i === 2 && path[0] === "variables" && (key === "level" || key === "share")) return "{measure}";
    return String(key);
  });
  const pattern = parts.join(".");
  if (!(pattern in WHAT_IT_HOLDS)) throw new Error(`WHAT_IT_HOLDS does not name ${pattern}`);
  return pattern;
}

const valueAt = (data, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), data);
const frequencyAt = (data, path) => (path[0] === "variables" ? data.variables[path[1]]?.frequency : null);

// Every field: each object's keys and one it does not have, every
// variable, another list's first and last items, and of a series its
// first, a middle and its last periods, the period after its last, one
// two after (a gap) and a key that is no period
function fieldPaths(value, path = [], out = []) {
  out.push(path);
  if (Array.isArray(value)) {
    const items = path.join() === "variables" ? value.keys() : new Set([0, value.length - 1].filter((i) => i >= 0));
    for (const i of items) fieldPaths(value[i], [...path, i], out);
  } else if (plain(value)) {
    const keys = Object.keys(value);
    const last = path[path.length - 1];
    if (last === "outturn" || last === "values") {
      const frequency = frequencyAt(DATA, path);
      const nos = keys.map((k) => periodNo(k, frequency)).sort((a, b) => a - b);
      const [lo, hi] = [nos[0], nos[nos.length - 1]];
      for (const no of [lo, Math.floor((lo + hi) / 2), hi, hi + 1, hi + 2]) out.push([...path, periodText(no, frequency)]);
      out.push([...path, "garbage"]);
    } else {
      for (const key of keys) fieldPaths(value[key], [...path, key], out);
      out.push([...path, "garbage"]);
    }
  }
  return out;
}

const DELETE = Symbol("delete");
// What a field should not hold, and some it may: nothing, the wrong
// type, a period written wrongly, names the page looks up (a unit, a
// frequency, an object's own keys), addresses, checksums and dates
const VALUES = [
  DELETE,
  null,
  "",
  "garbage",
  "2024Q5",
  "2024-99",
  "2024.0",
  "2024",
  2024,
  "2024Q2",
  "2024-25",
  -1,
  0,
  0.02,
  0.5,
  1.5,
  7,
  13,
  1e10,
  1e308,
  -1e308,
  true,
  false,
  "true",
  "false",
  "1",
  [],
  {},
  ["garbage"],
  { garbage: 1 },
  ["level"],
  "toString",
  "__proto__",
  "constructor",
  "level",
  "index",
  "pct",
  "share",
  "growth",
  "calendar",
  "fiscal",
  "quarterly",
  "javascript:alert(1)",
  "https://example.org/x",
  "a".repeat(64),
  "2026-10-20",
  "March 2026",
];

/** Values for `path` besides VALUES: a neighbour's in the list it is in, and numbers near its own. */
function nearby(path) {
  const own = valueAt(DATA, path);
  const out = [];
  const at = path.findLastIndex((k) => typeof k === "number");
  if (at >= 0) {
    const list = valueAt(DATA, path.slice(0, at));
    const other = path[at] > 0 ? path[at] - 1 : list.length > 1 ? 1 : null;
    if (other !== null) out.push(valueAt(DATA, [...path.slice(0, at), other, ...path.slice(at + 1)]));
  }
  if (typeof own === "number") out.push(own + 1, own * 1.01, -own, Math.round(own * 2));
  return out.filter((v) => v !== undefined);
}

/** `data` with the field at `path` set to `value` (or removed), copying only the objects on the way. */
function changed(data, path, value) {
  if (!path.length) return value === DELETE ? undefined : value;
  const [key, ...rest] = path;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  if (rest.length) copy[key] = changed(data[key], rest, value);
  else if (value !== DELETE) copy[key] = value;
  else if (Array.isArray(copy)) copy.splice(key, 1);
  else delete copy[key];
  return copy;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (path, value) => `${path.join(".")} = ${value === DELETE ? "(deleted)" : JSON.stringify(value)}`;
const noChange = (path, value) =>
  value === DELETE ? valueAt(DATA, path) === undefined : same(valueAt(DATA, path), value) && typeof valueAt(DATA, path) === typeof value;

// Smaller files to change, so the sweep is quick: a variable alone, or
// with its neighbour where a change could repeat the neighbour's id; one
// variable of each frequency for meta. The loader checks a variable
// apart from the others, but for their ids and meta, so a change it
// refuses in the smaller file it refuses in the whole one; B and C make
// the changes it accepts to the whole file
const ONE_PER_FREQUENCY = ["calendar", "fiscal", "quarterly"].map((f) => DATA.variables.find((v) => v.frequency === f));
function smaller(path) {
  if (path[0] === "variables" && typeof path[1] === "number") {
    const i = path[1];
    const others = path.length <= 3 ? [DATA.variables[i > 0 ? i - 1 : 1]] : [];
    return { data: { ...DATA, variables: [DATA.variables[i], ...others] }, path: ["variables", 0, ...path.slice(2)] };
  }
  if (path[0] === "meta") return { data: { ...DATA, variables: ONE_PER_FREQUENCY }, path };
  return { data: DATA, path };
}

const PATHS = fieldPaths(DATA);
const CASES = PATHS.flatMap((path) => [...VALUES, ...nearby(path)].filter((v) => !noChange(path, v)).map((value) => ({ path, value })));

/** Where the loader and FILE_OK disagree, and every change both accept. */
function sweep() {
  const disagree = [];
  const accepted = [];
  for (const { path, value } of CASES) {
    patternOf(path);
    const small = smaller(path);
    const data = changed(small.data, small.path, value);
    const loader = forecastVintagesProblem(data) === null;
    if (loader !== FILE_OK(data)) disagree.push(`${show(path, value)}: the loader ${loader ? "accepts" : "refuses"} it`);
    else if (loader) accepted.push({ path, value });
  }
  return { disagree, accepted };
}

let swept = null;
const RESULT = () => (swept ??= sweep());

/** The whole file with an accepted change, which the loader and FILE_OK accept too. */
function acceptedWhole({ path, value }) {
  const data = changed(DATA, path, value);
  if (forecastVintagesProblem(data) !== null || !FILE_OK(data)) throw new Error(`${show(path, value)}: refused in the whole file`);
  return data;
}

// ---------------------------------------------------------------------
// Drawing an accepted file
// ---------------------------------------------------------------------

const CANVASES = [
  { canvasWidth: 926, narrow: false },
  { canvasWidth: 254, narrow: true },
];

/**
 * Every view of `variables` as the page draws it: its figures (by
 * forecast name, so a renamed id draws the same) and its words. Throws
 * where a view cannot be drawn truly: no axis, a point off its axis, a
 * note that says "as the OBR published it" of figures that are not.
 */
function drawEverything(data, variables) {
  const drawn = {};
  for (const v of variables) {
    for (const unit of UNIT_ORDER.filter((u) => Object.hasOwn(v.units, u))) {
      for (const annual of v.frequency === "quarterly" ? [false, true] : [false]) {
        for (const showPast of [true, false]) {
          const viewKey = `${unit}${annual ? " A" : ""}${showPast ? "" : " F off"}`;
          const where = `${v.id} ${viewKey}`;
          const view = buildView(data, v, { unit, annual, showPast });
          if (view.unavailable) {
            // One of the builder's reasons, of this view: the newest
            // forecast, which no older one replaces, or the outturn; an
            // index's base only in the index unit
            const newestLabel = v[v.units[unit].from].vintages.at(-1).label;
            const reasons = [
              `The ${newestLabel} forecast of this measure cannot be drawn in this unit.`,
              "The outturn of this measure cannot be drawn in this unit.",
              ...(unit === "index" ? ["There is no outturn above zero at the start of this parliament, so no index can be drawn."] : []),
            ];
            if (!reasons.includes(view.unavailable)) throw new Error(`${where}: unavailable, saying ${JSON.stringify(view.unavailable)}`);
            drawn[viewKey] = { unavailable: view.unavailable };
            continue;
          }
          const names = Object.fromEntries(view.vintages.map((x) => [x.key, x.label]));
          const figures = view.rows.map((row) =>
            Object.fromEntries(Object.entries(row).map(([k, y]) => [names[k] ?? k, y])),
          );
          const newest = view.vintages[view.vintages.length - 1];
          const note = drawnNote(view.measure.kind, view);
          if (note === "Each forecast is drawn as the OBR published it.") {
            for (const x of view.vintages) {
              const published = view.measure.vintages.find((p) => p.id === x.id).values;
              for (const [t, y] of x.values) {
                if (published[periodText(t, view.frequency)] !== y) throw new Error(`${where}: "as published" of a figure that is not`);
              }
            }
          }
          const words = [
            ...cardNotes(v, view, { showPast }),
            startsSentence(data.meta.launch_rules, v.frequency, annual, { reanchored: newest.reanchored, earlier: view.vintages.length > 1 }),
            JSON.stringify(legendItems(view, showPast)),
            vintageCsv({ title: v.label, units: view.axisLabel, view, rows: view.rows }),
          ];
          const tickLabel = (x) => (view.frequency === "quarterly" ? String(Math.floor(x / 4)) : view.label(x));
          for (const rows of [view.rows.slice(view.windowStart), view.rows]) {
            words.push(pointsSentence(view, pointsIn(view.points, rows)));
            for (const canvas of CANVASES) {
              const layout = chartLayout(view, rows, canvas);
              if (!layout) throw new Error(`${where}: no axis`);
              const [bottom, top] = layout.axis.domain;
              for (const row of rows) {
                for (const [k, y] of Object.entries(row)) {
                  if (k !== "x" && y != null && !(y >= bottom && y <= top)) throw new Error(`${where}: ${y} off the axis`);
                }
              }
              words.push(layout.axis.ticks.map((t) => view.format(t, stepDecimals(layout.axis.step))).join(" "));
              words.push(xTicks(rows, view.frequency, { plotWidth: layout.plotWidth, label: tickLabel }).map(tickLabel).join(" "));
            }
          }
          drawn[viewKey] = { figures, points: view.points, undrawn: view.undrawn, words };
        }
      }
    }
  }
  return drawn;
}

// The variables a change to `path` can reach, each with itself as it is
// in the committed file: its own, one of each frequency for meta, or all
function reached(data, path) {
  const pair = (v) => [v, DATA.variables.find((o) => o.id === v.id)];
  if (path[0] === "variables" && typeof path[1] === "number" && path.length > 2) {
    return [[data.variables[path[1]], DATA.variables[path[1]]]];
  }
  if (path[0] === "meta") return ONE_PER_FREQUENCY.map((o) => pair(data.variables.find((v) => v.id === o.id)));
  return data.variables.map(pair);
}

const ORIGINAL = new Map();
const originalOf = (variable) => {
  if (!ORIGINAL.has(variable.id)) ORIGINAL.set(variable.id, drawEverything(DATA, [variable]));
  return ORIGINAL.get(variable.id);
};
const strip = (drawn) => Object.fromEntries(Object.entries(drawn).map(([k, d]) => [k, { ...d, words: undefined }]));

/** Throws where an accepted change is not drawn truly. */
function checkDrawn({ path, value }) {
  const data = acceptedWhole({ path, value });
  const what = WHAT_IT_HOLDS[patternOf(path)];
  for (const [v, original] of reached(data, path)) {
    const now = drawEverything(data, [v]);
    if (what === FIGURES || !original) continue;
    const before = originalOf(original);
    if (!same(strip(now), strip(before))) throw new Error(`${show(path, value)}: changed the figures of ${v.id}`);
    if (what === UNREAD && !same(now, before)) throw new Error(`${show(path, value)}: changed the words of ${v.id}`);
  }
}

describe("a forecasts file the loader accepts", () => {
  it("names every field the file has, and changes each in every measure", () => {
    const patterns = new Set(PATHS.map(patternOf));
    // Every field named is in the file (none named for nothing) ...
    for (const pattern of Object.keys(WHAT_IT_HOLDS)) expect(patterns.has(pattern), pattern).toBe(true);
    // ... and every variable, both measures and every unit are reached
    for (const [i, v] of DATA.variables.entries()) {
      for (const name of ["level", "share"].filter((m) => v[m])) {
        for (const field of ["check", "outturn", "vintages", "kind"]) {
          if (field !== "check" || v[name].check) expect(PATHS.some((p) => p[1] === i && p[2] === name && p[3] === field)).toBe(true);
        }
      }
      for (const unit of Object.keys(v.units)) expect(PATHS.some((p) => p[1] === i && p[3] === unit)).toBe(true);
    }
    expect(CASES.length).toBeGreaterThan(50000);
  });

  it("is exactly a file FILE_OK takes, whatever one field holds (A)", () => {
    expect(RESULT().disagree).toEqual([]);
    // Some changes leave a file the page draws (a label that is other
    // text, a figure a little higher), so B and C have files to draw
    expect(RESULT().accepted.length).toBeGreaterThan(500);
    const figureChanges = RESULT().accepted.filter(({ path }) => WHAT_IT_HOLDS[patternOf(path)] === FIGURES);
    expect(figureChanges.length).toBeGreaterThan(100);
  }, 300000);

  it("is drawn truly: a field that holds no figure changes none, and one the page does not read changes nothing (B)", () => {
    // One accepted change to every field, and a sample of all of them
    const each = [...new Map(RESULT().accepted.map((change) => [change.path.join("."), change])).values()];
    for (const change of each) checkDrawn(change);
    fc.assert(
      fc.property(fc.constantFrom(...RESULT().accepted), (change) => checkDrawn(change)),
      { numRuns: 200 },
    );
  }, 300000);

  it("agrees with FILE_OK on any item of any list, not only the first and last (A, sampled)", () => {
    // A walk from the top, taking at each step the key or item its number
    // picks, to a field anywhere in the file
    const walk = (steps) => {
      const path = [];
      let at = DATA;
      for (const n of steps) {
        if (Array.isArray(at) && at.length) path.push(n % at.length);
        else if (plain(at) && Object.keys(at).length) path.push(Object.keys(at)[n % Object.keys(at).length]);
        else break;
        at = at[path[path.length - 1]];
      }
      return path;
    };
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 9 }), fc.nat(), (steps, pick) => {
        const path = walk(steps);
        const values = [...VALUES, ...nearby(path)].filter((v) => !noChange(path, v));
        if (!values.length) return;
        const value = values[pick % values.length];
        const small = smaller(path);
        const data = changed(small.data, small.path, value);
        expect(forecastVintagesProblem(data) === null, show(path, value)).toBe(FILE_OK(data));
      }),
      { numRuns: 3000 },
    );
  }, 300000);

  it("agrees with FILE_OK on every combination of a measure's kind and its check's terms, share, tolerance and gap (A, together)", () => {
    // Fields that say what each other mean: one at a time each may pass
    // and only together say something false (a share of a growth rate)
    const disagree = [];
    let accepted = 0;
    DATA.variables.forEach((v, i) => {
      for (const name of ["level", "share"].filter((m) => v[m]?.check)) {
        const m = v[name];
        for (const kind of ["growth", "index", "level"]) {
          for (const terms of [m.unit, "% change on a year earlier", "£ billion"]) {
            for (const share of [true, false]) {
              for (const tolerance of [0.00001, 0.005, 0.02, 0.5, 1.5]) {
                for (const gap of [0, 1e-300, 0.0001, 0.005, 0.0051, m.check.largest_gap, 2]) {
                  const small = smaller(["variables", i, name]);
                  const check = { ...m.check, in: terms, tolerance_is_share: share, tolerance, largest_gap: gap };
                  const data = changed(small.data, small.path, { ...m, kind, check });
                  const loader = forecastVintagesProblem(data) === null;
                  if (loader !== FILE_OK(data)) disagree.push(`${v.id} ${name} ${JSON.stringify({ kind, terms, share, tolerance, gap })}: the loader ${loader ? "accepts" : "refuses"} it`);
                  else if (loader) accepted += 1;
                }
              }
            }
          }
        }
      }
    });
    expect(disagree).toEqual([]);
    expect(accepted).toBeGreaterThan(100);
  }, 300000);

  /** Mounts the page on `data`, on `variable`, as a reader opens it. */
  async function mount(data, variable) {
    resetForecastVintages();
    window.history.replaceState({}, "", `/?tab=forecasts&variable=${encodeURIComponent(variable.id)}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
    render(<ForecastVintagesView />);
    await screen.findByRole("heading", { name: "OBR forecasts beside the outturn" });
  }

  /** Throws unless the page opens on the default unit and shows what the builder makes of that view, and nothing else. */
  function opensTruly(data, variable, where) {
    const units = UNIT_ORDER.filter((u) => Object.hasOwn(variable.units, u));
    if (units.length > 1) {
      const pressed = within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { pressed: true });
      if (pressed.textContent !== variable.units[variable.default_unit].label) throw new Error(`${where}: opened on ${pressed.textContent}`);
    }
    const expected = buildView(data, variable, { unit: variable.default_unit, annual: false, showPast: true });
    const notice = document.querySelector(".publication-unavailable")?.textContent ?? null;
    const chart = document.querySelector(".recharts-surface");
    if (notice !== expected.unavailable) throw new Error(`${where}: shows ${JSON.stringify(notice)}, not ${JSON.stringify(expected.unavailable)}`);
    if (Boolean(chart) === Boolean(expected.unavailable)) throw new Error(`${where}: ${chart ? "a chart" : "no chart"} beside ${JSON.stringify(notice)}`);
    if (expected.unavailable) return;
    // The chart holds what the view does: a line for each earlier
    // forecast, the newest and the outturn, in the order they are drawn,
    // each through its own series' points in the window it opens on, all
    // on one axis (each pixel an affine function of period and value)
    const lines = [...document.querySelectorAll(".recharts-line")];
    if (lines.length !== expected.vintages.length + 1) throw new Error(`${where}: ${lines.length} lines for ${expected.vintages.length} forecasts and the outturn`);
    const opened = expected.rows.slice(expected.windowStart ?? 0);
    const keys = [...expected.vintages.filter((x) => !x.newest), expected.vintages.find((x) => x.newest)].map((x) => x.key);
    const pairs = [];
    [...keys, OUTTURN_KEY].forEach((key, i) => {
      const d = lines[i].querySelector(".recharts-line-curve")?.getAttribute("d") ?? "";
      const drawn = [...d.matchAll(/[ML]\s*(-?[\d.]+(?:e-?\d+)?)[ ,]\s*(-?[\d.]+(?:e-?\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const want = opened.filter((row) => Number.isFinite(row[key])).map((row) => [row.x, row[key]]);
      if (drawn.length !== want.length) throw new Error(`${where}: line ${i} (${key}) has ${drawn.length} points, its series ${want.length}`);
      want.forEach(([x, y], j) => pairs.push({ x, y, px: drawn[j][0], py: drawn[j][1], key }));
    });
    const affine = (get, put) => {
      const [lo, hi] = [pairs.reduce((a, b) => (get(b) < get(a) ? b : a)), pairs.reduce((a, b) => (get(b) > get(a) ? b : a))];
      if (get(hi) === get(lo)) return pairs.every((q) => Math.abs(put(q) - put(lo)) < 0.01);
      const slope = (put(hi) - put(lo)) / (get(hi) - get(lo));
      return pairs.every((q) => Math.abs(put(lo) + slope * (get(q) - get(lo)) - put(q)) < 0.01);
    };
    if (!affine((q) => q.x, (q) => q.px)) throw new Error(`${where}: a line's points are not at their periods`);
    if (!affine((q) => q.y, (q) => q.py)) throw new Error(`${where}: a line's points are not at its series' values`);
    const want = pointsIn(expected.points, opened).map((p) => `${p.role} ${expected.format(p.y)}`);
    const got = [...document.querySelectorAll(".fv-point-label")].map((g) => `${g.dataset.role} ${g.querySelector("text").textContent}`);
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${where}: labels ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  }

  it("mounts on its default unit, showing the builder's chart (each line through its own series, and the labelled points) or its reason, and nothing else (C)", async () => {
    // Every accepted change to which unit opens, and a sample of the rest
    const opens = RESULT().accepted.filter(({ path }) => WHAT_IT_HOLDS[patternOf(path)] === OPENS);
    expect(opens.length).toBeGreaterThan(10);
    for (const change of opens) {
      const data = acceptedWhole(change);
      const [shown] = reached(data, change.path)[0];
      await mount(data, shown);
      opensTruly(data, shown, show(change.path, change.value));
      cleanup();
      vi.unstubAllGlobals();
    }
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RESULT().accepted), async (change) => {
        const data = acceptedWhole(change);
        const [shown] = reached(data, change.path)[0];
        await mount(data, shown);
        opensTruly(data, shown, show(change.path, change.value));
        cleanup();
        vi.unstubAllGlobals();
      }),
      { numRuns: 40 },
    );
  }, 300000);
});
