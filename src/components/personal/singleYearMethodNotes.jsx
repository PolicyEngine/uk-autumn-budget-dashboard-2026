import SourceLink from "../SourceLink";
import TitleIcon from "../TitleIcon";
import "./singleYearMethodNotes.css";

// The longer notes of "About these figures" (SINGLE_YEAR_METHOD): a
// one-line summary, the rest behind a Details toggle, one short line per
// idea, each fact once
function Note({ icon, lead, points }) {
  return (
    <div className="method-note">
      <p className="method-note-lead">
        <TitleIcon name={icon} bare size={14} className="method-note-icon" />
        {lead}
      </p>
      <details className="method-note-details">
        <summary>Details</summary>
        <ul>
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export const CHANGE_BY_POLICY_NOTE = (
  <Note
    icon="hbars"
    lead="Each bar is one policy on its own."
    points={[
      "It is switched on alone, with every other selected policy at current law, against the same baseline.",
      "Policies can interact, so their own effects need not add up to the combined change.",
      "A difference of £1 or more shows as “Interaction between policies”, so the bars add up to the headline change.",
    ]}
  />
);

export const EVERY_POLICY_NOTE = (
  <Note
    icon="receipt"
    lead="Your household is simulated in policyengine-uk with the selected policies applied, as in the national figures."
    points={[
      "Fuel duty deferral: includes the VAT on the lower pump price.",
      "VAT changes: apply to the petrol, diesel and electricity spending you enter.",
      "Employer NI relief: an employer cost, £0 for households (wages held fixed).",
      "Warm Home Discount top-up: paid in 2026-27 only, so not in the selectable years.",
    ]}
  />
);

export const WHO_IS_A_CHILD_NOTE = (
  <Note
    icon="users"
    lead="Everyone under 16, and a 16- to 19-year-old in full-time non-advanced education."
    points={[
      "The education must have begun before 19 (school or college), as you answer for each.",
      "Child Benefit counts such a young person until 20.",
      "Universal Credit stops at the 1 September after their 19th birthday, so a 19-year-old counts for Child Benefit but not Universal Credit.",
    ]}
  />
);

export const COUNCIL_TAX_NOTE = (
  <Note
    icon="building"
    lead="Estimated from your band and region, and taken off net income."
    points={[
      <>
        Band D averages: <SourceLink source="mhclg_council_tax">MHCLG</SourceLink> for England, tax-base weighted by
        region; the <SourceLink source="wales_council_tax">Welsh</SourceLink> and{" "}
        <SourceLink source="scotland_council_tax">Scottish</SourceLink> governments.
      </>,
      "Starts from 2026-27 averages, grown to the chosen year with policyengine-uk's OBR Council Tax forecast.",
      "Northern Ireland has domestic rates, which are not modelled.",
      "No selected policy changes it.",
    ]}
  />
);

export const RENT_NOTE = (
  <Note
    icon="house"
    lead="A renter's rent starts at the average private rent in their rental area, for the bedrooms their household points to; “Use the local rate” sets it to the area's Local Housing Allowance rate."
    points={[
      <>
        Average rents: <SourceLink source="ons_private_rents">ONS Price Index of Private Rents</SourceLink>, the
        latest month (September 2026; July for Northern Ireland, which ONS publishes two months later).
      </>,
      "Scotland and Northern Ireland: ONS publishes rents by Broad Rental Market Area, used as they are.",
      "England and Wales: ONS publishes rents by local authority. An area's rent is its local authorities' rents, weighted by the Census 2021 private-rented households in the part of the area each one holds.",
      "Bedrooms: one with no children, two with one or two, three with three or four, four with five or more.",
      "The Local Housing Allowance rate (DWP, 2026-27) was set in April 2024 at the 30th percentile of local rents and is frozen, so it is below the average almost everywhere. It caps Universal Credit's housing element whatever rent is entered.",
    ]}
  />
);
