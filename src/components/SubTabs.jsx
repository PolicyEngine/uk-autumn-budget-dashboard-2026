import TitleIcon from "./TitleIcon";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./SubTabs.css";

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
 * A view's sub-tabs: a compact segmented pill control inside the view,
 * secondary to the page's underline view tabs. A WAI-ARIA tablist with
 * automatic activation: Left/Right (wrapping) and Home/End move to a tab
 * and show it; only the chosen tab is in the Tab order. If the reader had
 * scrolled past the control, choosing a sub-tab brings it back up under
 * the sticky band and view tabs, as the view tabs do.
 *
 * The parent renders the chosen panel in a SubTabPanel with the same
 * idPrefix.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string}>} props.tabs
 * @param {string} props.value - The chosen tab's value
 * @param {(value: string) => void} props.onChange
 * @param {string} props.ariaLabel - The tablist's accessible name
 * @param {string} props.idPrefix - Prefix for the tab and panel ids
 */
export default function SubTabs({ tabs, value, onChange, ariaLabel, idPrefix }) {
  const refs = useRef({});
  const barRef = useRef(null);
  const scrollPending = useRef(false);

  const choose = (next) => {
    if (next !== value) scrollPending.current = true;
    onChange(next);
  };

  // Once the new panel is laid out: if the bar had gone up under the
  // sticky band, bring it back to sit just below it
  useLayoutEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const bar = barRef.current;
    if (!bar) return;
    // scroll-margin-top (SubTabs.css) holds the sticky band's height
    const offset = parseFloat(getComputedStyle(bar).scrollMarginTop) || 0;
    const top = bar.getBoundingClientRect().top + window.scrollY - offset;
    if (window.scrollY > top) window.scrollTo({ top });
  }, [value]);

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
    <div ref={barRef} className="sub-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
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
            {tab.icon && <TitleIcon name={tab.icon} bare size={16} className="sub-tab-icon" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** A sub-tab's panel, labelled by its tab; hidden while another is chosen. */
export function SubTabPanel({ idPrefix, value, className, hidden, children }) {
  return (
    <div
      id={subPanelId(idPrefix, value)}
      role="tabpanel"
      aria-labelledby={subTabId(idPrefix, value)}
      className={className}
      hidden={hidden}
    >
      {children}
    </div>
  );
}
