import SourceLink from "./SourceLink";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import TitleIcon from "./TitleIcon";
import "./LandingPage.css";

/** One of the three boxes: a link that opens its view in place. */
function LandingBox({ tab, sub, icon, title, description, onOpen }) {
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
        <svg className="landing-box-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
        <TitleIcon name={icon} size={24} className="landing-box-icon" />
        <span className="landing-box-title">{title}</span>
        <span className="landing-box-description">{description}</span>
        <span className="landing-box-explore">
          Explore<span className="landing-box-arrow" aria-hidden="true">→</span>
        </span>
      </a>
    </li>
  );
}

/**
 * The three ways in, in order: [tab, sub, icon, title, line]. While the
 * measures are provisional, the policies box names them as modelled
 * measures, not the Budget's contents.
 */
const boxes = (provisional) => [
  ["dashboard", "finances", "users", "The Budget and society", "Costs and who gains or loses"],
  ["household", undefined, "house", "Your household", "See how your income changes"],
  ["policies", undefined, "list", provisional ? "The policies modelled" : "What's in the Budget", "Every policy, and how we model it"],
];

/**
 * What the dashboard is: the heading (its id given, as the
 * landing page and the overview drawer each name themselves by it), the
 * paragraph and the provisional notice. One source for both.
 */
export function LandingIntro({ headingId, provisional, className = "landing-hero" }) {
  return (
    <div className={className}>
      <h2 id={headingId} className="landing-heading">Autumn Budget 2026: fiscal and distributional analysis</h2>
      <p className="landing-intro">
        Estimates from <SourceLink source="policyengine_uk_model" />{" "}of how
        Autumn Budget 2026 policies affect the public finances and household
        incomes across the income distribution, regions and age groups, set
        against the pre-measures forecast. Costings are our own; the economic
        forecast is the OBR&rsquo;s{" "}
        <SourceLink source="obr_efo_current">Economic and fiscal outlook, March 2026</SourceLink>.
      </p>
      {provisional}
    </div>
  );
}

/** A way in as a row of a list (the overview drawer): the whole row is the link. */
function LandingRow({ tab, sub, icon, title, description, onOpen }) {
  const href = `?${new URLSearchParams({ tab, ...(sub ? { sub } : {}) })}`;
  return (
    <li>
      <a
        className="landing-row"
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(tab, sub);
        }}
      >
        <TitleIcon name={icon} size={18} className="landing-row-icon" />
        <span className="landing-row-text">
          <span className="landing-row-title">{title}</span>
          <span className="landing-row-description">{description}</span>
        </span>
        <ChevronRight className="landing-row-chevron" size={18} strokeWidth={2} aria-hidden="true" />
      </a>
    </li>
  );
}

/**
 * The three ways in: boxes side by side (the landing page), or a list of
 * rows (`list`, the overview drawer), labelled by `labelledBy`.
 */
export function LandingBoxes({ onOpen, list = false, labelledBy, provisional = false }) {
  const BOXES = boxes(provisional);
  if (list) {
    return (
      <ul className="landing-rows" aria-labelledby={labelledBy}>
        {BOXES.map(([tab, sub, icon, title, description]) => (
          <LandingRow key={tab} tab={tab} sub={sub} icon={icon} title={title} description={description} onOpen={onOpen} />
        ))}
        {/* The PolicyEngine website, in a new tab */}
        <li>
          <a className="landing-row" href="https://policyengine.org/uk" target="_blank" rel="noopener noreferrer">
            <TitleIcon name="compass" size={18} className="landing-row-icon" />
            <span className="landing-row-text">
              <span className="landing-row-title">PolicyEngine</span>
              <span className="landing-row-description">More research, the model and the API</span>
            </span>
            <span className="visually-hidden"> (opens in a new tab)</span>
            <ArrowUpRight className="landing-row-chevron" size={18} strokeWidth={2} aria-hidden="true" />
          </a>
        </li>
      </ul>
    );
  }
  return (
    <ul className="landing-boxes">
      {BOXES.map(([tab, sub, icon, title, description]) => (
        <LandingBox key={tab} tab={tab} sub={sub} icon={icon} title={title} description={description} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/**
 * The landing page, at the bare address only (utils/landing.js): what the
 * dashboard does, then three ways in, over a silhouette of the Public
 * finances view (App.jsx).
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onOpen - Open a view (App's handleTabChange)
 * @param {React.ReactNode} [props.provisional] - The provisional notice, when it applies
 * @param {boolean} [props.provisionalWording] - Whether the measures are provisional (the boxes' wording)
 */
export default function LandingPage({ onOpen, provisional, provisionalWording = false }) {
  return (
    <section className="landing" aria-labelledby="landing-heading">
      <LandingIntro headingId="landing-heading" provisional={provisional} />
      <LandingBoxes onOpen={onOpen} provisional={provisionalWording} />
    </section>
  );
}
