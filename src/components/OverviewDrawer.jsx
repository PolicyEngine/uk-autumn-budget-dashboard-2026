import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { LandingBoxes, LandingIntro } from "./LandingPage";
import { replicationLinks } from "./ReplicationLine";
import Tip from "./Tip";
import mark from "@/assets/policyengine-teal-square.svg";
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
export default function OverviewDrawer({ open, onClose, onOpen, provisional, provisionalWording = false, returnFocus }) {
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
        <header className="overview-header">
          <span className="overview-brand">
            {/* PolicyEngine's square mark (@policyengine/ui-kit's teal-square.svg) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mark.src ?? mark} alt="" className="overview-mark" />
            <span className="overview-title">About this dashboard</span>
          </span>
          <Tip content="Close (Esc)">
            <button ref={closeRef} type="button" className="overview-close" aria-label="Close the overview" onClick={onClose}>
              <X size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </Tip>
        </header>
        <div className="overview-body">
          <LandingIntro headingId="overview-heading" provisional={provisional} className="overview-intro" />
          <nav className="overview-nav" aria-labelledby="overview-goto">
          <p id="overview-goto" className="overview-goto">Go to</p>
          <LandingBoxes
            list
            labelledBy="overview-goto"
            provisional={provisionalWording}
            onOpen={(tab, sub) => {
              onOpen(tab, sub);
              onClose();
            }}
          />
          </nav>
        </div>
        <footer className="overview-footer">
          <p id="overview-built" className="overview-built">Built with</p>
          <ul className="overview-built-links" aria-labelledby="overview-built">
            {replicationLinks({ policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION }).map(({ key, label, title, href, Icon }) => (
              <li key={key}>
                <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                  <Icon size={14} strokeWidth={2} aria-hidden="true" />
                  {/* A row's own start: "Replication code"; a package keeps its name */}
                  {key === "code" ? "Replication code" : label}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </div>
  );
}
