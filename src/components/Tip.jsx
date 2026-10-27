import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tip.css";

const GAP = 8;
const EDGE = 8;

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
 * `title` box: shown at once on hover (a 100ms fade), on keyboard focus and
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

  useEffect(() => setMounted(true), []);

  const anchor = () => wrapRef.current?.firstElementChild ?? wrapRef.current;

  useLayoutEffect(() => {
    if (!open || !tipRef.current) return;
    const a = anchor()?.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    if (!a) return;
    const below = a.top - t.height - GAP < EDGE;
    const top = below ? a.bottom + GAP : a.top - t.height - GAP;
    const left = Math.min(Math.max(a.left + a.width / 2 - t.width / 2, EDGE), window.innerWidth - t.width - EDGE);
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
      onMouseLeave={hide}
      onFocus={() => {
        if (!pointerLast) show();
      }}
      onBlur={hide}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") setOpen((value) => !value);
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

/** An info icon with a tip: the definition behind a figure or a label. */
export function InfoTip({ content, label = "More information" }) {
  return (
    <Tip content={content}>
      <button type="button" className="info-tip" aria-label={label}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
    </Tip>
  );
}
