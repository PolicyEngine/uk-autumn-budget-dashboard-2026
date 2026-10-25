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
import { BackToTop, Callout, IconChip, SourceLink, Tag } from "./methodology/MethodUi";
import ExpandableText from "./methodology/ExpandableText";
import {
  Briefcase,
  Calculator,
  ChevronDown,
  CircleSlash,
  ChartColumn,
  Compass,
  Database,
  House,
  Info,
  MapPinned,
  PersonStanding,
  TrendingUp,
  TriangleAlert,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import "./methodology/Methodology.css";

/**
 * The ids of the Methodology view's sections, for links to them. Other
 * views link with these (the map to `geography`, Household impact to
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
};

/** The sections in the contents, in page order (the household calculation's block sits inside Household impact). */
export const METHOD_CONTENTS = [
  { id: METHOD_SECTIONS.overview, title: "At a glance", icon: Compass },
  { id: METHOD_SECTIONS.data, title: "Data", icon: Database },
  { id: METHOD_SECTIONS.model, title: "Model and measures", icon: Calculator },
  { id: METHOD_SECTIONS.population, title: "Population impact", icon: ChartColumn },
  { id: METHOD_SECTIONS.geography, title: "Figures by area", icon: MapPinned },
  { id: METHOD_SECTIONS.young, title: "Young people", icon: Users },
  { id: METHOD_SECTIONS.personal, title: "Household impact", icon: House },
  { id: METHOD_SECTIONS.living, title: "Living standards", icon: TrendingUp },
  { id: METHOD_SECTIONS.limitations, title: "Limitations", icon: TriangleAlert },
];

const SECTION_ICONS = Object.fromEntries(METHOD_CONTENTS.map(({ id, icon }) => [id, icon]));

// An icon for each example household, by its id
const HOUSEHOLD_ICONS = {
  single_renter: User,
  couple_three_children: Users,
  lone_parent: PersonStanding,
  pensioner_couple: UsersRound,
  higher_income_saver: Briefcase,
};

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const SCATTER_CHANGE_MAX = SCATTER_BINS.change_edges[SCATTER_BINS.change_edges.length - 1];
const SCATTER_CHANGE_EDGE_LIST = SCATTER_BINS.change_edges.filter((edge) => edge > 0).map(pounds);
const SCATTER_CHANGE_EDGES = SCATTER_CHANGE_EDGE_LIST.join(", ");
const yearRange = `${fiscalYearTick(FIRST_DISPLAY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}`;

/**
 * A section of the view: a header (icon and title), a short summary that
 * reads on its own, then the technical details, closed until asked for.
 */
function MethodSection({ id, title, summary, details, children, detailsLabel = "Technical details" }) {
  return (
    <section id={id} className="method-section" aria-labelledby={`${id}-title`}>
      <div className="section-heading method-section-heading">
        <IconChip icon={SECTION_ICONS[id]} />
        <div className="method-section-titles">
          <h2 id={`${id}-title`} tabIndex={-1}>
            {title}
          </h2>
        </div>
      </div>
      {summary && <div className="method-summary">{summary}</div>}
      {children}
      {details && (
        <details className="method-details">
          <summary>
            {detailsLabel}
            <ChevronDown aria-hidden="true" strokeWidth={1.75} />
          </summary>
          <div className="method-details-body">{details}</div>
        </details>
      )}
      {id !== METHOD_SECTIONS.overview && <BackToTop targetId={METHOD_SECTIONS.overview} />}
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
 * impact, and the household calculation with Household impact's "About
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
          summary={
            <p>
              We run PolicyEngine UK on a representative survey of UK households, with and without
              each measure, and weight the difference up to the whole country.
            </p>
          }
        />

        <MethodSection
          id={METHOD_SECTIONS.data}
          title="Data"
          summary={
            <p>
              The households come from the{" "}
              <SourceLink id="frs_2024_25">Family Resources Survey, 2024-25</SourceLink>, built
              into <SourceLink id="microcosm">Microcosm UK 2024-25</SourceLink>, where each one
              carries a weight: how many UK households it stands for. Their incomes and prices are
              projected forward to each year shown with{" "}
              <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s economic
              assumptions.
            </p>
          }
          details={
            <FactList
              items={[
                [
                  "Dataset",
                  <>
                    The national file (<code>microcosm_uk_2024_25</code>), certified and pinned with
                    the model version in the{" "}
                    <SourceLink id="policyengine_py_release">policyengine.py release</SourceLink>, so
                    the two cannot drift apart.
                  </>,
                ],
                [
                  "Survey",
                  "A survey household can appear as several records, each linked to the household it was made from.",
                ],
                ["Weights", "Calibrated; the release pins the calibration with the data."],
                [
                  "Projection",
                  <>
                    Over the forecast period, the <SourceLink id="obr_efo_current" />; after it,
                    the OBR&apos;s long-run assumptions (
                    <SourceLink id="obr_fiscal_risks">Fiscal risks and sustainability</SourceLink>).
                  </>,
                ],
                [
                  "Small groups",
                  <>
                    A figure for a small group rests on few survey households, so the page leaves
                    out or marks such figures: see the{" "}
                    <SectionLink id={METHOD_SECTIONS.population}>household scatter</SectionLink>,{" "}
                    <SectionLink id={METHOD_SECTIONS.geography}>figures by area</SectionLink> and{" "}
                    <SectionLink id={METHOD_SECTIONS.young}>young people</SectionLink>.
                  </>,
                ],
              ]}
            />
          }
        />

        <MethodSection
          id={METHOD_SECTIONS.model}
          title="Model and measures"
          summary={
            <p>
              PolicyEngine UK works out each household&apos;s taxes, benefits and net income under
              current law, then again with a measure; the difference between the two runs is the
              measure&apos;s effect. The estimates are static: households do not change their
              behaviour in response. What each measure does is in the{" "}
              {policyNotes("policy notes on Population impact")}; how the model represents it is
              below.
            </p>
          }
          details={
            <>
              <FactList
                items={[
                  ["Model", "PolicyEngine UK (policyengine-uk), run through policyengine.py on the dataset above."],
                  ["Baseline", "The Plan 2 measure's baseline also uses modelled student loan repayments."],
                  [
                    "Static",
                    "Fuel and electricity spending are held fixed, and wages do not respond to employer National Insurance.",
                  ],
                  ["Years", "Fiscal years: 2027 means 2027-28."],
                ]}
              />
              <p className="method-more">
                Measures are written as parameter changes where possible, or built from tested
                measure templates.
              </p>
            </>
          }
        >
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
                    <td>
                      <ExpandableText text={measure.how} />
                      {measure.sources && (
                        <span className="method-sources">
                          Sources:{" "}
                          {measure.sources.map((id, index) => (
                            <span key={id}>
                              {index > 0 && "; "}
                              <SourceLink id={id} />
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="method-measure-year">
                      <Tag tone="teal">
                        <span className="method-cell-label">From </span>
                        {fiscalYearTick(measure.from)}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card method-card method-table-card method-muted-card">
            <h3 className="method-card-title">Not modelled</h3>
            <table className="method-measures method-measures-muted method-measures-compact">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Why the household model cannot cost it</th>
                </tr>
              </thead>
              <tbody>
                {NOT_MODELLED.map((measure) => (
                  <tr key={measure.name}>
                    <th scope="row">
                      <span className="method-row-name">
                        <CircleSlash className="method-row-icon" aria-hidden="true" strokeWidth={1.75} />
                        {measure.name}
                      </span>
                    </th>
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
          summary={
            <p>
              The national charts add up every household&apos;s change with its weight: the revenue
              chart as the change in the government&apos;s balance, the decile charts by income
              group, and the household scatter and{" "}
              <ViewLink tab="dashboard" hash="household" onShowTab={onShowTab}>
                example households
              </ViewLink>{" "}
              for the spread behind the averages. Counts are rounded and no household is ever
              shown on its own.
            </p>
          }
          details={
            <>
              <h3 className="method-details-title">Public finances</h3>
              <FactList
                items={[
                  [
                    "Budgetary impact",
                    {
                      value: "Taxes collected less benefits and other spending, in £ billion a year.",
                      more: ["Each measure's figure is net of every tax and spending change it causes."],
                    },
                  ],
                  [
                    "Exceptions",
                    {
                      value: "Two measures are counted differently.",
                      more: [
                        <>
                          The Plan 2 student loan measure counts the change in loan repayments (
                          <SourceLink id="student_loan_thresholds">repayment thresholds</SourceLink>).
                        </>,
                        <>
                          The employer National Insurance relief changes revenue only (see{" "}
                          <SectionLink id={METHOD_SECTIONS.model}>Model and measures</SectionLink>).
                        </>,
                      ],
                    },
                  ],
                  ["Years", `Fiscal years ${yearRange}.`],
                  [
                    "Net impact",
                    <>
                      With several measures selected, the net line adds their separate effects (see{" "}
                      <SectionLink id={METHOD_SECTIONS.limitations}>limitations</SectionLink>).
                    </>,
                  ],
                  [
                    "OBR comparison",
                    {
                      value: "Opens on the OBR's static costing, like ours, where it has one.",
                      more: ["Choose Post-behavioural to include the OBR's estimate of behavioural responses."],
                    },
                  ],
                ]}
              />
              <h3 className="method-details-title">Households by income</h3>
              <FactList
                items={[
                  [
                    "Income deciles",
                    {
                      value: "Ten groups of equal numbers of people, by household income.",
                      more: [
                        <>
                          Ranked by baseline equivalised household net income before housing costs (the{" "}
                          <SourceLink id="dwp_hbai">HBAI</SourceLink> measure).
                        </>,
                        "Negative incomes count as zero for the ranking.",
                        "Households without a decile are left out.",
                      ],
                    },
                  ],
                  ["Absolute change", "The average change in household net income per household, in £ a year."],
                  ["Relative change", "The decile's total change as a percentage of its total baseline net income."],
                ]}
              />
              <h3 className="method-details-title">Household scatter</h3>
              <FactList
                items={[
                  [
                    "Household scatter bands",
                    {
                      value: "Households grouped by income and by change in income.",
                      more: [
                        `Income: 2027-28 baseline net income, in ${pounds(SCATTER_BINS.income_band_width)} bands up to ${pounds(SCATTER_BINS.income_max)}, so a group is the same households in every year.`,
                        <>
                          Change: band edges either way at
                          <span className="method-chips" aria-label={`Band edges: ${SCATTER_CHANGE_EDGES}`}>
                            {SCATTER_CHANGE_EDGE_LIST.map((edge) => (
                              <Tag key={edge}>{edge}</Tag>
                            ))}
                          </span>
                        </>,
                        `Changes of ${pounds(SCATTER_CHANGE_MAX)} or more either way form one open band at each end, outside the chart's −£5,000 to £5,000 axis.`,
                        "One circle per published group, at its middle income and change; its area is in proportion to its households, with a minimum size so the smallest group still shows.",
                      ],
                    },
                  ],
                  [
                    "Gain, loss, no change",
                    {
                      value: "No change is under £1 either way; a gain is £1 or more up, a loss £1 or more down.",
                      more: ["Gain bands include their lower edge and loss bands their upper one, so the bands mirror about zero."],
                    },
                  ],
                  [
                    "Disclosure",
                    {
                      value: `Counts are weighted and rounded to the nearest ${SCATTER_BINS.round_to.toLocaleString("en-GB")}.`,
                      more: ["Groups come from one simulation of the selection and are never added up."],
                    },
                  ],
                  [
                    "Sign-off",
                    {
                      value: "A named reviewer signs off every public data file before it is published.",
                      more: ["A file awaiting sign-off is marked pending, and a pending file expires after 14 days at most."],
                    },
                  ],
                ]}
              />
              <h3 className="method-details-title">Example households</h3>
              <p className="method-more">
                Each chart varies one income, from £0 to the top of its axis, for a fixed household.
              </p>
              <ul className="method-households">
                {EXAMPLE_HOUSEHOLDS.map((household) => (
                  <li key={household.id} className="method-household">
                    <IconChip icon={HOUSEHOLD_ICONS[household.id] ?? User} size="sm" />
                    <div>
                      <h4 className="method-household-name">{household.label}</h4>
                      <p className="method-household-text">{household.definition}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          }
        />

        <MethodSection
          id={METHOD_SECTIONS.geography}
          title="Figures by area"
          summary={
            <p>
              Regional and constituency figures come from the same survey. Each is published only
              after disclosure checks, with a 90% interval, and the map colours a constituency only
              when its interval is narrow enough to place it.
            </p>
          }
          details={<GeographyMethodology />}
        />

        <MethodSection
          id={METHOD_SECTIONS.young}
          title="Young people"
          summary={
            <p>
              The{" "}
              <ViewLink tab="dashboard" sub="young" hash="young-people" onShowTab={onShowTab}>
                Young people results
              </ViewLink>{" "}
              split everyone into the Office for National Statistics&apos; age bands, with 16 to 24
              as young people, and count who is better or worse off in each.
            </p>
          }
          details={
            <FactList
              items={[
                [
                  "Age bands",
                  {
                    value: (
                      <>
                        {AGE_BANDS.filter((band) => band.label !== "All ages")
                          .map((band) => band.label)
                          .join(", ")
                          .replace(/, ([^,]*)$/, " and $1")}
                        : the ONS Labour Force Survey age groups (A05), with 16 to 24 as the ONS
                        definition of young people.
                      </>
                    ),
                    more: [
                      <>
                        <a href={AGE_BAND_SOURCE.url} target="_blank" rel="noopener noreferrer">
                          ONS A05 SA
                        </a>{" "}
                        splits 16 to 24 into 16 to 17 and 18 to 24.
                      </>,
                      <>
                        Children are under 16, as in{" "}
                        <SourceLink id="ons_mid_year_estimates">ONS population statistics</SourceLink> and{" "}
                        <SourceLink id="dwp_hbai">HBAI</SourceLink>.
                      </>,
                      "Unlike HBAI, 16- to 19-year-olds in full-time non-advanced education count in 16 to 24, not as children.",
                      "Each chart also shows all ages.",
                    ],
                  },
                ],
                ["Single year of age", `One bar per year of age from ${SINGLE_AGE_FIRST} to ${SINGLE_AGE_LAST}.`],
                [
                  "Who counts",
                  {
                    value: "People in households with an income decile.",
                    more: [`A band or age with fewer than ${MIN_SAMPLE_SIZE} survey records is not shown.`],
                  },
                ],
                [
                  "Better or worse off",
                  {
                    value: "Household net income rises or falls by more than 0.01%; otherwise unchanged.",
                    more: ["The 0.01% is of baseline net income, with a baseline below £1 counted as £1."],
                  },
                ],
              ]}
            />
          }
        />

          <MethodSection
            id={METHOD_SECTIONS.personal}
            title="Household impact"
            summary={
              <div id={METHOD_SECTIONS.singleYear} className="method-anchor">
                <h3 className="method-card-title">Household calculation</h3>
                <p>
                  The same model and measures, applied to one household&apos;s answers. How it works
                  is under &ldquo;About these figures&rdquo;, below the results on the{" "}
                  <ViewLink tab="personal" onShowTab={onShowTab}>
                    Household impact tab
                  </ViewLink>
                  .
                </p>
              </div>
            }
          />

          <MethodSection
            id={METHOD_SECTIONS.living}
            title="Living standards"
            summary={
              <p>
                The{" "}
                <ViewLink tab="living" onShowTab={onShowTab}>
                  Living standards
                </ViewLink>{" "}
                view projects incomes and poverty under current law, with no measures applied, on
                the engine and data below.
              </p>
            }
            details={<LivingStandardsMethod />}
            detailsLabel="Engine, data and gaps"
          />

        <MethodSection
            id={METHOD_SECTIONS.limitations}
            title="Limitations"
            summary={
              <p>
                Most charts add up measures run separately, the economic assumptions follow one OBR
                forecast, and surveys under-record some incomes. Each is explained below.
              </p>
            }
            details={
              <div className="method-callouts">
                <Callout icon={Info} title="Measures added up">
                  Each measure is also simulated on its own. Where several are selected, the
                  revenue, decile and age charts add up their separate effects, so they leave out
                  interactions between measures; the household scatter and the shares better and
                  worse off come from a run of the whole selection, so they include them, and show
                  nothing for a selection with no such run.
                </Callout>
                <Callout icon={Info} title="Economic assumptions">
                  The economic assumptions and the weights follow the{" "}
                  <SourceLink id="obr_efo_current" />. Rebasing them on a new forecast is a separate
                  step.
                </Callout>
                <Callout icon={Info} title="Survey coverage">
                  The {policyNotes("policy notes")} say where this affects a measure.
                </Callout>
              </div>
            }
          />
      </div>
    </div>
  );
}

export default MethodologyTab;
