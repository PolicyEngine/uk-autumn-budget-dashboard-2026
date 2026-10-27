import TitleIcon from "./TitleIcon";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import "./SubTabs.css";
import { scrollBelowBars } from "../utils/pageScroll";

/** The ids that tie a sub-tab to its panel. */
export const subTabId = (idPrefix, value) => `${idPrefix}-subtab-${value}`;
export const subPanelId = (idPrefix, value) => `${idPrefix}-subpanel-${value}`;

/** The query parameter that holds the open sub-tab (?sub=). */
export const SUB_TAB_PARAM = "sub";

/**
 * A view's sub-tab, kept in the address as ?sub=, so a link opens it. The
 * first value is the default and is never written, so the default leaves
 * the address as it was. App.jsx drops ?sub= when another view is chosen;
 * a value this view does not have opens the default.
 *
 * @param {string[]} values - The sub-tabs' values; the first is the default
 * @param {boolean} [active] - Whether the view is shown (kept mounted while hidden)
 * @returns {[string, (value: string) => void]}
 */
export function useSubTabParam(values, active = true) {
  const fallback = values[0];
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return fallback;
    const sub = new URLSearchParams(window.location.search).get(SUB_TAB_PARAM);
    return values.includes(sub) ? sub : fallback;
  });
  // Shown again after another view (which dropped ?sub=): a ?sub= the
  // link brought opens that sub-tab; with none, the sub-tab left open stays
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active && typeof window !== "undefined") {
      const sub = new URLSearchParams(window.location.search).get(SUB_TAB_PARAM);
      if (values.includes(sub) && sub !== value) setValue(sub);
    }
  }

  useEffect(() => {
    // A hidden view leaves the address to the view shown
    if (!active) return;
    const params = new URLSearchParams(window.location.search);
    if (value === fallback) params.delete(SUB_TAB_PARAM);
    else params.set(SUB_TAB_PARAM, value);
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, "", url);
    }
  }, [value, fallback, active]);

  return [value, setValue];
}

/**
 * Where a row's chosen item sits, for an indicator that slides to it: its
 * left edge and width inside the row (the row's scroll content), measured
 * after layout and again when the row resizes. `ready` turns on once the
 * first place is known, so the indicator never slides in from the edge.
 *
 * @param {{current: HTMLElement|null}} rowRef
 * @param {{current: Object<string, HTMLElement>}} itemRefs
 * @param {string} value
 */
export function useSlidingIndicator(rowRef, itemRefs, value) {
  const [place, setPlace] = useState({ x: 0, width: 0, ready: false });
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = () => {
      const node = itemRefs.current[value];
      if (!node) return;
      const x = node.offsetLeft;
      const width = node.offsetWidth;
      setPlace((was) =>
        was.x === x && was.width === width && was.ready ? was : { x, width, ready: was.ready || width > 0 },
      );
    };
    measure();
    if (!row || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const node of Object.values(itemRefs.current)) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [rowRef, itemRefs, value]);
  return place;
}

/**
 * A view's sub-tabs: a second row right under the view tabs, white like
 * them, sticking with them. The chosen sub-tab is marked as the chosen
 * view tab is: a light tint and a teal underline, sliding from tab to tab.
 * Icon and label. A WAI-ARIA tablist with automatic activation:
 * Left/Right (wrapping) and Home/End move to a tab and show it; only the
 * chosen tab is in the Tab order. On a phone the row scrolls sideways, faded at an
 * edge with more beyond, the chosen tab kept in sight. If the reader had
 * scrolled past the band, choosing a sub-tab brings it back up under the
 * sticky view tabs.
 *
 * The parent renders the chosen panel in a SubTabPanel with the same
 * idPrefix.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string, icon?: string}>} props.tabs
 * @param {string} props.value - The chosen tab's value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.ariaLabel - The tablist's accessible name
 * @param {string} props.idPrefix - Prefix for the tab and panel ids
 * @param {import("react").Ref<{show: (value: string) => void}>} [props.ref] -
 *   For a link in a panel that opens another sub-tab: `show(value)`
 */
export default function SubTabs({ tabs, value, onChange, ariaLabel, idPrefix, ref }) {
  const refs = useRef({});
  const barRef = useRef(null);
  // Where the band sits in the page: the band sticks, so its own box moves
  const sentinelRef = useRef(null);
  const rowRef = useRef(null);
  const scrollPending = useRef(false);
  const pill = useSlidingIndicator(rowRef, refs, value);
  // Which ends of a scrolling row have tabs out of sight, to fade them
  const [hidden, setHidden] = useState({ start: false, end: false });

  const measureEnds = () => {
    const row = rowRef.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setHidden((was) => (was.start === start && was.end === end ? was : { start, end }));
  };

  const choose = (next) => {
    if (next !== value) scrollPending.current = true;
    onChange(next);
  };

  // A link in a panel goes the same way as choosing the tab here, and
  // moves focus to the tab: the link that had it is in the panel now hidden
  useImperativeHandle(ref, () => ({
    show(next) {
      choose(next);
      refs.current[next]?.focus({ preventScroll: true });
    },
  }));

  // Once the new panel is laid out: if the reader had scrolled past the
  // band (it sticks, so the panel's top had gone under it), bring the
  // panel's top back to just below it
  useLayoutEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    // The bars above it measured as they are (utils/pageScroll)
    scrollBelowBars(sentinel, { gap: 0, above: true, onlyUp: true });
  }, [value]);

  // Keep the chosen tab in sight in a scrolling row (the row only, never
  // the page)
  useEffect(() => {
    const row = rowRef.current;
    const node = refs.current[value];
    if (row && node) {
      const left = node.offsetLeft;
      const right = left + node.offsetWidth;
      if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 24);
      else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 24;
    }
    measureEnds();
  }, [value]);

  useEffect(() => {
    window.addEventListener("resize", measureEnds);
    return () => window.removeEventListener("resize", measureEnds);
  }, []);

  const onKeyDown = (event) => {
    const current = tabs.findIndex((tab) => tab.value === value);
    const last = tabs.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[next];
    choose(tab.value);
    refs.current[tab.value]?.focus({ preventScroll: true });
  };

  return (
    <>
    <div ref={sentinelRef} className="sub-tabs-sentinel" aria-hidden="true" />
    <div ref={barRef} className="sub-tabs-band">
      <div
        ref={rowRef}
        className={`sub-tabs${hidden.start ? " fade-start" : ""}${hidden.end ? " fade-end" : ""}`}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onScroll={measureEnds}
      >
        {/* The chosen tab's pill, sliding from tab to tab */}
        <span
          className={`sub-tabs-pill${pill.ready ? " is-ready" : ""}`}
          aria-hidden="true"
          style={{ width: pill.width, transform: `translateX(${pill.x}px)` }}
        />
        {tabs.map((tab) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(node) => {
                refs.current[tab.value] = node;
              }}
              type="button"
              role="tab"
              id={subTabId(idPrefix, tab.value)}
              aria-selected={selected}
              // A sub-tab's panel exists once it has been opened
              aria-controls={selected ? subPanelId(idPrefix, tab.value) : undefined}
              tabIndex={selected ? 0 : -1}
              className="sub-tab"
              onClick={() => choose(tab.value)}
            >
              {tab.icon && <TitleIcon name={tab.icon} bare size={18} className="sub-tab-icon" />}
              <span className="sub-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}

/** A sub-tab's panel, labelled by its tab; hidden while another is chosen. */
export function SubTabPanel({ idPrefix, value, className, hidden, children }) {
  return (
    <div
      id={subPanelId(idPrefix, value)}
      role="tabpanel"
      aria-labelledby={subTabId(idPrefix, value)}
      className={`sub-panel${className ? ` ${className}` : ""}`}
      hidden={hidden}
    >
      {children}
    </div>
  );
}
