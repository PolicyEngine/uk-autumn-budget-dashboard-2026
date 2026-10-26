import { useEffect, useMemo, useRef, useState } from "react";
import SectionHeading from "./SectionHeading";
import { MeasureKeyProvider, SectionMeasureKey } from "./MeasureKey";
import TrendCard from "./youngPeople/TrendCard";
import MeasuresCard from "./youngPeople/MeasuresCard";
import AgeChangeCard from "./age/AgeChangeCard";
import { SharesCard, YOUNG_PEOPLE_ANCHOR, useAgeImpactRows } from "./YoungPeopleSection";
import { PENSIONERS_ANCHOR, PensionerSharesCard } from "./PensionersSection";
import { useNarrowViewport } from "../utils/chartTheme";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import { AGE_GROUP_OPTIONS, PENSIONERS, ageGroupFrom, groupSubject } from "../utils/ageGroups";
import "./YoungPeopleSection.css";
import "./PensionersSection.css";

/** The group in the address (?age=), read once the page is in the browser. */
function readGroup() {
  if (typeof window === "undefined") return ageGroupFrom(null);
  return ageGroupFrom(new URLSearchParams(window.location.search).get("age"));
}

/** Keep ?age= in step with the group, leaving the rest of the address as it is. */
function writeGroup(group) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("age", group);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}${window.location.hash}`);
}

/**
 * Population impact's By age sub-tab (?sub=age), in place of the Young
 * people and Pensioners sub-tabs: one Age group control at the top (in the
 * address as ?age=) drives every card, its focus, comparisons and
 * sentences. The cards: average change by age group, change by year,
 * change by single year of age, the effect of each policy on the group
 * against all ages, and the shares better and worse off.
 */
export default function AgeSection({ selectedPolicies, selectedYear, policies }) {
  const narrow = useNarrowViewport();
  const catalogue = useMeasureCatalogue();
  const { status, rows: publishedRows } = useAgeImpactRows(catalogue);
  const { combinedId } = catalogue;
  const rows = useMemo(
    () => publishedRows?.filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year)) ?? null,
    [publishedRows, catalogue],
  );
  const [group, setGroup] = useState(readGroup);
  const choose = (next) => {
    setGroup(next);
    writeGroup(next);
  };

  // A link to #young-people or #pensioners: the section renders after the
  // page's data loads, too late for the browser's own jump
  const scrolled = useRef(false);
  useEffect(() => {
    if (status !== "ready" || scrolled.current || typeof window === "undefined") return;
    scrolled.current = true;
    const hash = window.location.hash.slice(1);
    if (hash === YOUNG_PEOPLE_ANCHOR || hash === PENSIONERS_ANCHOR) document.getElementById(hash)?.scrollIntoView();
  }, [status]);

  if (status !== "ready") {
    return (
      <p className="view-status" role="status">
        {status === "loading" ? "Loading results by age…" : "Results by age are not available."}
      </p>
    );
  }
  // One Age group choice, in every card's Options pill and in sync: choosing
  // it in any card changes all four (and ?age=)
  const groupOption = {
    label: "Age group",
    value: group,
    onChange: choose,
    options: AGE_GROUP_OPTIONS.map((option) => ({
      value: option.key,
      label: option.label,
      summary: option.key === PENSIONERS ? "Pensioners" : option.label,
    })),
  };
  const props = { rows, policies, selectedPolicies, selectedYear, narrow, combinedId, catalogue, group, extraOptions: [groupOption] };
  const subject = groupSubject(group);
  return (
    <>
      {/* The old sub-tabs' anchors, so their links still land here */}
      <span id={YOUNG_PEOPLE_ANCHOR} aria-hidden="true" />
      <span id={PENSIONERS_ANCHOR} aria-hidden="true" />
      <MeasureKeyProvider>
        <SectionHeading
          icon="ages"
          title="How much each age group gains"
          subtitle={
            group === PENSIONERS
              ? "Pensioners are people at State Pension age or over: 66 and over in 2026-27, 67 and over from 2027-28."
              : "The average change for each age group, this year and over time; choose the group in any card's Options."
          }
        />
        <section className="report-section young-people-section" aria-label="How much each age group gains">
          <SectionMeasureKey />
          <div className="charts-grid">
            <AgeChangeCard {...props} height={narrow ? 360 : 400} />
            <TrendCard key={group} {...props} height={narrow ? 340 : 400} />
          </div>
        </section>
      </MeasureKeyProvider>
      <SectionHeading
        id="age-who-gains"
        icon="userPlus"
        title="Who gains and from what"
        subtitle={`Which policies drive the change for ${subject.toLowerCase()}, and how many are better or worse off.`}
      />
      <section className="report-section young-people-section" aria-label="Who gains and from what">
        <div className="charts-grid">
          <MeasuresCard {...props} height={narrow ? 460 : 400} />
          {group === PENSIONERS ? (
            <PensionerSharesCard {...props} height={narrow ? 260 : 400} />
          ) : (
            <SharesCard {...props} height={narrow ? 340 : 400} />
          )}
        </div>
      </section>
    </>
  );
}
