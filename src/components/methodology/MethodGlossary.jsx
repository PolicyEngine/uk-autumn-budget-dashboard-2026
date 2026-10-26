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
        items={Object.entries(GLOSSARY).map(([key, { term, meaning }]) => [
          <span key={key} id={glossaryAnchor(key)} className="method-anchor">
            {term}
          </span>,
          meaning,
          ICONS[key] ?? ChartColumnBig,
        ])}
      />
    </div>
  );
}
