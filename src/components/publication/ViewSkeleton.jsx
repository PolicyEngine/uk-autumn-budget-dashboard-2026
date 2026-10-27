import TitleIcon from "../TitleIcon";
import { TAB_ICONS } from "../ViewTabs";
import { BOOT_SUBS, BOOT_TABS } from "../../utils/bootView";
import "./publication.css";

/**
 * A view's placeholder while its results load: the view's own sub-tab row,
 * its section heading and grey cards in the shape of its charts (a title,
 * a pill, axes), with a "Loading results…" caption. Never a number. The
 * server's HTML carries one for every view (BootSkeleton), and the address
 * picks which shows (utils/bootView.js), so it paints before the page's
 * code runs.
 */

// The views' sub-tabs as their rows draw them (PopulationImpactView's
// POPULATION_SUB_TABS, LivingStandardsTab's OUTLOOK_SUB_TABS; a test keeps
// them in step). Copied, not imported, so the placeholder needs neither view.
export const SKELETON_SUB_TABS = {
  dashboard: [
    { value: "finances", label: "Public finances", icon: "landmark" },
    { value: "all", label: "All households", icon: "users" },
    { value: "age", label: "By age", icon: "usersRound" },
    { value: "living", label: "Living standards", icon: "coins" },
    { value: "poverty", label: "Poverty", icon: "percent" },
  ],
  outlook: [
    { value: "living", label: "Living standards", icon: "coins" },
    { value: "poverty", label: "Poverty", icon: "percent" },
    { value: "forecast", label: "Forecast changes", icon: "trend" },
    { value: "vintages", label: "Forecast vintages", icon: "clock" },
  ],
};
const SUB_TABS = SKELETON_SUB_TABS;

// Each view's first section and the shape of its cards: "bars", "lines",
// "map", "example" (Household impact's example households) or "text"
const LAYOUTS = {
  "dashboard:finances": [
    { icon: "banknote", title: "Public finances", subtitle: "Net effect of the selected policies on government revenue and spending, by year.", cards: [["bars", "wide"], ["bars"], ["bars"]] },
  ],
  "dashboard:all": [
    { icon: "compass", title: "By area", subtitle: "Average change in household income in each parliamentary constituency.", cards: [["map", "wide"]] },
    { icon: "wallet", title: "By income", subtitle: "How the change differs between lower- and higher-income households.", cards: [["bars"], ["bars"]] },
  ],
  "dashboard:age": [
    { icon: "usersRound", title: "How much each age group gains", cards: [["lines", "wide"], ["bars"], ["bars"]] },
  ],
  "dashboard:living": [
    { icon: "wallet", title: "How the measures change incomes", subtitle: "With the selected measures: how they change income growth across the income distribution.", cards: [["lines", "wide"]] },
  ],
  "dashboard:poverty": [
    { icon: "lifebuoy", title: "How the measures change poverty", subtitle: "With the selected measures.", cards: [["bars"], ["bars"]] },
  ],
  household: [
    { icon: "users", title: "Choose a household", subtitle: "Enter your own household, or start from an example below.", cards: Array.from({ length: 8 }, () => ["example"]) },
  ],
  "outlook:living": [
    { icon: "wallet", title: "Living standards under current law", subtitle: "Current law, before any Budget measure.", cards: [["lines", "wide"], ["lines"], ["lines"]] },
  ],
  "outlook:poverty": [
    { icon: "lifebuoy", title: "Poverty under current law", subtitle: "Current law, before any Budget measure.", cards: [["lines"], ["lines"]] },
  ],
  "outlook:forecast": [
    { icon: "trend", title: "Economic forecast", cards: [["lines", "wide"], ["lines"], ["lines"]] },
  ],
  // The view's own heading has the forecasts' dates, which a placeholder
  // leaves out
  "outlook:vintages": [
    { title: "OBR forecasts beside the outturn", subtitle: "The OBR's forecasts beside the ONS outturn. These are the OBR's and the ONS's figures, not PolicyEngine's.", cards: [["lines", "wide"]] },
  ],
  policies: [
    { icon: "fileText", title: "Policies", subtitle: "What each measure changes, when, and how it is modelled.", cards: [["text", "wide"], ["text", "wide"], ["text", "wide"]] },
  ],
  methodology: [
    { icon: "book", title: "Methodology", cards: [["text", "wide"], ["text", "wide"]] },
  ],
};

/** Every view's key, as bootView reads an address. */
export const SKELETON_VIEWS = Object.freeze(
  BOOT_TABS.flatMap((tab) => (BOOT_SUBS[tab] ? BOOT_SUBS[tab].map((sub) => `${tab}:${sub}`) : [tab])),
);

// Faint axes and gridlines, and a hint of the chart's marks
function PlotShape({ kind }) {
  if (kind === "map") {
    return (
      <svg className="skeleton-shape" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {Array.from({ length: 11 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => {
            // A rough island of hexes, wider in the south
            const half = 1.5 + row * 0.35;
            if (Math.abs(col - 4) > half) return null;
            return <circle key={`${row}-${col}`} cx={140 + col * 14 + (row % 2) * 7} cy={40 + row * 22} r={6} />;
          }),
        )}
      </svg>
    );
  }
  const grid = [40, 90, 140, 190].map((y) => <line key={y} className="skeleton-grid" x1="40" x2="390" y1={y} y2={y} />);
  return (
    <svg className="skeleton-shape" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
      {grid}
      <line className="skeleton-axis" x1="40" x2="390" y1="215" y2="215" />
      <line className="skeleton-axis" x1="40" x2="40" y1="25" y2="215" />
      {kind === "bars" &&
        [70, 110, 150, 120, 160, 95].map((height, index) => (
          <rect key={index} x={62 + index * 54} y={215 - height} width="30" height={height} rx="2" />
        ))}
      {kind === "lines" && <polyline points="45,170 110,150 175,155 240,120 305,105 385,80" />}
    </svg>
  );
}

function CardSkeleton({ kind, wide = false }) {
  if (kind === "example") {
    return (
      <div className="skeleton-card is-example" aria-hidden="true">
        <span className="skeleton-dot" />
        <span className="skeleton-line is-title" />
        <span className="skeleton-row">
          <span className="skeleton-line is-figure" />
          <svg className="skeleton-shape is-spark" viewBox="0 0 80 34" aria-hidden="true">
            {[18, 8, 8, 8, 14].map((height, index) => <rect key={index} x={index * 16} y={34 - height} width="12" height={height} rx="1" />)}
          </svg>
        </span>
        <span className="skeleton-line is-subtitle" />
      </div>
    );
  }
  return (
    <div className={`skeleton-card${wide ? " is-wide" : ""}`} aria-hidden="true">
      <span className="skeleton-head">
        <span className="skeleton-line is-title" />
        <span className="skeleton-pill" />
      </span>
      {kind === "text" ? (
        <span className="skeleton-text">
          {[92, 86, 95, 60].map((width, index) => <span key={index} className="skeleton-line" style={{ width: `${width}%` }} />)}
        </span>
      ) : (
        <PlotShape kind={kind} />
      )}
    </div>
  );
}

// The page's view tab bar as it will be, the linked view chosen: the real
// one stays hidden until the page's code opens the view
function StaticViewTabs({ tabs, tab }) {
  return (
    <div className={`view-tabs-bar boot-view-tabs${SUB_TABS[tab] ? " has-notch" : ""}`} aria-hidden="true">
      <div className="view-tabs">
        {tabs.map((item) => (
          <span key={item.value} className="view-tab" aria-selected={item.value === tab ? "true" : "false"}>
            <TitleIcon name={TAB_ICONS[item.value]} bare size={18} className="view-tab-icon" />
            <span className="view-tab-label">{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StaticSubTabs({ tab, sub }) {
  const tabs = SUB_TABS[tab];
  if (!tabs) return null;
  return (
    <div className="sub-tabs-band skeleton-sub-tabs" aria-hidden="true">
      <div className="sub-tabs">
        {tabs.map((item) => (
          <span key={item.value} className="sub-tab" aria-selected={item.value === sub ? "true" : "false"}>
            {item.icon && <TitleIcon name={item.icon} bare size={16} className="sub-tab-icon" />}
            <span className="sub-tab-label">{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One view's placeholder. `view` is "tab:sub" or "tab" (bootView).
 * `subTabs` draws the view's sub-tab row too, where the real one is not
 * yet on the page.
 */
export default function ViewSkeleton({ view, subTabs = true, caption = true, viewTabs = null }) {
  const [tab, sub] = view.split(":");
  const sections = LAYOUTS[view] ?? LAYOUTS["dashboard:finances"];
  return (
    <div className="skeleton-view" data-view={view}>
      {viewTabs && <StaticViewTabs tabs={viewTabs} tab={tab} />}
      {subTabs && <StaticSubTabs tab={tab} sub={sub} />}
      {caption && (
        <p className="skeleton-caption" role="status" aria-live="polite">
          <span className="skeleton-spinner" aria-hidden="true" />
          Loading results…
        </p>
      )}
      {sections.map((section) => (
        <section key={section.title} className="skeleton-section">
          <div className={`section-heading${section.icon ? " has-icon" : ""}`}>
            {section.icon && (
              <span className="section-icon" aria-hidden="true">
                <TitleIcon name={section.icon} bare size={18} />
              </span>
            )}
            <div className="section-heading-text">
              <div className="section-heading-title">
                <h2>{section.title}</h2>
              </div>
              {section.subtitle && <p>{section.subtitle}</p>}
            </div>
          </div>
          <div className={`skeleton-grid${section.cards[0][0] === "example" ? " is-examples" : ""}`}>
            {section.cards.map(([kind, wide], index) => <CardSkeleton key={index} kind={kind} wide={wide === "wide"} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Every view's placeholder in the server's HTML; the address shows one
 * (html[data-boot-view], publication.css) before the page's code runs.
 */
export function BootSkeleton({ viewTabs }) {
  return (
    <div className="boot-skeleton">
      {SKELETON_VIEWS.map((view) => (
        <div key={view} className="boot-variant" data-boot-variant={view}>
          <ViewSkeleton view={view} viewTabs={viewTabs} />
        </div>
      ))}
    </div>
  );
}
