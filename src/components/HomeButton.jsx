import { useRef } from "react";
import Tip from "./Tip";
import TitleIcon from "./TitleIcon";
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
  const touch = useRef(false);
  const armedAt = useRef(0);
  const tip = (
    <span className="home-tip">
      <span className="home-tip-title">About this dashboard</span>
      <span>Our estimates of how Autumn Budget 2026 changes the public finances and household incomes.</span>
      <span className="home-tip-hint">{current ? "You are at the start." : "Click to return to the start."}</span>
    </span>
  );
  return (
    <Tip content={tip}>
      <button
        type="button"
        className="home-button"
        aria-label="Back to the start: about this dashboard"
        aria-current={current ? "page" : undefined}
        onPointerDown={(event) => {
          touch.current = event.pointerType === "touch";
        }}
        onClick={() => {
          if (current) return;
          if (touch.current && Date.now() - armedAt.current > TAP_AGAIN_MS) {
            armedAt.current = Date.now();
            return;
          }
          armedAt.current = 0;
          onHome();
        }}
      >
        <TitleIcon name="house" bare size={18} />
      </button>
    </Tip>
  );
}
