import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import mark from "@/assets/policyengine-white-square.svg";
import "./HomeButton.css";

/** Where the band's mark leads: PolicyEngine's UK home page */
export const POLICYENGINE_HOME = "https://policyengine.org/uk";

/**
 * PolicyEngine's mark, left of the band's title: a link to PolicyEngine's
 * home page, in the same tab, as the site header's logo is. The way to
 * the dashboard's overview is the About tab (EdgeAboutTab) and its drawer.
 */
export default function TitleMark() {
  return (
    <a href={POLICYENGINE_HOME} className="title-mark-link" aria-label="PolicyEngine home">
      <Mark className="title-mark" hidden />
    </a>
  );
}

/** PolicyEngine's square mark (@policyengine/ui-kit's white-square.svg). */
function Mark({ className, hidden = false }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.src ?? mark} alt="" className={className} aria-hidden={hidden ? "true" : undefined} />;
}

// Set once the edge tab's attention cue has played this session
const CUE_KEY = "ab2026-about-cue";

/**
 * "About", a side tab on the window's left edge (App.jsx; it is not on the
 * landing page): the title band's teal, its label written upwards under a
 * panel icon, with no hover card. A click opens the overview drawer
 * (OverviewDrawer.jsx), which slides out from the same edge; hidden while
 * the drawer is open. It pulses softly once per session (not under
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
    <button
      ref={buttonRef}
      type="button"
      className={`edge-about${cue ? " is-cue" : ""}`}
      aria-label="About this dashboard"
      aria-expanded={open}
      aria-controls="overview-drawer"
      onClick={onToggle}
    >
      <PanelLeftOpen className="edge-about-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <span className="edge-about-label" aria-hidden="true">About</span>
    </button>
  );
}
