import {
  Armchair,
  BriefcaseBusiness,
  Car,
  ChevronDown,
  GraduationCap,
  HardHat,
  House,
  KeyRound,
  UsersRound,
} from "lucide-react";
import { POLICY_COLORS_BY_KEY } from "../../utils/policyConfig";
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
 * "+£88 a year", "−£12 a year" or "No change", from whole pounds; until
 * there is a figure, a muted note in its place, so every card keeps the
 * row and all are the same size.
 */
function Figure({ value, pending }) {
  if (!Number.isFinite(value)) {
    return <span className="household-card-figure is-pending">{pending}</span>;
  }
  const rounded = Math.round(value);
  const tone = rounded > 0 ? "is-gain" : rounded < 0 ? "is-loss" : "is-none";
  return (
    <span className={`household-card-figure ${tone}`}>
      {rounded === 0 ? (
        "No change"
      ) : (
        <>
          {rounded > 0 ? "+" : MINUS}
          {money(Math.abs(rounded))}
          <span className="household-card-figure-unit"> a year</span>
        </>
      )}
    </span>
  );
}

/**
 * The Household impact view's eight cards: "Your household", which opens
 * the form below them, then the seven examples, each of which fills the
 * form and shows its result at once. Each example names who it is and the
 * measure it is for, in that measure's colour, and, once the precomputed
 * results are in and every measure is selected, its change in net income
 * in the year chosen.
 *
 * @param {Object} props
 * @param {Array} props.examples - householdExamples.js's HOUSEHOLD_EXAMPLES
 * @param {string|null} props.value - The example the form holds, while unedited
 * @param {boolean} props.formOpen - Whether the form is open below the cards
 * @param {string} props.formId - The form panel's id, for aria-controls
 * @param {() => void} props.onYours - "Your household" pressed
 * @param {(id: string) => void} props.onChoose - An example pressed
 * @param {Object<string, number>|null} props.changes - Each example's change
 *   in net income in `year`, or null to show none
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
  changes,
  yoursChange = null,
  year,
}) {
  const yoursSelected = value === null && formOpen;
  return (
    <section className="household-cards" aria-labelledby="household-cards-title">
      <div className="household-cards-head">
        <h2 className="household-cards-title" id="household-cards-title">
          Choose a household
        </h2>
        <p className="household-cards-subtitle">
          Enter your own, or start from an example.
          {changes && ` Figures are the change in net income in ${fiscalYearTick(year)} with every measure.`}
        </p>
      </div>
      <div className="household-cards-grid">
        <button
          type="button"
          className={`household-card is-yours ${yoursSelected ? "is-selected" : ""}`.trim()}
          aria-expanded={formOpen}
          aria-controls={formId}
          onClick={onYours}
        >
          <span className="household-card-icon" aria-hidden="true">
            <House size={20} strokeWidth={1.8} />
          </span>
          <span className="household-card-name">Your household</span>
          <Figure value={yoursChange} pending="Your result after Calculate" />
          <span className="household-card-description">Every answer starts at a typical value</span>
          <span className="household-card-tag is-start">
            {formOpen ? "Your answers" : "Start here"}
            <ChevronDown className="household-card-chevron" size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
        {examples.map((example) => {
          const Icon = EXAMPLE_ICONS[example.icon] ?? House;
          const change = changes?.[example.id];
          return (
            <button
              key={example.id}
              type="button"
              className="household-card"
              aria-pressed={value === example.id}
              onClick={() => onChoose(example.id)}
              style={{ "--card-accent": POLICY_COLORS_BY_KEY[example.measure] }}
            >
              <span className="household-card-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.8} />
              </span>
              <span className="household-card-name">{example.label}</span>
              <Figure value={change} pending="Calculated when chosen" />
              <span className="household-card-description">{example.description}</span>
              <span className="household-card-tag">
                <span className="household-card-dot" aria-hidden="true" />
                {example.tag}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
