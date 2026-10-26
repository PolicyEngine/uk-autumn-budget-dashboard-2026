import { useEffect, useState } from "react";
import SubTabs, { SubTabPanel, useSubTabParam } from "./SubTabs";
import { YOUNG_PEOPLE_ANCHOR } from "./YoungPeopleSection";

/** Population impact's sub-tabs; the first, Public finances, is the default. */
export const POPULATION_SUB_TABS = [
  { value: "finances", label: "Public finances", icon: "landmark" },
  { value: "all", label: "All households", icon: "users" },
  { value: "young", label: "Young people", icon: "cap" },
  { value: "pensioners", label: "Pensioners", icon: "armchair" },
  { value: "living", label: "Living standards", icon: "coins" },
  { value: "poverty", label: "Poverty", icon: "percent" },
];

const SUB_TAB_VALUES = POPULATION_SUB_TABS.map((tab) => tab.value);

const ID_PREFIX = "population";

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
      if (window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) setSub("young");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setSub]);

  // The #young-people hash belongs to the Young people sub-tab, so it goes
  // with it: a reload never opens a different sub-tab from this one
  const onChange = (next) => {
    if (next !== "young") dropYoungHash();
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
 * (places, how changes vary, example households), Young people (results by
 * age), Pensioners (people at or over State Pension age), Living standards
 * (income changes by decile, inequality) and Poverty, as pill sub-tabs
 * under the view tabs. The open sub-tab is ?sub= (useSubTabParam): Public
 * finances has no parameter, the others are ?sub=all, young, pensioners,
 * living and poverty. App.jsx turns the old links (?tab=young, #young-people)
 * into ?sub=young before this view first reads the address.
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
