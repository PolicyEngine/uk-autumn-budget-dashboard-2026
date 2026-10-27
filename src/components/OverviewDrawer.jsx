import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { LandingBoxes, LandingIntro } from "./LandingPage";
import { replicationLinks } from "./ReplicationLine";
import Tip from "./Tip";
import { POLICYENGINE_HOME } from "./HomeButton";
import logo from "@/assets/policyengine-white.svg";
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
  // The body has scrolled under the header: the header then casts a soft
  // shadow (no rule between them at rest)
  const [scrolled, setScrolled] = useState(false);
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
    // Its ring is :focus-visible only: none when a click opened the drawer,
    // a subtle one when a key did
    if (open && entered && closeRef.current) {
      closeRef.current.focus({ preventScroll: true });
    }
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
        aria-labelledby="overview-tag"
        onKeyDown={onKeyDown}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {/* Sticky: a band in the title band's gradient and height, so it
            lines up with the band beside it; the wordmark centred, the
            close button at the right (an empty cell at the left keeps the
            wordmark on the centre line) */}
        <header className={`overview-header${scrolled ? " is-scrolled" : ""}`}>
          <span className="overview-header-spacer" aria-hidden="true" />
          {/* PolicyEngine's white wordmark, as the site header has it
              (@policyengine/ui-kit's white.svg, 24px tall), a link to
              PolicyEngine's home page in the same tab */}
          <a href={POLICYENGINE_HOME} className="overview-logo-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.src ?? logo} alt="PolicyEngine" className="overview-logo" />
          </a>
          <Tip content="Close (Esc)">
            <button
              ref={closeRef}
              type="button"
              className="overview-close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </Tip>
        </header>
        <div className="overview-body">
          <div className="overview-lead">
            {/* The dialog's name: an eyebrow above the title, a short teal
                bar then the words */}
            <p id="overview-tag" className="overview-tag">About this dashboard</p>
            <LandingIntro headingId="overview-heading" provisional={provisional} className="overview-intro" />
          </div>
          {/* Two groups: the three views in this dashboard, as one card;
              then PolicyEngine's website, a smaller muted row that leaves */}
          <nav className="overview-nav" aria-label="Go to">
            <section className="overview-group" aria-labelledby="overview-here">
              <h3 id="overview-here" className="overview-group-label">In this dashboard</h3>
              <LandingBoxes
                list
                labelledBy="overview-here"
                provisional={provisionalWording}
                onOpen={(tab, sub) => {
                  onOpen(tab, sub);
                  onClose();
                }}
              />
            </section>
            <section className="overview-group" aria-labelledby="overview-elsewhere">
              <h3 id="overview-elsewhere" className="overview-group-label">More from PolicyEngine</h3>
              <a className="overview-external" href="https://policyengine.org/uk" target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mark.src ?? mark} alt="" className="overview-external-mark" />
                <span className="landing-row-text">
                  <span className="landing-row-title">policyengine.org</span>
                  <span className="landing-row-description">Research, the model and the API</span>
                </span>
                <span className="visually-hidden"> (opens in a new tab)</span>
                <ArrowUpRight className="landing-row-chevron" size={16} strokeWidth={2} aria-hidden="true" />
              </a>
            </section>
          </nav>
        </div>
        <footer className="overview-footer">
          <p id="overview-built" className="overview-group-label">Built with</p>
          <ul className="overview-built-links" aria-labelledby="overview-built">
            {replicationLinks({ policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION }).map(({ key, label, title, href, Icon }) => (
              <li key={key}>
                <Tip content={title}>
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <Icon size={14} strokeWidth={2} aria-hidden="true" />
                    {/* A row's own start: "Replication code"; a package keeps its name */}
                    <span>{key === "code" ? "Replication code" : label}</span>
                    <ArrowUpRight className="overview-built-arrow" size={12} strokeWidth={2} aria-hidden="true" />
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </Tip>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </div>
  );
}
