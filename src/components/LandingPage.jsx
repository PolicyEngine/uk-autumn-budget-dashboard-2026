import SourceLink from "./SourceLink";
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
 * The landing page, at the bare address only (utils/landing.js): what the
 * dashboard does, then three ways in. App.jsx renders it over the Public
 * finances view, faded and inert, so the page behind is the live one.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onOpen - Open a view (App's handleTabChange)
 * @param {React.ReactNode} [props.provisional] - The provisional notice, when it applies
 */
export default function LandingPage({ onOpen, provisional }) {
  return (
    <section className="landing" aria-labelledby="landing-heading">
      <div className="landing-hero">
      <p className="landing-eyebrow">PolicyEngine UK</p>
      <h2 id="landing-heading" className="landing-heading">Autumn Budget 2026: fiscal and distributional analysis</h2>
      <p className="landing-intro">
        Estimates from <SourceLink source="policyengine_uk_model" />{" "}of how
        Autumn Budget 2026 measures affect the public finances and household
        incomes across the income distribution, regions and age groups, set
        against the pre-measures forecast. Costings are our own; the economic
        forecast is the OBR&rsquo;s{" "}
        <SourceLink source="obr_efo_current">Economic and fiscal outlook, March 2026</SourceLink>.
      </p>
      {provisional}
      </div>
      <ul className="landing-boxes">
        <LandingBox
          tab="dashboard"
          sub="finances"
          icon="users"
          title="The Budget and society"
          description="Public finances, and who gains and loses"
          onOpen={onOpen}
        />
        <LandingBox
          tab="household"
          icon="house"
          title="Your household"
          description="See how your income changes"
          onOpen={onOpen}
        />
        <LandingBox
          tab="policies"
          icon="list"
          title="What's in the Budget"
          description="Every measure, and how we model it"
          onOpen={onOpen}
        />
      </ul>
    </section>
  );
}
