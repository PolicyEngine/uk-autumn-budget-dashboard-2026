import { useEffect, useRef, useState } from "react";
import TitleIcon from "./TitleIcon";

// Each view's icon, drawn as the chart titles' are
const TAB_ICONS = {
  dashboard: "users",
  household: "house",
  living: "trend",
  methodology: "book",
};

/**
 * The page's views as an underline tab bar under the intro: one tab per
 * view, the chosen one underlined in PolicyEngine teal. A WAI-ARIA tablist
 * with automatic activation: Left/Right (and Home/End) move to a tab and
 * show it. Only the chosen tab is in the Tab order. On a narrow screen the
 * row scrolls sideways inside itself, never the page.
 *
 * @param {Object} props
 * @param {Array<{value: string, label: string}>} props.tabs
 * @param {string} props.value - The chosen tab's value
 * @param {(value: string) => void} props.onChange
 * @param {(value: string) => string} props.tabId - The id of a tab's button
 * @param {(value: string) => string} props.panelId - The id of a tab's panel
 */
function ViewTabs({ tabs, value, onChange, tabId, panelId }) {
  const refs = useRef({});
  const rowRef = useRef(null);
  // Which ends of a scrolling row have tabs out of sight, to fade them
  const [hidden, setHidden] = useState({ start: false, end: false });

  const measure = () => {
    const row = rowRef.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setHidden((was) => (was.start === start && was.end === end ? was : { start, end }));
  };

  // Keep the chosen tab in sight in a scrolling row (the row only, never
  // the page)
  useEffect(() => {
    const row = rowRef.current;
    const node = refs.current[value];
    if (row && node) {
      const left = node.offsetLeft - row.offsetLeft;
      const right = left + node.offsetWidth;
      if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 24);
      else if (right > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = right - row.clientWidth + 24;
      }
    }
    measure();
  }, [value]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const select = (index) => {
    const tab = tabs[index];
    onChange(tab.value);
    refs.current[tab.value]?.focus({ preventScroll: true });
  };

  const onKeyDown = (event) => {
    const current = tabs.findIndex((tab) => tab.value === value);
    const last = tabs.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div className="view-tabs-bar">
      <div
        ref={rowRef}
        className={`view-tabs${hidden.start ? " fade-start" : ""}${hidden.end ? " fade-end" : ""}`}
        role="tablist"
        aria-label="Views"
        onKeyDown={onKeyDown}
        onScroll={measure}
      >
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
              id={tabId(tab.value)}
              aria-selected={selected}
              // Only the chosen view's panel is rendered
              aria-controls={selected ? panelId(tab.value) : undefined}
              tabIndex={selected ? 0 : -1}
              className="view-tab"
              onClick={() => onChange(tab.value)}
            >
              <TitleIcon name={TAB_ICONS[tab.value]} bare size={18} className="view-tab-icon" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ViewTabs;
