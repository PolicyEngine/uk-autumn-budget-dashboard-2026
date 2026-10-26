import { useEffect, useState } from "react";
import Tip from "./Tip";
import tealMark from "@/assets/policyengine-teal-square.svg";
import mark from "@/assets/policyengine-white-square.svg";
import "./HomeButton.css";

/**
 * PolicyEngine's mark, left of the band's title: decoration only, not a
 * control. The way to the overview is the rail button (EdgeAboutTab) and
 * its drawer, which also leads back to the start.
 */
export default function TitleMark() {
  return <Mark className="title-mark" hidden />;
}

/** PolicyEngine's square mark (@policyengine/ui-kit's white-square.svg). */
function Mark({ className, hidden = false }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.src ?? mark} alt="" className={className} aria-hidden={hidden ? "true" : undefined} />;
}

/** The edge tab's card: what the dashboard is, and what a click does. */
function AboutTip({ hint }) {
  return (
    <span className="home-tip">
      <span className="home-tip-title">About this dashboard</span>
      <span>Our estimates of how Autumn Budget 2026 changes the public finances and household incomes.</span>
      <span className="home-tip-hint">{hint}</span>
    </span>
  );
}

// Set once the edge tab's attention cue has played this session
const CUE_KEY = "ab2026-about-cue";

/**
 * The "About" pill at the start of the view tabs row (App.jsx passes it
 * to ViewTabs as `leading`; it is not on the landing page): the card on
 * hover or focus, and a click that opens the overview drawer
 * (OverviewDrawer.jsx); hidden while the drawer is open. It pulses softly
 * once per session (not under reduced motion); on a phone it is a circle
 * with the mark alone.
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the overview drawer is open
 * @param {() => void} props.onToggle - Open or close it
 * @param {{current: HTMLElement|null}} [props.buttonRef] - The button, for focus to come back to
 */
export function EdgeAboutTab({ open, onToggle, buttonRef }) {
  const [cue, setCue] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = window.sessionStorage.getItem(CUE_KEY) === "1";
      window.sessionStorage.setItem(CUE_KEY, "1");
    } catch {
      // no storage: no cue
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after the first render
    if (!seen) setCue(true);
  }, []);
  return (
    <Tip content={<AboutTip hint="Click to open the overview." />}>
      <button
        ref={buttonRef}
        type="button"
        className={`edge-about${cue ? " is-cue" : ""}`}
        aria-label="About this dashboard: open the overview"
        aria-expanded={open}
        aria-controls="overview-drawer"
        onClick={onToggle}
      >
        <span className="edge-about-pill">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tealMark.src ?? tealMark} alt="" className="edge-about-mark" />
          <span className="edge-about-label" aria-hidden="true">About</span>
        </span>
      </button>
    </Tip>
  );
}
