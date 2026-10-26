import CountUpText from "../CountUpText";
import {
  Armchair,
  ArrowRight,
  Baby,
  BriefcaseBusiness,
  Car,
  Check,
  ChevronDown,
  LayoutGrid,
  GraduationCap,
  HardHat,
  House,
  KeyRound,
  UsersRound,
} from "lucide-react";
import { useRef, useState } from "react";
import SectionHeading from "../SectionHeading";
import useDataFile from "../../hooks/useDataFile";
import { buildHouseholdRequest } from "../../utils/householdImpactApi";
import { presetInputs } from "../../utils/householdPresets";
import { DISTRIBUTION_FILE, curveOf, distributionRunFor, householdPosition, ordinal, parseDistribution } from "../../utils/incomePosition";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { fiscalYearTick, shortFiscalYearTick } from "../../utils/chartTheme";
import { SELECTABLE_YEARS, isDisplayYear } from "../../utils/displayYears";
import { MINUS, money } from "../../utils/singleYear";
import Tip from "../Tip";

/** Each example's icon, by the name it gives (householdExamples.js). */
export const EXAMPLE_ICONS = {
  key: KeyRound,
  hardHat: HardHat,
  armchair: Armchair,
  family: UsersRound,
  graduate: GraduationCap,
  car: Car,
  briefcase: BriefcaseBusiness,
  baby: Baby,
};

/**
 * Whether the catalogue publishes every measure an example features: its
 * tag and accent show only then, so a measure withdrawn on Budget day is
 * never named on a card, alone or beside another (#104).
 */
export function featuresPublished(example, catalogue) {
  return (example.measures ?? [example.measure]).every((id) => catalogue.byId.get(id)?.displayable === true);
}

/** Each measure's short name, as a card's chip names it (sentence case there). */
const SOURCE_NAMES = {
  domestic_electricity_zero_vat: "zero VAT on electricity",
  fuel_duty_rise_deferral: "the fuel duty deferral",
  road_fuel_vat_cut: "the VAT cut on road fuel",
  state_pension_income_tax_protection: "State Pension tax protection",
  plan_2_threshold_unfreeze: "the Plan 2 threshold unfreeze",
  threshold_freeze_2031_32: "the threshold freeze",
  warm_home_discount_top_up: "the Warm Home Discount top-up",
  employer_ni_relief_under_25s: "employer National Insurance relief",
  badr_lifetime_limit_cut: "the Business Asset Disposal Relief cut",
};
// A short name where there is one, else the catalogue's published name
const sourceName = (id, catalogue) => SOURCE_NAMES[id] ?? catalogue?.byId.get(id)?.name ?? id;
// As a chip names it: "Zero VAT on electricity", "Fuel duty deferral"
const chipName = (id, catalogue) => {
  const name = sourceName(id, catalogue).replace(/^the /, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** "+£88", "−£12" or "£0", from whole pounds. */
export const signedMoney = (value) => {
  const rounded = Math.round(value);
  return rounded === 0 ? "£0" : `${rounded > 0 ? "+" : MINUS}${money(Math.abs(rounded))}`;
};
const tone = (value) => (Math.round(value) > 0 ? "is-gain" : Math.round(value) < 0 ? "is-loss" : "is-none");

/**
 * What one example's card shows for `year`, from the precomputed results
 * (householdPresets.js presetChanges) or the page's own (the headline
 * alone): its change in net income, the change in each year for the bars,
 * its own measures' part, and `top`, what its chip names: the measure
 * giving the largest part of the year's change, with that part ({ ids,
 * name, part, own }). Its own measures (the example's tag) when they give
 * the most, or nothing does, or there is no split by measure (part null).
 */
export function cardFigures(example, byYear, year, catalogue = null) {
  const current = byYear?.[year];
  if (!current) return null;
  // The split by measure, from the precomputed file only: a figure the
  // page asked for itself (useExampleFigures.js) is the headline alone, so
  // its card names no measure's part
  const split = current.byPolicy ?? null;
  const own = example.measures ?? [example.measure];
  const ownPart = split ? own.reduce((sum, id) => sum + (split[id] ?? 0), 0) : null;
  // The other measure giving the largest part of the change
  const [mainId, mainPart] = Object.entries(split ?? {})
    .filter(([id]) => !own.includes(id))
    .reduce((best, entry) => (Math.abs(entry[1]) > Math.abs(best[1]) ? entry : best), [null, 0]);
  const top =
    mainId && Math.round(mainPart) !== 0 && Math.abs(mainPart) > Math.abs(ownPart)
      ? { ids: [mainId], name: chipName(mainId, catalogue), part: mainPart, own: false }
      : { ids: own, name: example.tag, part: ownPart, own: true };
  // Every year a reader can choose: one not yet in is null (its bar a stub)
  const years = [...new Set([...SELECTABLE_YEARS, ...Object.keys(byYear).map(Number)])].filter(isDisplayYear).sort((a, b) => a - b);
  const series = years.map((y) => ({ year: y, change: byYear[y] ? byYear[y].change : null }));
  return { change: current.change, ownPart, top, series };
}

/**
 * Where an example sits in the UK income distribution in `year`, after the
 * measures its figures are with: the percentile of its net income adjusted
 * for household size, on the same curves and equivalisation as "Where you
 * sit" (utils/incomePosition.js). Null without the year's net income or a
 * published distribution for those measures.
 */
export function examplePercentile(example, point, { year, policies, rows, catalogue }) {
  if (!rows || !point || !Number.isFinite(point.before) || !Number.isFinite(point.after)) return null;
  const run = distributionRunFor(
    policies,
    catalogue?.displayable?.map((measure) => measure.id) ?? [],
    catalogue?.combinedId ? (catalogue.manifest?.combined?.[catalogue.combinedId]?.measures ?? null) : null,
  );
  const before = curveOf(rows, { reformId: run.reformId, year, side: "baseline" });
  const after = curveOf(rows, { reformId: run.reformId, year, side: "reform" });
  if (before.length < 2 || after.length < 2) return null;
  const { household } = buildHouseholdRequest(presetInputs(example), { year, policies });
  const position = householdPosition({ net: point, household, before, after });
  const percentile = position.after.percentile;
  return percentile === null ? null : Math.min(99, Math.max(1, Math.round(percentile)));
}

/** A small strip with a dot where the example sits, and its percentile. */
function PositionStrip({ percentile, yearLabel }) {
  return (
    <Tip content={`${percentile} in every 100 people in the UK live in households with a lower income than this one, once incomes are adjusted for household size (${yearLabel}, after the selected policies)`}>
    <span className="household-card-position">
      <span className="household-card-position-track" aria-hidden="true">
        <span className="household-card-position-dot" style={{ left: `${percentile}%` }} />
      </span>
      <span className="household-card-position-label">{`${ordinal(percentile)} percentile`}</span>
    </span>
    </Tip>
  );
}

/** "+£12 a year", "No change", or "calculating" for a year not yet in. */
const changeText = (change) =>
  change === null ? "calculating" : Math.round(change) === 0 ? "No change" : `${signedMoney(change)} a year`;

// The bars' geometry: each bar BAR wide, PITCH apart, in PLOT of height
const BAR = 12;
const PITCH = 17;
const PLOT = 34;

/**
 * The change in each year as bars about a zero line, gains above it and
 * losses below, with the first and last years under them. The year chosen
 * is highlighted; hovering, tapping or (once focused) the arrow keys
 * highlight another and show its figure in a small tooltip. One tab stop,
 * labelled with every year's figure.
 */
export function YearBars({ series, year }) {
  // The year shown in the tooltip: hovered, tapped or reached by the keys
  const [active, setActive] = useState(null);
  const highlighted = active ?? year;
  const known = series.filter((point) => point.change !== null).map((point) => point.change);
  const most = Math.max(0, ...known);
  const least = Math.min(0, ...known);
  const span = most - least || 1;
  // The zero line: at the foot when nothing falls, at the top when nothing rises
  const zero = (PLOT * most) / span;
  const width = series.length * PITCH - (PITCH - BAR);
  const point = series.find((item) => item.year === active);
  const label = `Change in net income by year: ${series
    .map((item) => `${fiscalYearTick(item.year)} ${changeText(item.change)}`)
    .join(", ")}`;
  const move = (step) => {
    const index = series.findIndex((item) => item.year === highlighted);
    const next = series[Math.min(series.length - 1, Math.max(0, (index < 0 ? 0 : index) + step))];
    if (next) setActive(next.year);
  };
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(step);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(series[event.key === "Home" ? 0 : series.length - 1].year);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };
  return (
    <span
      className="household-card-spark"
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((current) => current ?? year)}
      onBlur={() => setActive(null)}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setActive(null);
      }}
    >
      <span className={`household-card-spark-tip ${point ? "is-shown" : ""}`.trim()} aria-live="polite">
        {point ? `${fiscalYearTick(point.year)}: ${changeText(point.change)}` : ""}
      </span>
      <svg width={width} height={PLOT} viewBox={`0 0 ${width} ${PLOT}`} aria-hidden="true" focusable="false">
        {series.map((item, index) => {
          // A year not yet in: a short stub on the zero line, shimmering
          const waiting = item.change === null;
          const size = waiting ? 3 : Math.max(1.5, (Math.abs(item.change) * PLOT) / span);
          return (
            <g key={item.year}>
              <rect
                className={`${waiting ? "is-pending" : tone(item.change)} ${item.year === highlighted ? "is-current" : ""}`.trim()}
                x={index * PITCH}
                y={waiting || item.change >= 0 ? zero - size : zero}
                width={BAR}
                height={size}
                rx={2}
              />
              {/* The bar's whole column answers the pointer, not only the bar */}
              <rect
                className="household-card-spark-hit"
                x={index * PITCH - (PITCH - BAR) / 2}
                y={0}
                width={PITCH}
                height={PLOT}
                onPointerEnter={() => setActive(item.year)}
                onClick={() => setActive(item.year)}
              />
            </g>
          );
        })}
        <line className="household-card-spark-zero" x1={0} x2={width} y1={zero} y2={zero} />
      </svg>
      <span className="household-card-spark-years" aria-hidden="true">
        <span>{shortFiscalYearTick(series[0].year)}</span>
        {series.length > 1 && <span>{shortFiscalYearTick(series[series.length - 1].year)}</span>}
      </span>
    </span>
  );
}

/**
 * The Household impact view's cards: first one wide "Your household"
 * card, which opens the form below the cards; then eight example
 * households under "Example households", all the same size, each of which
 * fills the form and shows its result at once. One section heading over
 * them, the page's own (SectionHeading), as on every tab. Each example names who
 * it is and, on its tag, the measure it is for, in that measure's colour.
 * Once the precomputed results are in and every measure is selected, it
 * shows its change in net income in the year chosen, a bar for each year,
 * the part its own measure gives (on the tag) and, when another measure
 * gives more, which one.
 *
 * An example card is a box with one button over it (its name, pressed
 * when chosen), so that its year bars, a control of their own, sit outside
 * the button.
 *
 * @param {Object} props
 * @param {Array} props.examples - householdExamples.js's HOUSEHOLD_EXAMPLES
 * @param {string|null} props.value - The example the form holds, while unedited
 * @param {boolean} props.formOpen - Whether the form is open below the cards
 * @param {string} props.formId - The form panel's id, for aria-controls
 * @param {() => void} props.onYours - "Your household" pressed
 * @param {(id: string) => void} props.onChoose - An example pressed
 * @param {Object|null} props.presets - The figures by example and year: the
 *   precomputed file's (presetChanges, with the split by measure) or the
 *   page's own (useExampleFigures, the headline only), or null for none
 * @param {Object|null} [props.fill] - The page's own figures' progress, when
 *   the file does not answer: { pending, failed (Sets of "id:year"), reduced
 *   (the measures asked with, when the API did not know every selected one) }
 * @param {string[]} [props.figurePolicies] - The measures the figures are
 *   with (for where each example sits)
 * @param {number|null} props.yoursChange - Your household's change, once calculated
 * @param {number} props.year
 * @param {boolean} [props.yoursSelected] - Your household is the one chosen
 *   (its form open, or its result shown)
 * @param {boolean} [props.chosen] - A household has been chosen: the cards
 *   fold into a strip of chips, the full grid a "Show all households" away
 */
export default function HouseholdCards({
  examples,
  value,
  formOpen,
  formId,
  onYours,
  onChoose,
  presets,
  fill = null,
  figurePolicies = [],
  yoursChange = null,
  year,
  chosen = false,
  yoursSelected = false,
}) {
  const catalogue = useMeasureCatalogue();
  const distribution = useDataFile(DISTRIBUTION_FILE, parseDistribution);
  // The measures the figures are with: those the API took, when fewer
  const positionPolicies = fill?.reduced ?? figurePolicies;
  // What the figures are with, on hover (no line above the cards): every
  // measure (the file), the selected ones, or those the calculator supports
  const figuresWith = !fill ? "every measure" : fill.reduced ? "the measures the calculator supports" : "the selected measures";
  // Folded into the strip once a household is chosen; "Show all
  // households" opens the grid again, and a choice there folds it
  const [showAll, setShowAll] = useState(false);
  const folded = chosen && !showAll;
  const choose = (action) => {
    setShowAll(false);
    action();
  };
  return (
    <section className={`household-cards ${folded ? "is-folded" : ""}`.trim()} aria-label="Choose a household">
      {/* The page's section heading, as on every tab, with "Show all
          households" beside it once a household is chosen */}
      <div className="household-cards-head">
        <SectionHeading icon="users" title="Choose a household" subtitle="Enter your own household, or start from an example below." />
        {/* Open again: back to the strip; folded, the button is at the
            strip's start, where the eye begins */}
        {chosen && !folded && (
          <button
            type="button"
            className="household-cards-toggle"
            aria-expanded
            aria-controls="household-cards-grid"
            onClick={() => setShowAll(false)}
          >
            <LayoutGrid size={14} strokeWidth={2} aria-hidden="true" />
            Show fewer
          </button>
        )}
      </div>
      <HouseholdStrip
        onShowAll={() => setShowAll(true)}
        examples={examples}
        value={value}
        presets={presets}
        yoursChange={yoursChange}
        yoursSelected={yoursSelected}
        formOpen={formOpen}
        formId={formId}
        year={year}
        shown={folded}
        onYours={onYours}
        onChoose={onChoose}
      />
      <div className={`household-cards-fold ${folded ? "" : "is-open"}`.trim()} aria-hidden={folded || undefined} inert={folded || undefined}>
      <div className="household-cards-fold-inner">
      <YourHouseholdCard
        selected={yoursSelected}
        formOpen={formOpen}
        formId={formId}
        change={yoursChange}
        onClick={() => choose(onYours)}
      />
      <div className="household-cards-grid" id="household-cards-grid" role="group" aria-label="Example households">
        {examples.map((example, index) => {
          const Icon = EXAMPLE_ICONS[example.icon] ?? House;
          const figures = presets ? cardFigures(example, presets[example.id], year, catalogue) : null;
          const waiting = !figures && Boolean(fill?.pending.has(`${example.id}:${year}`));
          const percentile = figures
            ? examplePercentile(example, presets[example.id]?.[year], {
                year,
                policies: positionPolicies,
                rows: distribution.status === "ready" ? distribution.rows : null,
                catalogue,
              })
            : null;
          const featured = featuresPublished(example, catalogue);
          // The chip: the top measure once the split is known, else the
          // example's own; shown only while the catalogue publishes it
          const chipFigures = figures?.top ?? { ids: example.measures ?? [example.measure], name: example.tag, part: null, own: true };
          const chip = chipFigures.ids.every((id) => catalogue.byId.get(id)?.displayable === true) ? chipFigures : null;
          const pressed = value === example.id;
          const describedBy = `household-card-${example.id}-result household-card-${example.id}-description`;
          return (
            <div
              key={example.id}
              className={`household-card ${pressed ? "is-selected" : ""}`.trim()}
              style={{ "--card-accent": featured ? catalogue.byId.get(example.measure).color : undefined, "--i": index + 1 }}
            >
              <span className="household-card-icon" aria-hidden="true">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <button
                type="button"
                className="household-card-hit"
                aria-pressed={pressed}
                aria-describedby={describedBy}
                onClick={() => choose(() => onChoose(example.id))}
              >
                <span className="household-card-name">{example.label}</span>
              </button>
              {pressed && (
                <span className="household-card-check" aria-hidden="true">
                  <Check size={14} strokeWidth={2.6} />
                </span>
              )}
              <span className="household-card-result">
                {figures ? (
                  <>
                    <Tip content={`Change in net income in ${fiscalYearTick(year)} with ${figuresWith}`}>
                    <span className={`household-card-figure ${tone(figures.change)}`} id={`household-card-${example.id}-result`}>
                      {Math.round(figures.change) === 0 ? "No change" : <CountUpText text={signedMoney(figures.change)} />}
                      {Math.round(figures.change) !== 0 && <span className="household-card-figure-unit"> a year</span>}
                    </span>
                    </Tip>
                    <YearBars series={figures.series} year={year} />
                  </>
                ) : waiting ? (
                  // Being calculated in the background: a shimmer where the
                  // figure and bars will be
                  <span className="household-card-shimmer" id={`household-card-${example.id}-result`} role="status">
                    <span className="household-card-shimmer-figure" aria-hidden="true" />
                    <span className="household-card-shimmer-bars" aria-hidden="true" />
                    <span className="visually-hidden">Calculating</span>
                  </span>
                ) : (
                  <span className="household-card-pending" id={`household-card-${example.id}-result`}>
                    Calculated when chosen
                  </span>
                )}
              </span>
              {/* Where they sit: its own row, empty when not known, so every
                  card keeps the same height */}
              <span className="household-card-position-row">
                {percentile !== null && <PositionStrip percentile={percentile} yearLabel={fiscalYearTick(year)} />}
              </span>
              <span className="household-card-description" id={`household-card-${example.id}-description`}>
                {example.description}
              </span>
              {/* One chip: the measure giving most of the year's change, with
                  its part, in its colour; the example's own measure in the
                  chip's title when another gives more */}
              {chip && (
                <Tip
                  content={
                    !chip.own && featured && figures
                      ? `This example features ${example.tag} (${signedMoney(figures.ownPart)} in ${fiscalYearTick(year)}); most of the change comes from ${chip.name} (${signedMoney(chip.part)}).`
                      : null
                  }
                >
                <span className="household-card-tag" style={{ "--chip-accent": catalogue.byId.get(chip.ids[0])?.color }}>
                  <span className="household-card-dot" aria-hidden="true" />
                  <span className="household-card-tag-name">{chip.name}</span>
                  {chip.part != null && <span className="household-card-tag-part">{signedMoney(chip.part)}</span>}
                </span>
                </Tip>
              )}
            </div>
          );
        })}
      </div>
      </div>
      </div>
    </section>
  );
}

/**
 * "Your household", above the examples, the width of the grid: an
 * invitation to enter your own, with what the form asks first, and once
 * calculated, your result. Pressing it opens the form below (pressed, with
 * a tick, as an example is); pressing it again closes it.
 */
function YourHouseholdCard({ selected, formOpen, formId, change, onClick }) {
  const calculated = Number.isFinite(change);
  const action = formOpen ? "Hide your answers" : calculated ? "Change your answers" : "Enter your household";
  return (
    <button
      type="button"
      className={`household-yours ${selected ? "is-selected" : ""} ${formOpen ? "is-open" : ""}`.replace(/\s+/g, " ").trim()}
      aria-pressed={selected}
      aria-controls={formId}
      onClick={onClick}
    >
      <span className="household-yours-art" aria-hidden="true">
        <House size={24} strokeWidth={1.8} />
      </span>
      <span className="household-yours-words">
        {/* The card's name, for the button's: the title says it on screen */}
        <span className="household-card-name visually-hidden">Your household</span>
        <span className="household-yours-title">Enter your own household</span>
        <span className="household-yours-lead">See how the Budget changes your income, in about 30 seconds.</span>
      </span>
      <span className="household-yours-side">
        {calculated && (
          <span className="household-yours-result">
            <span className="household-yours-result-label">Your result</span>
            <span className={`household-card-figure ${tone(change)}`}>
              {Math.round(change) === 0 ? "No change" : signedMoney(change)}
              {Math.round(change) !== 0 && <span className="household-card-figure-unit"> a year</span>}
            </span>
          </span>
        )}
        <span className="household-yours-action">
          {action}
          {formOpen ? (
            <ChevronDown className="household-card-chevron" size={16} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <ArrowRight className="household-yours-arrow" size={16} strokeWidth={2.2} aria-hidden="true" />
          )}
        </span>
      </span>
      {selected && (
        <span className="household-card-check" aria-hidden="true">
          <Check size={14} strokeWidth={2.6} />
        </span>
      )}
    </button>
  );
}

/**
 * The cards folded: a chip for each card, in the cards' order and grid
 * (Your household the width of the grid, then the eight examples below
 * it), each its icon, a short name and its change, the chosen one in its
 * colour with a tick. One listbox, Your household first (choosing it opens
 * the form, which it controls; choosing it again while chosen closes or
 * reopens the form): the arrow keys (and Home, End) move between chips,
 * Enter or Space chooses one, a click chooses it at once.
 */
function HouseholdStrip({ examples, value, presets, yoursChange, yoursSelected, formId, year, shown, onYours, onChoose, onShowAll = null }) {
  const catalogue = useMeasureCatalogue();
  // A chip's accent only while the catalogue publishes its measures (#104)
  const accentOf = (example) => (featuresPublished(example, catalogue) ? catalogue.byId.get(example.measure).color : null);
  const items = [
    { id: null, label: "Your household", short: "Your household", Icon: House, change: yoursChange, accent: null },
    ...examples.map((example) => ({
      id: example.id,
      label: example.label,
      short: example.short ?? example.label,
      Icon: EXAMPLE_ICONS[example.icon] ?? House,
      change: presets ? (cardFigures(example, presets[example.id], year)?.change ?? null) : null,
      accent: accentOf(example),
    })),
  ];
  const selected = yoursSelected ? 0 : items.findIndex((item) => item.id !== null && item.id === value);
  // The chip Tab lands on: the chosen one, until the arrow keys move on
  // (a new choice starts from it again)
  const [moved, setMoved] = useState({ from: selected, index: null });
  const focus = moved.from === selected && moved.index !== null ? moved.index : Math.max(0, selected);
  const setFocus = (index) => setMoved({ from: selected, index });
  const refs = useRef([]);
  const activate = (item) => (item.id === null ? onYours() : onChoose(item.id));
  const onKeyDown = (event) => {
    const last = items.length - 1;
    const next = {
      ArrowRight: Math.min(last, focus + 1),
      ArrowDown: Math.min(last, focus + 1),
      ArrowLeft: Math.max(0, focus - 1),
      ArrowUp: Math.max(0, focus - 1),
      Home: 0,
      End: last,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setFocus(next);
      refs.current[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(items[focus]);
    }
  };
  const figureText = (change) =>
    Number.isFinite(change) ? (Math.round(change) === 0 ? "No change" : signedMoney(change)) : null;
  return (
    <div className={`household-strip-fold ${shown ? "is-open" : ""}`.trim()} aria-hidden={!shown || undefined} inert={!shown || undefined}>
      <div className="household-strip-fold-inner">
        {onShowAll && (
          <button
            type="button"
            className="household-cards-back"
            aria-expanded={false}
            aria-controls="household-cards-grid"
            onClick={onShowAll}
          >
            <LayoutGrid size={15} strokeWidth={2} aria-hidden="true" />
            Show all households
          </button>
        )}
        <ul className="household-strip" role="listbox" aria-label="Households" aria-orientation="horizontal" onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const isSelected = index === selected;
            const figure = figureText(item.change);
            return (
              <li
                key={item.id ?? "yours"}
                ref={(node) => {
                  refs.current[index] = node;
                }}
                role="option"
                aria-selected={isSelected}
                aria-controls={item.id === null ? formId : undefined}
                aria-label={figure ? `${item.label}, ${figure}${figure === "No change" ? "" : " a year"}` : item.label}
                tabIndex={index === focus ? 0 : -1}
                className={`household-chip ${item.id === null ? "is-yours" : ""}`.trim()}
                title={item.label}
                style={item.accent ? { "--card-accent": item.accent, "--i": index } : { "--i": index }}
                onClick={() => {
                  setFocus(index);
                  activate(item);
                }}
              >
                <span className="household-chip-icon" aria-hidden="true">
                  {isSelected ? <Check size={13} strokeWidth={2.6} /> : <item.Icon size={14} strokeWidth={1.9} />}
                </span>
                <span className="household-chip-name">
                  {item.id === null ? (
                    <>
                      Your household
                      {!Number.isFinite(item.change) && <span className="household-chip-hint"> · enter your own</span>}
                    </>
                  ) : (
                    item.short
                  )}
                </span>
                {figure && <span className={`household-chip-figure ${tone(item.change)}`}>{figure}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
