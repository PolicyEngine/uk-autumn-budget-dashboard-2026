import { useEffect, useState } from "react";
import Tip from "./Tip";
import { PanelLeftOpen } from "lucide-react";
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
 * "About", at the start of the view tabs row and styled as its tabs are
 * (App.jsx passes it to ViewTabs as `leading`; it is not on the landing
 * page), but a button, never a chosen tab: the card on hover or focus, and
 * a click that opens the overview drawer (OverviewDrawer.jsx); hidden
 * while the drawer is open. It pulses softly once per session (not under
 * reduced motion).
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
        className={`view-tab edge-about${cue ? " is-cue" : ""}`}
        aria-label="About this dashboard: open the overview"
        aria-expanded={open}
        aria-controls="overview-drawer"
        onClick={onToggle}
      >
        <PanelLeftOpen className="view-tab-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
        <span className="view-tab-label" aria-hidden="true">About</span>
      </button>
    </Tip>
  );
}
