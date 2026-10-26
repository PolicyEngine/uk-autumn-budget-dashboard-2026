import { useEffect, useRef, useState } from "react";
import Tip from "./Tip";
import mark from "@/assets/policyengine-white-square.svg";
import "./HomeButton.css";

// How long a first tap on a touch screen waits for a second (which goes
// to the start); the first only shows the tip
const TAP_AGAIN_MS = 4000;

/**
 * The band's home button, left of the title: a mini card says what the
 * dashboard is on hover, focus or a first tap; a click (a second tap on a
 * touch screen) goes back to the landing page, in place. On the landing
 * page itself it is marked current and does nothing.
 *
 * @param {Object} props
 * @param {boolean} props.current - Whether the landing page is shown
 * @param {() => void} props.onHome - Go to the landing page (App's goHome)
 */
export default function HomeButton({ current, onHome }) {
  const props = useHomeClick(current, onHome);
  return (
    <Tip content={<AboutTip current={current} />}>
      <button
        type="button"
        className="home-button"
        aria-label="Back to the start: about this dashboard"
        aria-current={current ? "page" : undefined}
        {...props}
      >
        <Mark className="home-button-mark" />
      </button>
    </Tip>
  );
}

/** PolicyEngine's square mark (@policyengine/ui-kit's white-square.svg). */
function Mark({ className }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mark.src ?? mark} alt="" className={className} />;
}

/** The card both buttons show: what the dashboard is, and the way back. */
function AboutTip({ current }) {
  return (
    <span className="home-tip">
      <span className="home-tip-title">About this dashboard</span>
      <span>Our estimates of how Autumn Budget 2026 changes the public finances and household incomes.</span>
      <span className="home-tip-hint">{current ? "You are at the start." : "Click to return to the start."}</span>
    </span>
  );
}

/**
 * A click goes to the start; on a touch screen the first tap shows the card
 * and a second (within TAP_AGAIN_MS) goes.
 */
function useHomeClick(current, onHome) {
  const touch = useRef(false);
  const armedAt = useRef(0);
  return {
    onPointerDown: (event) => {
      touch.current = event.pointerType === "touch";
    },
    onClick: () => {
      if (current) return;
      if (touch.current && Date.now() - armedAt.current > TAP_AGAIN_MS) {
        armedAt.current = Date.now();
        return;
      }
      armedAt.current = 0;
      onHome();
    },
  };
}

// Set once the edge tab's attention cue has played this session
const CUE_KEY = "ab2026-about-cue";

/**
 * An "About" tab pinned to the window's left edge on every view (App.jsx
 * leaves it off the landing page): the same card on hover or focus, and a
 * click back to the start. It pulses softly once per session (not under
 * reduced motion, LandingPage.css); on a phone it is the mark alone.
 *
 * @param {Object} props
 * @param {() => void} props.onHome - Go to the landing page (App's goHome)
 */
export function EdgeAboutTab({ onHome }) {
  const props = useHomeClick(false, onHome);
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
    <Tip content={<AboutTip current={false} />}>
      <button
        type="button"
        className={`edge-about${cue ? " is-cue" : ""}`}
        aria-label="About this dashboard: back to the start"
        {...props}
      >
        <Mark className="edge-about-mark" />
        <span className="edge-about-label" aria-hidden="true">About</span>
      </button>
    </Tip>
  );
}
