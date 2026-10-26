import {
  Armchair,
  BriefcaseBusiness,
  Car,
  Check,
  ChevronDown,
  GraduationCap,
  HardHat,
  House,
  KeyRound,
  UsersRound,
} from "lucide-react";
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
}) {
  const catalogue = useMeasureCatalogue();
  // A card's measure only while the catalogue publishes it (#104)
  const published = (id) => catalogue.byId.get(id)?.displayable === true;
  const yoursSelected = value === null && formOpen;
  const anyFigures = presets !== null && examples.some((example) => presets[example.id]?.[year]);
  return (
    <section className="household-cards" aria-labelledby="household-cards-title">
      <div className="household-cards-head">
        <h2 className="household-cards-title" id="household-cards-title">
          Choose a household
        </h2>
        <p className="household-cards-subtitle">
          Enter your own, or start from an example.
          {anyFigures &&
            ` Figures are the change in net income in ${fiscalYearTick(year)} with every measure; the bars show each year.`}
        </p>
      </div>
      <div className="household-cards-grid">
        <button
          type="button"
          className={`household-card is-yours ${yoursSelected ? "is-selected" : ""}`.trim()}
          style={{ "--i": 0 }}
          aria-expanded={formOpen}
          aria-controls={formId}
          onClick={onYours}
        >
          <span className="household-card-icon" aria-hidden="true">
            <House size={22} strokeWidth={1.8} />
          </span>
          <span className="household-card-name">Your household</span>
          {/* After the name, so the card's name starts with it */}
          <span className="household-card-badge">Start here</span>
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
          const featured = published(example.measure);
          const pressed = value === example.id;
          return (
            <button
              key={example.id}
              type="button"
              className="household-card"
              aria-pressed={pressed}
              onClick={() => onChoose(example.id)}
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
    </section>
  );
}
