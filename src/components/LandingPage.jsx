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
      <h2 id="landing-heading" className="landing-heading">What Autumn Budget 2026 means</h2>
      <p className="landing-intro">
        This dashboard uses <SourceLink source="policyengine_uk_model" /> to
        show how Autumn Budget 2026 measures would affect the public
        finances and households: by income, area and age, and
        for your own household, alongside the outlook before the Budget.
        Costings are our own; forecast:{" "}
        <SourceLink source="obr_efo_current" />.
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
