import { useEffect, useRef, useState } from "react";
import Tip from "./Tip";
import { PanelLeftOpen } from "lucide-react";
import mark from "@/assets/policyengine-white-square.svg";
import tealMark from "@/assets/policyengine-teal-square.svg";
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
 * An "About" tab pinned to the window's left edge on every view (App.jsx
 * leaves it off the landing page): a rail button in the left margin of
 * the view tabs bar and any sub-tab band below it, their full height, with the PolicyEngine mark and a
 * panel-open icon; the card names it on hover or focus, and a click
 * that opens the overview drawer (OverviewDrawer.jsx); it is hidden while
 * the drawer is open. It
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
  // One block with the view tabs bar and the open view's sub-tab band,
  // wherever they are: in the page at first, then stuck (and compact)
  // under the title band
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const bar = document.querySelector(".view-tabs-bar");
      if (!bar || !own.current) return;
      const box = bar.getBoundingClientRect();
      // Down through the open view's sub-tab band, when it has one
      const band = [...document.querySelectorAll(".sub-tabs-band")].find((node) => node.offsetParent !== null);
      const bottom = band ? Math.max(box.bottom, band.getBoundingClientRect().bottom) : box.bottom;
      // Inside the bar's top border and the last row's bottom border
      own.current.style.top = `${Math.round(box.top) + 1}px`;
      const height = Math.round(bottom - box.top) - 2;
      own.current.style.height = `${height}px`;
      // The mark over the icon where they fit, else the mark alone
      own.current.dataset.short = String(height < 52);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    // The bar and bands change height when they stick, and a view's
    // change of tab adds or removes a band
    const bar = document.querySelector(".view-tabs-bar");
    const main = document.querySelector(".main-content");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    if (bar) observer?.observe(bar);
    if (main) observer?.observe(main);
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
