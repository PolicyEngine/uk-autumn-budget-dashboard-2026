import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { stickyInset } from "../utils/tooltipPlacement";
import "./Tip.css";

const GAP = 8;
const EDGE = 8;
// How long after a tap a made-up mouseleave is ignored (ms)
const TAP_GRACE = 600;

// Whether the last input was a pointer (a tap or a click) rather than a key.
// A focus that follows a pointer, such as the About drawer moving focus to
// its close button when a tap opens it, shows no tip: on a phone "Close
// (Esc)" would sit over the drawer's title. Keyboard focus still shows it.
let pointerLast = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pointerLast = true; }, true);
  document.addEventListener("keydown", () => { pointerLast = false; }, true);
}

/**
 * A styled tip for a UI explanation, in place of the browser's slow grey
 * `title` box: shown on hover (fading in after 80ms, so a passing pointer
 * shows none), on keyboard focus and
 * on a tap (which toggles it on a touch screen); closed by Escape, blur or
 * leaving. It sits above its anchor, or below where there is no room, kept
 * inside the window. The anchor's aria-describedby names it.
 *
 * Wrap one element: <Tip content="No end date"><span … /></Tip>. The wrapper
 * is display: contents, so it changes no layout. Keep `title` only as a
 * fallback for truncated text.
 */
export default function Tip({ content, children }) {
  const id = useId();
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState(null);
  // When this anchor was last tapped: the mouse events a browser makes up
  // after a tap (a mouseleave as its emulated pointer moves on) must not
  // close the tip the tap just opened
  const tappedAt = useRef(-Infinity);

  useEffect(() => setMounted(true), []);

  const anchor = () => wrapRef.current?.firstElementChild ?? wrapRef.current;

  useLayoutEffect(() => {
    if (!open || !tipRef.current) return;
    const a = anchor()?.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    if (!a) return;
    // Above the anchor, centred; below it where the sticky band or the
    // window's top leaves no room; kept inside the window either way
    const minTop = stickyInset(anchor()) + EDGE;
    const below = a.top - t.height - GAP < minTop;
    const maxTop = window.innerHeight - t.height - EDGE;
    const top = Math.max(minTop, Math.min(below ? a.bottom + GAP : a.top - t.height - GAP, maxTop));
    const width = document.documentElement.clientWidth || window.innerWidth;
    const left = Math.min(Math.max(a.left + a.width / 2 - t.width / 2, EDGE), width - t.width - EDGE);
    setPos({ top, left, below });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  if (!content) return children;
  const child = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
      })
    : children;

  return (
    <span
      ref={wrapRef}
      className="tip-anchor"
      onMouseEnter={show}
      onMouseLeave={() => {
        if (performance.now() - tappedAt.current > TAP_GRACE) hide();
      }}
      onFocus={() => {
        if (!pointerLast) show();
      }}
      onBlur={hide}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          tappedAt.current = performance.now();
          setOpen((value) => !value);
        }
      }}
    >
      {child}
      {/* Rendered only while open, so its words are not on the page twice */}
      {mounted &&
        open &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tip${pos?.below ? " is-below" : ""}`}
            style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

/**
 * The dashboard's one info icon with a tip: the definition behind a figure
 * or a label. lucide's Info at 16px, muted, teal on hover and focus; its
 * tip is the shared Tip card. Every ⓘ on the page is this.
 */
export function InfoTip({ content, label = "More information" }) {
  return (
    <Tip content={content}>
      <button type="button" className="info-tip" aria-label={label}>
        <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </Tip>
  );
}
