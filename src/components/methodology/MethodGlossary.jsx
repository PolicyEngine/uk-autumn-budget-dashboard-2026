import {
  Banknote,
  CalendarClock,
  ChartColumnBig,
  GitCompare,
  House,
  LifeBuoy,
  Pause,
  Percent,
  PoundSterling,
  Scale,
  Sigma,
  UserCheck,
  Users,
} from "lucide-react";
import FactList from "./FactList";
import { GLOSSARY, glossaryAnchor } from "./glossary";
import { SourceLink } from "./MethodUi";

const ICONS = {
  netIncome: PoundSterling,
  housingCosts: House,
  equivalised: Users,
  median: Sigma,
  incomeGroups: ChartColumnBig,
  real: Banknote,
  points: Percent,
  absolutePoverty: LifeBuoy,
  gini: Scale,
  perPerson: UserCheck,
  ownRuns: GitCompare,
  static: Pause,
  benefitUnit: Users,
  statePensionAge: CalendarClock,
};

/** A meaning with each of its `sources` phrases linked to the source. */
function linked(meaning, sources = {}) {
  const phrases = Object.keys(sources);
  if (!phrases.length) return meaning;
  const escaped = phrases.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return meaning
    .split(new RegExp(`(${escaped.join("|")})`))
    .map((part, index) =>
      sources[part] ? (
        <SourceLink key={index} id={sources[part]}>
          {part}
        </SourceLink>
      ) : (
        part
      ),
    );
}

/**
 * The terms the charts share, each defined here once (glossary.js); each
 * term carries its own anchor, which a card's "About this chart" links to.
 */
export default function MethodGlossary() {
  return (
    <div id="method-terms" className="card method-card method-anchor">
      <h3 className="method-card-title">Terms used on the charts</h3>
      <FactList
        className="method-glossary"
        items={Object.entries(GLOSSARY).map(([key, { term, meaning, sources }]) => [
          <span key={key} id={glossaryAnchor(key)} className="method-anchor">
            {term}
          </span>,
          <>{linked(meaning, sources)}</>,
          ICONS[key] ?? ChartColumnBig,
        ])}
      />
    </div>
  );
}
