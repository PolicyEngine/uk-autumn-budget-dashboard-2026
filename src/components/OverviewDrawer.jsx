import { useEffect, useRef, useState } from "react";
import { LandingBoxes, LandingIntro } from "./LandingPage";
import "./OverviewDrawer.css";

// A little over --motion-slide (250ms): the slide out has ended
const SLIDE_MS = 300;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The overview, as a drawer from the left: what the dashboard is (the
 * landing page's own intro) and its three ways in, stacked. Opened by the
 * "About" tab on the window's edge. A modal dialog: focus stays inside
 * while it is open and goes back to the tab after; Esc, the close button,
 * the dimmed backdrop or the tab close it; the page behind does not
 * scroll. Its content is mounted only while it is open (and as it slides
 * out), so nothing of it is on the page otherwise: the provisional
 * notice's wording changes with the publication. It slides in and out
 * (--motion-slide; none under reduced motion).
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(tab: string, sub?: string) => void} props.onOpen - Open a view (App's handleTabChange)
 * @param {React.ReactNode} [props.provisional] - The provisional notice, when it applies
 * @param {{current: HTMLElement|null}} props.returnFocus - Where focus goes on closing
 */
export default function OverviewDrawer({ open, onClose, onOpen, provisional, returnFocus }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const wasOpen = useRef(false);
  // Mounted from opening until it has slid out; `entered` a frame after
  // mounting, so it slides in
  const [shown, setShown] = useState(false);
  const [entered, setEntered] = useState(false);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the slide out starts now
      setEntered(false);
      const timer = setTimeout(() => setShown(false), SLIDE_MS);
      return () => clearTimeout(timer);
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      };
      document.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = overflow;
        document.removeEventListener("keydown", onKey);
      };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      returnFocus.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [open, onClose, returnFocus]);

  // Focus goes in once it is shown (a hidden drawer cannot take it)
  useEffect(() => {
    if (open && entered) closeRef.current?.focus({ preventScroll: true });
  }, [open, entered]);

  // Tab and Shift+Tab go round inside the drawer
  const onKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!shown) return null;
  return (
    <div className={`overview${open && entered ? " is-open" : ""}`} inert={!open} aria-hidden={open ? undefined : "true"}>
      <div className="overview-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        id="overview-drawer"
        className="overview-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-heading"
        onKeyDown={onKeyDown}
      >
        <button ref={closeRef} type="button" className="overview-close" aria-label="Close the overview" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <LandingIntro headingId="overview-heading" provisional={provisional} className="overview-intro" />
        <LandingBoxes
          compact
          onOpen={(tab, sub) => {
            onOpen(tab, sub);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
