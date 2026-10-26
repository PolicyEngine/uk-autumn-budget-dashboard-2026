import {
  Armchair,
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
import TitleIcon from "../TitleIcon";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { fiscalYearTick } from "../../utils/chartTheme";
import { MINUS, money } from "../../utils/singleYear";

/** Each example's icon, by the name it gives (householdExamples.js). */
export const EXAMPLE_ICONS = {
  key: KeyRound,
  hardHat: HardHat,
  armchair: Armchair,
  family: UsersRound,
  graduate: GraduationCap,
  car: Car,
  briefcase: BriefcaseBusiness,
};

/**
 * Whether the catalogue publishes every measure an example features: its
 * tag and accent show only then, so a measure withdrawn on Budget day is
 * never named on a card, alone or beside another (#104).
 */
export function featuresPublished(example, catalogue) {
  return (example.measures ?? [example.measure]).every((id) => catalogue.byId.get(id)?.displayable === true);
}

/** Each measure as a card's "+£50 from …" line names it. */
const SOURCE_NAMES = {
  domestic_electricity_zero_vat: "zero VAT on electricity",
  fuel_duty_rise_deferral: "the fuel duty deferral",
  road_fuel_vat_cut: "the VAT cut on road fuel",
  state_pension_income_tax_protection: "State Pension tax protection",
  plan_2_threshold_unfreeze: "the Plan 2 threshold unfreeze",
  threshold_freeze_2031_32: "the threshold freeze",
  warm_home_discount_top_up: "the Warm Home Discount top-up",
  employer_ni_relief_under_25s: "employer NI relief",
  badr_lifetime_limit_cut: "the Business Asset Disposal Relief cut",
};
// A short name where there is one, else the catalogue's published name
const sourceName = (id, catalogue) => SOURCE_NAMES[id] ?? catalogue?.byId.get(id)?.name ?? id;

/** "+£88", "−£12" or "£0", from whole pounds. */
export const signedMoney = (value) => {
  const rounded = Math.round(value);
  return rounded === 0 ? "£0" : `${rounded > 0 ? "+" : MINUS}${money(Math.abs(rounded))}`;
};
const tone = (value) => (Math.round(value) > 0 ? "is-gain" : Math.round(value) < 0 ? "is-loss" : "is-none");

/**
 * What one example's card shows for `year`, from the precomputed results
 * (householdPresets.js presetChanges): its change in net income, the
 * change in each year for the sparkline, its own measures' part (on its
 * tag) and, when another measure gives more of it than its own, that one.
 */
export function cardFigures(example, byYear, year, catalogue = null) {
  const current = byYear?.[year];
  if (!current) return null;
  const own = example.measures ?? [example.measure];
  const ownPart = own.reduce((sum, id) => sum + (current.byPolicy[id] ?? 0), 0);
  // The measure giving the largest part of the change, if not its own
  const [mainId, mainPart] = Object.entries(current.byPolicy).reduce(
    (best, entry) => (Math.abs(entry[1]) > Math.abs(best[1]) ? entry : best),
    [null, 0],
  );
  const source =
    mainId && !own.includes(mainId) && Math.round(mainPart) !== 0 && Math.abs(mainPart) > Math.abs(ownPart)
      ? { name: sourceName(mainId, catalogue), part: mainPart }
      : null;
  const series = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b)
    .map((y) => ({ year: y, change: byYear[y].change }));
  return { change: current.change, ownPart, source, series };
}

/** The change in each year as small bars, the year chosen in full colour. */
function Sparkline({ series, year }) {
  const max = Math.max(1, ...series.map((point) => Math.abs(point.change)));
  const hasLoss = series.some((point) => point.change < 0);
  const width = series.length * 9 - 3;
  const height = 26;
  const zero = hasLoss ? height / 2 : height;
  const scale = (hasLoss ? height / 2 : height) / max;
  return (
    <svg
      className="household-card-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {series.map((point, index) => {
        const size = Math.max(1.5, Math.abs(point.change) * scale);
        return (
          <rect
            key={point.year}
            className={`${tone(point.change)} ${point.year === year ? "is-current" : ""}`.trim()}
            x={index * 9}
            y={point.change >= 0 ? zero - size : zero}
            width={6}
            height={size}
            rx={1.5}
          />
        );
      })}
    </svg>
  );
}

/**
 * The Household impact view's eight cards, all the same size: "Your
 * household", which opens the form below them, then the seven examples,
 * each of which fills the form and shows its result at once. Each example
 * names who it is and, on its tag, the measure it is for, in that
 * measure's colour. Once the precomputed results are in and every measure
 * is selected, it shows its change in net income in the year chosen, a
 * bar for each year, the part its own measure gives (on the tag) and, when
 * another measure gives more, which one.
 *
 * @param {Object} props
 * @param {Array} props.examples - householdExamples.js's HOUSEHOLD_EXAMPLES
 * @param {string|null} props.value - The example the form holds, while unedited
 * @param {boolean} props.formOpen - Whether the form is open below the cards
 * @param {string} props.formId - The form panel's id, for aria-controls
 * @param {() => void} props.onYours - "Your household" pressed
 * @param {(id: string) => void} props.onChoose - An example pressed
 * @param {Object|null} props.presets - presetChanges' map, or null to show no figures
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
  yoursChange = null,
  year,
  chosen = false,
  yoursSelected = false,
}) {
  const catalogue = useMeasureCatalogue();
  const anyFigures = presets !== null && examples.some((example) => presets[example.id]?.[year]);
  // Folded into the strip once a household is chosen; "Show all
  // households" opens the grid again, and a choice there folds it
  const [showAll, setShowAll] = useState(false);
  const folded = chosen && !showAll;
  const choose = (action) => {
    setShowAll(false);
    action();
  };
  return (
    <section className={`household-cards ${folded ? "is-folded" : ""}`.trim()} aria-labelledby="household-cards-title">
      <div className="household-cards-head">
        <h2 className="household-cards-title" id="household-cards-title">
          {/* The section icon every tab's headings carry (SectionHeading) */}
          <span className="section-icon" aria-hidden="true">
            <TitleIcon name="users" bare size={20} />
          </span>
          Choose a household
        </h2>
        {chosen && (
          <button
            type="button"
            className="household-cards-toggle"
            aria-expanded={!folded}
            aria-controls="household-cards-grid"
            onClick={() => setShowAll((open) => !open)}
          >
            <LayoutGrid size={14} strokeWidth={2} aria-hidden="true" />
            {folded ? "Show all households" : "Show fewer"}
          </button>
        )}
      </div>
      <HouseholdStrip
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
      <p className="household-cards-subtitle">
        Enter your own, or start from an example.
        {anyFigures &&
          ` Figures are the change in net income in ${fiscalYearTick(year)} with every measure; the bars show each year.`}
      </p>
      <div className="household-cards-grid" id="household-cards-grid">
        <button
          type="button"
          className={`household-card is-yours ${yoursSelected ? "is-selected" : ""} ${formOpen ? "is-open" : ""}`.replace(/\s+/g, " ").trim()}
          style={{ "--i": 0 }}
          aria-pressed={yoursSelected}
          aria-controls={formId}
          onClick={() => choose(onYours)}
        >
          <span className="household-card-icon" aria-hidden="true">
            <House size={22} strokeWidth={1.8} />
          </span>
          <span className="household-card-name">Your household</span>
          {/* After the name, so the card's name starts with it: a tick once
              chosen, as on the examples, else "Start here" */}
          {yoursSelected ? (
            <span className="household-card-check" aria-hidden="true">
              <Check size={14} strokeWidth={2.6} />
            </span>
          ) : (
            <span className="household-card-badge">Start here</span>
          )}
          {Number.isFinite(yoursChange) ? (
            <span className="household-card-result">
              <span className={`household-card-figure ${tone(yoursChange)}`}>
                {Math.round(yoursChange) === 0 ? "No change" : signedMoney(yoursChange)}
                {Math.round(yoursChange) !== 0 && <span className="household-card-figure-unit"> a year</span>}
              </span>
            </span>
          ) : (
            <span className="household-card-result">
              <span className="household-card-figure is-muted">Your result after Calculate</span>
            </span>
          )}
          <span className="household-card-source" />
          <span className="household-card-description">Every answer starts at a typical value</span>
          <span className="household-card-tag is-start">
            {formOpen ? "Hide your answers" : "Enter your answers"}
            <ChevronDown className="household-card-chevron" size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
        {examples.map((example, index) => {
          const Icon = EXAMPLE_ICONS[example.icon] ?? House;
          const figures = presets ? cardFigures(example, presets[example.id], year, catalogue) : null;
          const featured = featuresPublished(example, catalogue);
          const pressed = value === example.id;
          return (
            <button
              key={example.id}
              type="button"
              className="household-card"
              aria-pressed={pressed}
              onClick={() => choose(() => onChoose(example.id))}
              style={{ "--card-accent": featured ? catalogue.byId.get(example.measure).color : undefined, "--i": index + 1 }}
            >
              <span className="household-card-icon" aria-hidden="true">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <span className="household-card-name">{example.label}</span>
              {pressed && (
                <span className="household-card-check" aria-hidden="true">
                  <Check size={14} strokeWidth={2.6} />
                </span>
              )}
              <span className="household-card-result">
                {figures ? (
                  <>
                    <span className={`household-card-figure ${tone(figures.change)}`}>
                      {Math.round(figures.change) === 0 ? "No change" : signedMoney(figures.change)}
                      {Math.round(figures.change) !== 0 && <span className="household-card-figure-unit"> a year</span>}
                    </span>
                    <Sparkline series={figures.series} year={year} />
                  </>
                ) : (
                  <span className="household-card-pending">Calculated when chosen</span>
                )}
              </span>
              <span className="household-card-source">
                {figures?.source && `${signedMoney(figures.source.part)} from ${figures.source.name}`}
              </span>
              <span className="household-card-description">{example.description}</span>
              {featured && (
                <span className="household-card-tag">
                  <span className="household-card-dot" aria-hidden="true" />
                  <span className="household-card-tag-name">{example.tag}</span>
                  {figures && <span className="household-card-tag-part">{signedMoney(figures.ownPart)}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>
      </div>
    </section>
  );
}

/**
 * The cards folded: a chip for each card, in the cards' order and grid,
 * each its icon, a short name and its change, the chosen one in its
 * colour with a tick. One listbox, Your household first (choosing it
 * opens the form, which it controls; choosing it again while chosen
 * closes or reopens the form): the arrow keys (and Home, End) move between
 * chips, Enter or Space chooses one, a click chooses it at once.
 */
function HouseholdStrip({ examples, value, presets, yoursChange, yoursSelected, formId, year, shown, onYours, onChoose }) {
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
                      <span className="household-chip-long">Your household</span>
                      <span className="household-chip-short">Yours</span>
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
