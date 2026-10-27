import { useEffect, useState } from "react";
import { OPEN_POPULATION_SUB } from "../utils/populationSub";
import SubTabs, { SubTabPanel, subTabId, useSubTabParam } from "./SubTabs";
import { YOUNG_PEOPLE_ANCHOR } from "../utils/viewAnchors";
import { scrollBelowBars, settleHeadings } from "../utils/pageScroll";

/** Population impact's sub-tabs; the first, Public finances, is the default. */
export const POPULATION_SUB_TABS = [
  { value: "finances", label: "Public finances", icon: "landmark" },
  { value: "all", label: "All households", icon: "users" },
  { value: "age", label: "By age", icon: "usersRound" },
  { value: "living", label: "Living standards", icon: "coins" },
  { value: "poverty", label: "Poverty", icon: "percent" },
];

const SUB_TAB_VALUES = POPULATION_SUB_TABS.map((tab) => tab.value);

const ID_PREFIX = "population";

// The income decile pair, on All households (App.jsx's DECILES_ANCHOR)
const DECILES_HASH = "#deciles";

/**
 * Once the sub-tab holding an anchor shows it, bring it into view: the
 * cards wait for their data, so the browser's own jump on load misses it.
 * Gives up after a few seconds.
 */
function scrollToHashWhenShown(hash) {
  const started = Date.now();
  const step = () => {
    if (window.location.hash !== hash) return;
    const element = document.getElementById(hash.slice(1));
    if (element && element.offsetParent !== null) {
      scrollBelowBars(element);
      // Charts above it can still be loading: check its heading once more
      setTimeout(settleHeadings, 2000);
      return;
    }
    if (Date.now() - started < 8000) setTimeout(step, 150);
  };
  step();
}

/** Take #young-people out of the address, keeping the rest. */
function dropYoungHash() {
  if (window.location.hash !== `#${YOUNG_PEOPLE_ANCHOR}`) return;
  window.history.replaceState({}, "", window.location.pathname + window.location.search);
}

function PopulationSubTabs({ note, active = true, children }) {
  const [sub, setSub] = useSubTabParam(SUB_TAB_VALUES, active);
  // Sub-tabs opened so far stay mounted, hidden while another is shown
  const [visited, setVisited] = useState([sub]);
  if (!visited.includes(sub)) setVisited([...visited, sub]);

  // A link to #young-people while this view is open shows its sub-tab
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) setSub("age");
      if (window.location.hash === DECILES_HASH) {
        setSub("all");
        scrollToHashWhenShown(DECILES_HASH);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setSub]);

  // Opened from a link to the decile pair: show it once it has loaded
  useEffect(() => {
    if (sub === "all" && window.location.hash === DECILES_HASH) scrollToHashWhenShown(DECILES_HASH);
    // Only on the first render: later visits come through hashchange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A link elsewhere on the page that opens a sub-tab (openPopulationSub)
  useEffect(() => {
    const onOpen = (event) => {
      if (!SUB_TAB_VALUES.includes(event.detail)) return;
      dropYoungHash();
      setSub(event.detail);
      document.getElementById(subTabId(ID_PREFIX, event.detail))?.scrollIntoView?.({ block: "center" });
    };
    window.addEventListener(OPEN_POPULATION_SUB, onOpen);
    return () => window.removeEventListener(OPEN_POPULATION_SUB, onOpen);
  }, [setSub]);

  // The #young-people hash belongs to the Young people sub-tab, so it goes
  // with it: a reload never opens a different sub-tab from this one
  const onChange = (next) => {
    if (next !== "age") dropYoungHash();
    setSub(next);
  };

  return (
    <>
      <SubTabs
        tabs={POPULATION_SUB_TABS}
        value={sub}
        onChange={onChange}
        ariaLabel="Population impact sections"
        idPrefix={ID_PREFIX}
      />
      {note}
      {SUB_TAB_VALUES.filter((value) => visited.includes(value)).map((value) => (
        <SubTabPanel key={value} idPrefix={ID_PREFIX} value={value} hidden={value !== sub}>
          {children(value)}
        </SubTabPanel>
      ))}
    </>
  );
}

/**
 * The Population impact view: Public finances first, then All households
 * (places, how changes vary, example households), By age (every age group,
 * pensioners and all ages, one chosen at a time), Living standards
 * (income changes by decile, inequality) and Poverty, as pill sub-tabs
 * under the view tabs. The open sub-tab is ?sub= (useSubTabParam): Public
 * finances has no parameter, the others are ?sub=all, age, living and
 * poverty. App.jsx turns the old links (?tab=young, #young-people,
 * ?sub=young, ?sub=pensioners) into ?sub=age (with ?age=) before this view
 * first reads the address.
 *
 * The sub-tab is read from the address, which the server does not have, so
 * the view renders from the first client effect on: the server's page and
 * the browser's first render agree, and App.jsx has read the address.
 *
 * @param {Object} props
 * @param {React.ReactNode} [props.note] - A line under the sub-tabs, over every panel
 * @param {boolean} [props.active] - Whether the view is shown (App keeps it mounted while hidden)
 * @param {(sub: string) => React.ReactNode} props.children - A sub-tab's content
 */
export default function PopulationImpactView(props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first client render only
    setReady(true);
  }, []);
  return ready ? <PopulationSubTabs {...props} /> : null;
}
