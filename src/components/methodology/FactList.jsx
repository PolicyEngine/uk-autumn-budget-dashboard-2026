import {
  ArrowUpDown,
  Banknote,
  BookOpen,
  CalendarDays,
  CalendarRange,
  ChartColumnBig,
  ChartScatter,
  CircleAlert,
  ClipboardList,
  Cpu,
  Database,
  FileCheck,
  Gavel,
  GitCompare,
  HeartPulse,
  Map as MapIcon,
  Pause,
  Percent,
  PoundSterling,
  Scale,
  ShieldCheck,
  Sigma,
  TrendingUp,
  UserCheck,
  Users,
  Cake,
} from "lucide-react";

// An icon for each term the Methodology view defines, by its text
const TERM_ICONS = {
  Dataset: Database,
  Survey: ClipboardList,
  Weights: Scale,
  Projection: TrendingUp,
  "Small groups": Users,
  Model: Cpu,
  Baseline: Gavel,
  Static: Pause,
  Years: CalendarDays,
  "Budgetary impact": PoundSterling,
  Exceptions: CircleAlert,
  "Net impact": Sigma,
  "OBR comparison": GitCompare,
  "Income deciles": ChartColumnBig,
  "Absolute change": Banknote,
  "Relative change": Percent,
  "Poverty rate": Users,
  Inequality: Scale,
  "Which run": GitCompare,
  Map: MapIcon,
  "Household scatter bands": ChartScatter,
  "Gain, loss, no change": ArrowUpDown,
  Disclosure: ShieldCheck,
  "Sign-off": FileCheck,
  "Age bands": Users,
  "Single year of age": Cake,
  "Who counts": UserCheck,
  Pensioners: Users,
  "Change by year": CalendarRange,
  "Engine and measures": Cpu,
  "One year": CalendarDays,
  Salary: PoundSterling,
  "Change by policy": ChartColumnBig,
  "Marginal tax rate": Percent,
  "Every policy applied": ClipboardList,
  "Who counts as a child": Users,
  "Council Tax": Banknote,
  Income: PoundSterling,
  Tenths: ChartColumnBig,
  Distribution: ChartScatter,
  "Who moves": ArrowUpDown,
  "Among all households": Users,
  "Better or worse off": ArrowUpDown,
  Data: Database,
  Status: CircleAlert,
  Period: CalendarRange,
  Prices: PoundSterling,
  "UC health element": HeartPulse,
  Sources: BookOpen,
};

/**
 * What a term means: a plain node; { value, more } for a one-line value
 * with its detail folded under "Details"; or { lead, points } for a lead
 * line and one bullet per idea.
 */
function Description({ children }) {
  if (children && typeof children === "object" && "value" in children) {
    const more = (children.more || []).filter(Boolean);
    return (
      <>
        <span className="method-fact-value">{children.value}</span>
        {more.length > 0 && (
          <details className="method-fact-more">
            <summary>Details</summary>
            <ul className="method-points">
              {more.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }
  if (children && typeof children === "object" && "points" in children) {
    return (
      <>
        {children.lead && <p className="method-fact-lead">{children.lead}</p>}
        <ul className="method-points">
          {children.points.filter(Boolean).map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </>
    );
  }
  return children;
}

/**
 * A two-column fact grid for the Methodology view: a short term with its
 * icon on the left, what it means on the right; stacked on a phone. An
 * item's optional third element overrides the term's icon.
 *
 * @param {Object} props
 * @param {Array<[import("react").ReactNode, import("react").ReactNode | {value: import("react").ReactNode, more?: import("react").ReactNode[]} | {lead?: import("react").ReactNode, points: import("react").ReactNode[]}, import("react").ComponentType?]>} props.items
 * @param {string} [props.className]
 */
function FactList({ items, className = "" }) {
  return (
    <dl className={`method-facts ${className}`.trim()}>
      {items.map(([term, description, icon], index) => {
        const Icon = icon ?? (typeof term === "string" ? TERM_ICONS[term] : null);
        return (
          <div key={index} className="method-fact">
            <dt>
              {Icon && (
                <span className="method-fact-icon" aria-hidden="true">
                  <Icon strokeWidth={1.75} />
                </span>
              )}
              <span>{term}</span>
            </dt>
            <dd>
              <Description>{description}</Description>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default FactList;
