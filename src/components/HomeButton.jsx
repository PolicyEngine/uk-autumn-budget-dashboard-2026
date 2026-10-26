import { useEffect, useRef, useState } from "react";
import Tip from "./Tip";
import { PanelLeftOpen } from "lucide-react";
import mark from "@/assets/policyengine-white-square.svg";
import tealMark from "@/assets/policyengine-teal-square.svg";
import "./HomeButton.css";

// The bare address: the landing page
const START = process.env.NEXT_PUBLIC_BASE_PATH || "/";

/**
 * The band's home link, left of the title: PolicyEngine's mark alone, back
 * to the landing page in place (a new tab or window opens the bare
 * address). On the landing page itself it is marked current and does
 * nothing. What the dashboard is, is the edge tab's (EdgeAboutTab).
 *
 * @param {Object} props
 * @param {boolean} props.current - Whether the landing page is shown
 * @param {() => void} props.onHome - Go to the landing page (App's goHome)
 */
export default function HomeButton({ current, onHome }) {
  return (
    <a
      href={START}
      className="home-button"
      aria-label="Back to the start"
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        if (!current) onHome();
      }}
    >
      <Mark className="home-button-mark" />
    </a>
  );
}

/** PolicyEngine's square mark (@policyengine/ui-kit's white-square.svg). */
function Mark({ className }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.src ?? mark} alt="" className={className} />;
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
 * An "About" tab pinned to the window's left edge on every view (App.jsx
 * leaves it off the landing page): a rail button in the view tabs bar's
 * left margin, the bar's own height, with the PolicyEngine mark and a
 * panel-open icon; the card names it on hover or focus, and a click
 * that opens the overview drawer (OverviewDrawer.jsx), or closes it. It
 * pulses softly once per session (not under reduced motion); on a narrow
 * screen it is the mark alone, and the bar makes room for it.
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the overview drawer is open
 * @param {() => void} props.onToggle - Open or close it
 * @param {{current: HTMLElement|null}} [props.buttonRef] - The button, for focus to come back to
 */
export function EdgeAboutTab({ open, onToggle, buttonRef }) {
  const own = useRef(null);
  // Level with the view tabs bar, centred on its height, wherever it is:
  // in the page at first, then stuck (and compact) under the band
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const bar = document.querySelector(".view-tabs-bar");
      if (!bar || !own.current) return;
      const box = bar.getBoundingClientRect();
      // Inside the bar's own top and bottom borders, its full height
      own.current.style.top = `${Math.round(box.top) + 1}px`;
      own.current.style.height = `${Math.round(box.height) - 2}px`;
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    const bar = document.querySelector(".view-tabs-bar");
    const observer = typeof ResizeObserver === "undefined" || !bar ? null : new ResizeObserver(later);
    observer?.observe(bar);
    return () => {
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
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
        ref={(node) => {
          own.current = node;
          if (buttonRef) buttonRef.current = node;
        }}
        type="button"
        className={`edge-about${cue ? " is-cue" : ""}`}
        aria-label="About this dashboard: open the overview"
        aria-expanded={open}
        aria-controls="overview-drawer"
        onClick={onToggle}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tealMark.src ?? tealMark} alt="" className="edge-about-mark" />
        <PanelLeftOpen className="edge-about-icon" size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </Tip>
  );
}
