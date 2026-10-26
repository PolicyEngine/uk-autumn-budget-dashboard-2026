import { useEffect, useState } from "react";
import SourceLink from "./SourceLink";
import TitleIcon from "./TitleIcon";
import { HOUSEHOLD_EXAMPLES } from "../utils/householdExamples";
import { loadPresetChanges } from "../utils/householdPresets";
import { publishedEngine, useMeasureCatalogue } from "../utils/measureCatalogue";
import { signedMoney } from "../utils/singleYear";
import "./LandingPage.css";

// The example household whose result the Household impact box quotes: the
// first card on Household impact
const LANDING_EXAMPLE = HOUSEHOLD_EXAMPLES[0];

/** "A 22-year-old renting" -> "a 22-year-old renting" */
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The first example household's change in net income in `year`, with every
 * published measure, from the precomputed file Household impact's cards
 * read (one fetch, shared): "+£88 a year for a 22-year-old renting". Null
 * while loading, when the file does not answer it (another engine, other
 * measures) or when the selection is not every measure, which the figure
 * is for.
 */
function useHouseholdFigure(year, allSelected) {
  const catalogue = useMeasureCatalogue();
  const ids = catalogue.displayable.map((measure) => measure.id);
  const key = ids.join(",");
  const engine = catalogue.manifest ? publishedEngine(catalogue, ids) : null;
  const [changes, setChanges] = useState(null);
  useEffect(() => {
    if (!catalogue.manifest || !ids.length || !engine) return undefined;
    let live = true;
    loadPresetChanges({ policies: ids, expectedEngine: engine }).then((found) => {
      if (live) setChanges(found);
    });
    return () => {
      live = false;
    };
    // key stands for ids; the engine for its own JSON
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(engine), catalogue.manifest]);
  if (!allSelected || !LANDING_EXAMPLE) return null;
  const change = changes?.[LANDING_EXAMPLE.id]?.[year]?.change;
  if (!Number.isFinite(change)) return null;
  const who = lowerFirst(LANDING_EXAMPLE.label);
  return Math.round(change) === 0
    ? `No change for ${who}`
    : `${signedMoney(change)} a year for ${who}`;
}

/** One of the three boxes: a link that opens its view in place. */
function LandingBox({ tab, sub, icon, title, description, figure, onOpen }) {
  const href = `?${new URLSearchParams({ tab, ...(sub ? { sub } : {}) })}`;
  return (
    <li className="landing-box-item">
      <a
        className="landing-box"
        href={href}
        onClick={(event) => {
          // A new tab or window opens the address as usual
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(tab, sub);
        }}
      >
        <TitleIcon name={icon} size={22} className="landing-box-icon" />
        <span className="landing-box-title">{title}</span>
        <span className="landing-box-description">{description}</span>
        {figure && <span className="landing-box-figure">{figure}</span>}
        <span className="landing-box-arrow" aria-hidden="true">→</span>
      </a>
    </li>
  );
}

/**
 * The landing page, at the bare address only (utils/landing.js): what the
 * dashboard does, then three ways in. App.jsx renders it over the Public
 * finances view, faded and inert, so the page behind is the live one.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onOpen - Open a view (App's handleTabChange)
 * @param {number} props.year - The band's year
 * @param {boolean} props.allSelected - Whether every published measure is selected
 * @param {string|null} props.financesFigure - Net revenue in the year (netRevenueFigure)
 * @param {string|null} props.measuresFigure - "9 measures" (measureCountFigure)
 * @param {React.ReactNode} [props.provisional] - The provisional notice, when it applies
 */
export default function LandingPage({ onOpen, year, allSelected, financesFigure, measuresFigure, provisional }) {
  const householdFigure = useHouseholdFigure(year, allSelected);
  return (
    <section className="landing" aria-labelledby="landing-heading">
      <h2 id="landing-heading" className="visually-hidden">Start here</h2>
      <p className="landing-intro">
        This dashboard uses <SourceLink source="policyengine_uk_model" /> to
        show how Autumn Budget 2026 measures would affect the public
        finances and households: by income, area and age, and
        for your own household, alongside the OBR forecast.
        Costings are our own; forecast:{" "}
        <SourceLink source="obr_efo_current" />.
      </p>
      {provisional}
      <ul className="landing-boxes">
        <LandingBox
          tab="dashboard"
          sub="finances"
          icon="users"
          title="What this Budget means for society"
          description="The public finances, and who gains and loses by income, area and age."
          figure={financesFigure}
          onOpen={onOpen}
        />
        <LandingBox
          tab="household"
          icon="house"
          title="What it means for your household"
          description="Enter your household, or start from an example, to see your change in income."
          figure={householdFigure}
          onOpen={onOpen}
        />
        <LandingBox
          tab="policies"
          icon="list"
          title="What is in this Budget"
          description="What each measure changes, when, and how it is modelled."
          figure={measuresFigure}
          onOpen={onOpen}
        />
      </ul>
    </section>
  );
}
