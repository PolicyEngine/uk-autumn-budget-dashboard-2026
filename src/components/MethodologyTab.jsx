import GeographyMethodology from "./GeographyMethodology";
import LivingStandardsMethod from "./methodology/LivingStandardsMethod";
import FactList from "./methodology/FactList";
import MethodContents, { goToSection } from "./methodology/MethodContents";
import { MEASURE_MODELLING, NOT_MODELLED } from "./methodology/measures";
import { EXAMPLE_HOUSEHOLDS } from "../utils/exampleHouseholds";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { AGE_BANDS, AGE_BAND_SOURCE, MIN_SAMPLE_SIZE } from "../utils/ageImpact";
import { SINGLE_AGE_FIRST, SINGLE_AGE_LAST } from "./youngPeople/youngPeopleData";
import { FIRST_DISPLAY_YEAR, LAST_DISPLAY_YEAR } from "../utils/displayYears";
import { fiscalYearTick } from "../utils/chartTheme";
import { POLICY_COLORS } from "../utils/policyConfig";
import "./methodology/Methodology.css";

const RESEARCH = [
  ["https://policyengine.org/uk/research/fuel-duty-freeze-2025", "fuel duty"],
];

/**
 * The ids of the Methodology view's sections, for links to them. Other
 * views link with these (the map to `geography`, Personal impact to
 * `singleYear`), so a key's id must not change.
 */
export const METHOD_SECTIONS = {
  overview: "method-overview",
  data: "method-data",
  model: "method-model",
  population: "method-population",
  geography: "method-area",
  young: "method-young",
  personal: "method-personal",
  singleYear: "method-single-year",
  living: "method-living",
  limitations: "method-limitations",
  versions: "method-versions",
};

/** The sections in the contents, in page order (the household calculation's block sits inside Personal impact). */
export const METHOD_CONTENTS = [
  { id: METHOD_SECTIONS.overview, title: "At a glance" },
  { id: METHOD_SECTIONS.data, title: "Data" },
  { id: METHOD_SECTIONS.model, title: "Model and measures" },
  { id: METHOD_SECTIONS.population, title: "Population impact" },
  { id: METHOD_SECTIONS.geography, title: "Figures by area" },
  { id: METHOD_SECTIONS.young, title: "Young people" },
  { id: METHOD_SECTIONS.personal, title: "Personal impact" },
  { id: METHOD_SECTIONS.living, title: "Living standards" },
  { id: METHOD_SECTIONS.limitations, title: "Limitations" },
  { id: METHOD_SECTIONS.versions, title: "Versions and replication" },
];

// How the national figures are made, as the steps of the flow at the top
const FLOW = [
  {
    title: "Survey data",
    text: "Microcosm UK 2024-25: households from the Family Resources Survey, with calibrated weights.",
  },
  {
    title: "Tax-benefit model",
    text: "PolicyEngine UK works out each household's taxes, benefits and net income in each year.",
  },
  {
    title: "Two scenarios",
    text: "Each candidate measure is run against current law, for every fiscal year shown.",
  },
  {
    title: "Static estimates",
    text: "The difference is the measure's effect, with behavioural responses left out.",
  },
  {
    title: "Published figures",
    text: "Figures pass disclosure checks, and a named reviewer signs off each public data file; a file awaiting sign-off is marked pending.",
  },
];

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const SCATTER_CHANGE_MAX = SCATTER_BINS.change_edges[SCATTER_BINS.change_edges.length - 1];
const SCATTER_CHANGE_EDGES = SCATTER_BINS.change_edges
  .filter((edge) => edge > 0)
  .map(pounds)
  .join(", ");
const yearRange = `${fiscalYearTick(FIRST_DISPLAY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}`;

/** A section of the view: its title outside the cards, then its cards. */
function MethodSection({ id, title, subtitle, children }) {
  return (
    <section id={id} className="method-section" aria-labelledby={`${id}-title`}>
      <div className="section-heading">
        <h2 id={`${id}-title`} tabIndex={-1}>
          {title}
        </h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/** A link to another view (at one of its sub-tabs), switched to in place. */
function ViewLink({ tab, sub, hash, onShowTab, children }) {
  return (
    <a
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        if (sub) onShowTab(tab, sub);
        else onShowTab(tab);
        if (hash) {
          setTimeout(() => {
            document.getElementById(hash)?.scrollIntoView?.({ behavior: "smooth" });
          }, 50);
        }
      }}
    >
      {children}
    </a>
  );
}

/** A link to another section of this view. */
function SectionLink({ id, children }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        goToSection(id);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The Methodology view: how the other views' figures are made, gathered in
 * one place, with a contents list beside it. Each note is said here and
 * nowhere else on the page; the policy descriptions stay with Population
 * impact, and the household calculation with Personal impact's "About
 * these figures". Living standards states the engine, data, notes and gaps
 * of that view's projections.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onShowTab - Switch to another view (at a sub-tab)
 */
function MethodologyTab({ onShowTab }) {
  const policyNotes = (text) => (
    <ViewLink tab="dashboard" hash="policy-details" onShowTab={onShowTab}>
      {text}
    </ViewLink>
  );

  return (
    <div className="methodology-tab">
      <MethodContents sections={METHOD_CONTENTS} />

      <div className="method-body">
        <MethodSection
          id={METHOD_SECTIONS.overview}
          title="At a glance"
          subtitle="How the figures on this dashboard are made."
        >
          <div className="card method-card">
            <p className="method-lead">
              The national figures come from a microsimulation: a tax-benefit
              model applied to a representative survey of UK households. Each
              candidate measure is compared with current law, household by
              household, and the results are weighted up to the whole
              country. Personal impact applies the same model and measures to
              one household&apos;s answers. Living standards uses the same
              model and data to project incomes and poverty with no Budget
              measures applied.
            </p>
            <ol className="method-flow" aria-label="How the numbers are made">
              {FLOW.map((step, index) => (
                <li key={step.title} className="method-flow-step">
                  <span className="method-flow-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="method-flow-title">{step.title}</span>
                  <span className="method-flow-text">{step.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.data}
          title="Data"
          subtitle="The households the national figures are built from."
        >
          <div className="card method-card">
            <FactList
              items={[
                [
                  "Dataset",
                  <>
                    Microcosm UK 2024-25, national file (
                    <code>microcosm_uk_2024_25</code>): the certified dataset
                    the policyengine.py release pins. The release pins the
                    model version and the dataset built and certified with it
                    together, so the two cannot drift apart.
                  </>,
                ],
                [
                  "Survey",
                  "Built from households in the Family Resources Survey, 2024-25. A survey household can appear as several records, each linked to the household it was made from.",
                ],
                [
                  "Weights",
                  "Each household carries a weight: how many UK households it stands for. The weights are calibrated, and the release pins the calibration with the data.",
                ],
                [
                  "Projection",
                  "Incomes and prices are projected from the survey year to each year shown with policyengine-uk's economic assumptions: the OBR's March 2026 Economic and Fiscal Outlook to 2030, then long-run assumptions from 2031.",
                ],
                [
                  "Small groups",
                  <>
                    Every figure adds up survey households, so a figure for a
                    small group rests on few of them. The page leaves out or
                    marks such figures: see the{" "}
                    <SectionLink id={METHOD_SECTIONS.population}>household scatter</SectionLink>
                    , <SectionLink id={METHOD_SECTIONS.geography}>figures by area</SectionLink> and{" "}
                    <SectionLink id={METHOD_SECTIONS.young}>young people</SectionLink>.
                  </>,
                ],
              ]}
            />
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.model}
          title="Model and measures"
          subtitle="How the candidate measures are represented in the model."
        >
          <div className="card method-card">
            <FactList
              items={[
                [
                  "Model",
                  "PolicyEngine UK, run through policyengine.py on the dataset above.",
                ],
                [
                  "Baseline",
                  "Current law in policyengine-uk, before the Budget. Each candidate measure changes it, so the difference between the two runs is the measure. The Plan 2 measure's baseline also uses modelled student loan repayments.",
                ],
                [
                  "Static",
                  "Households do not change their behaviour in response to a measure. Fuel and electricity spending are held fixed, and wages do not respond to employer National Insurance.",
                ],
                [
                  "Years",
                  "Fiscal years: 2027 means 2027-28.",
                ],
              ]}
            />
          </div>

          <div className="card method-card method-table-card">
            <h3 className="method-card-title">How each measure is modelled</h3>
            <table className="method-measures">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">How it is modelled</th>
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {MEASURE_MODELLING.map((measure) => (
                  <tr key={measure.name}>
                    <th scope="row">
                      <span
                        className="method-swatch"
                        style={{ background: POLICY_COLORS[measure.name] }}
                        aria-hidden="true"
                      />
                      {measure.name}
                    </th>
                    <td>{measure.how}</td>
                    <td className="method-measure-year">
                      <span className="method-cell-label">From </span>
                      {fiscalYearTick(measure.from)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="method-more">
              What each measure does is in the {policyNotes("policy notes on Population impact")}.
              Measures are written as parameter changes where possible, or
              built from tested measure templates.
            </p>
          </div>

          <div className="card method-card method-table-card">
            <h3 className="method-card-title">Likely but not modelled</h3>
            <p className="method-more">
              Reported as likely for the Budget, but outside what the household
              model can cost, so not on the page.
            </p>
            <table className="method-measures">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Why it is not modelled</th>
                </tr>
              </thead>
              <tbody>
                {NOT_MODELLED.map((measure) => (
                  <tr key={measure.name}>
                    <th scope="row">{measure.name}</th>
                    <td>{measure.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.population}
          title="Population impact"
          subtitle="What the charts on Population impact measure."
        >
          <div className="card method-card">
            <h3 className="method-card-title">Public finances</h3>
            <FactList
              items={[
                [
                  "Budgetary impact",
                  "The change in the government's balance, in £ billion a year: taxes collected less benefits and other spending, summed over all households with their weights. Each measure's figure is net of every tax and spending change it causes.",
                ],
                [
                  "Exceptions",
                  <>
                    The Plan 2 student loan measure counts the change in loan
                    repayments. The employer National Insurance relief changes
                    revenue only (see{" "}
                    <SectionLink id={METHOD_SECTIONS.model}>Static</SectionLink>).
                  </>,
                ],
                ["Years", `Fiscal years ${yearRange}.`],
                [
                  "Net impact",
                  <>
                    With several measures selected, the net line adds their
                    separate effects (see{" "}
                    <SectionLink id={METHOD_SECTIONS.limitations}>limitations</SectionLink>).
                  </>,
                ],
                [
                  "OBR comparison",
                  "Our figures are static. Where the OBR has costed a measure, the comparison opens on its static costing; choose Post-behavioural to include its estimate of behavioural responses.",
                ],
              ]}
            />
          </div>

          <div className="card method-card">
            <h3 className="method-card-title">Households by income</h3>
            <FactList
              items={[
                [
                  "Income deciles",
                  "Households are ranked by their baseline equivalised household net income before housing costs (the HBAI measure, adjusted for household size), then split into ten groups with equal numbers of people. Negative incomes count as zero for the ranking. Households without a decile are left out.",
                ],
                [
                  "Absolute change",
                  "The average change in household net income per household in each decile, in £ a year.",
                ],
                [
                  "Relative change",
                  "The decile's total change in household net income as a percentage of its total baseline net income.",
                ],
              ]}
            />
          </div>

          <div className="card method-card">
            <h3 className="method-card-title">Where and who</h3>
            <FactList
              items={[
                [
                  "Map",
                  <>
                    See <SectionLink id={METHOD_SECTIONS.geography}>figures by area</SectionLink>.
                  </>,
                ],
                [
                  "Household scatter bands",
                  `Households are grouped by their 2027-28 baseline net income, in ${pounds(SCATTER_BINS.income_band_width)} bands up to ${pounds(SCATTER_BINS.income_max)}, so a group is the same households in every year, and by change in net income, in bands that are narrow near zero and wider further out: edges at ±${SCATTER_CHANGE_EDGES}. Changes of ${pounds(SCATTER_CHANGE_MAX)} or more either way form one open band at each end. The chart draws about 500 dots, as the 2025 dashboard's sample of households did: each income group gets a share in proportion to its households in 2027-28. In the year shown, a group's dots are spread across its households' changes (its k-th dot at the group's k-th quantile), so a dot keeps its row and moves only sideways between years. Its change axis runs from −£5,000 to £5,000, so the open bands fall outside it.`,
                ],
                [
                  "Gain, loss, no change",
                  "A group is no change when its households' net income changes by less than £1 either way, a gain from £1 up and a loss from −£1 down. Gain bands include their lower edge and loss bands their upper one, so the bands mirror about zero.",
                ],
                [
                  "Disclosure",
                  `Household counts are weighted and rounded to the nearest ${SCATTER_BINS.round_to.toLocaleString("en-GB")}. No household is shown on its own. Groups come from one simulation of the selection, a single measure or all of them, and are never added up.`,
                ],
              ]}
            />
          </div>

          <div className="card method-card">
            <h3 className="method-card-title">Example households</h3>
            <p className="method-lead">
              Five households, each with a fixed set of circumstances. Each
              chart varies one income, from £0 up to the top of its axis.
            </p>
            <FactList
              className="method-facts-wide"
              items={EXAMPLE_HOUSEHOLDS.map((household) => [
                household.label,
                household.definition,
              ])}
            />
            <p className="method-more">
              <ViewLink tab="dashboard" hash="household" onShowTab={onShowTab}>
                See the example household charts
              </ViewLink>
              .
            </p>
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.geography}
          title="Figures by area"
          subtitle="How the constituency figures on Population impact are estimated."
        >
          <div className="card method-card">
            <GeographyMethodology />
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.young}
          title="Young people"
          subtitle="The definitions behind Population impact's Young people results."
        >
          <div className="card method-card">
            <FactList
              items={[
                [
                  "Age bands",
                  <>
                    {AGE_BANDS.map((band) => band.label).join(", ")}, and all ages. The adult
                    bands are the Office for National Statistics' standard Labour Force
                    Survey age groups (
                    <a href={AGE_BAND_SOURCE.url} target="_blank" rel="noopener noreferrer">
                      {AGE_BAND_SOURCE.label}
                    </a>
                    , which splits 16 to 24 into 16 to 17 and 18 to 24). 16 to 24 is the
                    ONS labour-market definition of young people. Children are under 16, as
                    in ONS population statistics and DWP&apos;s Households Below Average
                    Income; unlike HBAI, the bands count 16- to 19-year-olds in full-time non-advanced
                    education with 16 to 24, not as children.
                  </>,
                ],
                [
                  "Single year of age",
                  `One bar per year of age from ${SINGLE_AGE_FIRST} to ${SINGLE_AGE_LAST}.`,
                ],
                [
                  "Who counts",
                  `People in households with an income decile. An age band or single year of age with fewer than ${MIN_SAMPLE_SIZE} survey records is not shown.`,
                ],
                [
                  "Better or worse off",
                  "Better off when their household's net income rises by more than 0.01% of its baseline net income (taking a baseline below £1 as £1); worse off when it falls by more than that; otherwise unchanged.",
                ],
              ]}
            />
            <p className="method-more">
              <ViewLink tab="dashboard" sub="young" hash="young-people" onShowTab={onShowTab}>
                See Young people under Population impact
              </ViewLink>
              .
            </p>
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.personal}
          title="Personal impact"
          subtitle="The calculation behind Personal impact."
        >
          <div id={METHOD_SECTIONS.singleYear} className="card method-card method-anchor">
            <h3 className="method-card-title">Household calculation</h3>
            <p>
              How one household&apos;s figures are worked out is under
              &ldquo;About these figures&rdquo;, below the results on the{" "}
              <ViewLink tab="personal" onShowTab={onShowTab}>
                Personal impact tab
              </ViewLink>
              .
            </p>
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.living}
          title="Living standards"
          subtitle="The projections behind the Living standards tab."
        >
          <div className="card method-card">
            <p>
              The{" "}
              <ViewLink tab="living" onShowTab={onShowTab}>
                Living standards
              </ViewLink>{" "}
              view projects incomes and poverty under current law, with no
              Budget measures applied.
            </p>
          </div>
          <LivingStandardsMethod />
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.limitations}
          title="Limitations"
          subtitle="What to bear in mind when reading the figures."
        >
          <div className="card method-card">
            <FactList
              items={[
                [
                  "Measures added up",
                  "Each measure is also simulated on its own. Where several are selected, the revenue, decile and age charts add up their separate effects, so they leave out interactions between measures. The household scatter and the shares better and worse off come from a run of the whole selection, so they include them, and show nothing for a selection with no such run.",
                ],
                [
                  "Pre-Budget basis",
                  "The economic assumptions and the weights are pre-Budget: they are not yet rebased on the Budget's OBR forecast.",
                ],
                [
                  "Survey coverage",
                  <>
                    Surveys miss or under-record some incomes. The{" "}
                    {policyNotes("policy notes")} say where this affects a
                    measure.
                  </>,
                ],
              ]}
            />
          </div>
        </MethodSection>

        <MethodSection id={METHOD_SECTIONS.versions} title="Versions and replication">
          <div className="card method-card">
            <p>
              The replication code and the engine version behind these figures
              are in the line at the foot of the page.
            </p>
            <p>
              Methods and sources: our research on the{" "}
              {RESEARCH.map(([href, label], index) => (
                <span key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                  {index < RESEARCH.length - 2 ? ", " : index === RESEARCH.length - 2 ? " and " : ""}
                </span>
              ))}
              .
            </p>
          </div>
        </MethodSection>
      </div>
    </div>
  );
}

export default MethodologyTab;
