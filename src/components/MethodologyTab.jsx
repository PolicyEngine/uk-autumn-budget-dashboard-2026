import { useEffect } from "react";
import GeographyMethodology from "./GeographyMethodology";
import LivingStandardsMethod from "./methodology/LivingStandardsMethod";
import ForecastFeedMethod, { FORECAST_FEED_ANCHOR } from "./methodology/ForecastFeedMethod";
import FactList from "./methodology/FactList";
import MethodGlossary from "./methodology/MethodGlossary";
import SectionHeading from "./SectionHeading";
import { HIGHEST_PERCENTILE, LOWEST_PERCENTILE, ordinal } from "../utils/incomePosition";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { SINGLE_YEAR_METHOD } from "../utils/singleYear";
import MethodContents, { revealAnchor } from "./methodology/MethodContents";
import { NOT_MODELLED, unavailableMeasures } from "./methodology/measures";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { AGE_BANDS, AGE_BAND_SOURCE, MIN_SAMPLE_SIZE } from "../utils/ageImpact";
import { EARLY_YEAR, LAST_DISPLAY_YEAR } from "../utils/displayYears";
import { fiscalYearTick } from "../utils/chartTheme";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { OPEN_VIEW_EVENT } from "../utils/methodLink";
import { AnchorLink, ExternalLink, ReasonList, SourceLink, Tag, Topic } from "./methodology/MethodUi";
import { glossaryAnchor } from "./methodology/glossary";
import { Calculator, ChartColumn, Compass, Database, House, TrendingUp, TriangleAlert } from "lucide-react";
import "./methodology/Methodology.css";
import { scrollBelowBars, smoothUnlessReduced } from "../utils/pageScroll";

/**
 * The ids of the Methodology view's sections and of the topics other
 * views link to (the map to `geography`, the age cards to `young`), so a
 * key's id must not change.
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

/**
 * The sections in the contents, in page order: `icon` for the contents
 * list, `titleIcon` (TitleIcon) for the section's heading. Figures by area
 * and results by age are topics of Population impact.
 */
export const METHOD_CONTENTS = [
  { id: METHOD_SECTIONS.overview, title: "At a glance", icon: Compass, titleIcon: "compass" },
  { id: METHOD_SECTIONS.data, title: "Data", icon: Database, titleIcon: "database" },
  { id: METHOD_SECTIONS.model, title: "Model and policies", icon: Calculator, titleIcon: "calculator" },
  { id: METHOD_SECTIONS.population, title: "Population impact", icon: ChartColumn, titleIcon: "bars" },
  { id: METHOD_SECTIONS.personal, title: "Household calculator", icon: House, titleIcon: "house" },
  { id: METHOD_SECTIONS.living, title: "Pre-measures forecast", icon: TrendingUp, titleIcon: "trend" },
  { id: METHOD_SECTIONS.limitations, title: "Limitations", icon: TriangleAlert, titleIcon: "alert" },
];

const SECTION_ICONS = Object.fromEntries(METHOD_CONTENTS.map(({ id, titleIcon }) => [id, titleIcon]));

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const SCATTER_CHANGE_MAX = SCATTER_BINS.change_edges[SCATTER_BINS.change_edges.length - 1];
const SCATTER_CHANGE_EDGE_LIST = SCATTER_BINS.change_edges.filter((edge) => edge > 0).map(pounds);
const yearRange = `${fiscalYearTick(EARLY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}`;

/**
 * A section of the view, laid out as the other views' sections are: a
 * heading with its icon and a one-line summary, then its topics, each
 * folded until asked for.
 */
function MethodSection({ id, title, summary, children }) {
  return (
    <section id={id} className="method-section" aria-label={title}>
      <SectionHeading id={`${id}-heading`} icon={SECTION_ICONS[id]} title={title} subtitle={summary} />
      {children && <div className="card method-card method-topics">{children}</div>}
    </section>
  );
}

/** A link to another view (at one of its sub-tabs), switched to in place. */
function ViewLink({ tab, sub, age, hash, onShowTab, className, children }) {
  return (
    <a
      className={className}
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}${age ? `&age=${age}` : ""}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        // By age's group (?age=) goes with its sub-tab
        if (sub && age) onShowTab(tab, sub, { age });
        else if (sub) onShowTab(tab, sub);
        else onShowTab(tab);
        if (hash) {
          setTimeout(() => {
            scrollBelowBars(document.getElementById(hash), { behavior: smoothUnlessReduced() });
          }, 50);
        }
      }}
    >
      {children}
    </a>
  );
}

/** A shared term, linked to its definition under "Terms used on the charts". */
const Term = ({ id, children }) => <AnchorLink id={glossaryAnchor(id)}>{children}</AnchorLink>;

/**
 * Opened at an anchor (a link from another view, an address with a hash,
 * or a changed hash): open the topic it is folded in and bring it into view. The target
 * may load after the view (the forecast's notes), so look for up to 3
 * seconds.
 */
function useRevealLinkedAnchor() {
  useEffect(() => {
    let timer = 0;
    const reveal = (id) => {
      clearTimeout(timer);
      let tries = 0;
      const attempt = () => {
        if (revealAnchor(id, { smooth: false })) return;
        if ((tries += 1) < 30) timer = setTimeout(attempt, 100);
      };
      timer = setTimeout(attempt, 150);
    };
    const hash = window.location.hash.slice(1);
    if (hash) reveal(decodeURIComponent(hash));
    const onOpenView = (event) => {
      const { tab, anchor } = event.detail || {};
      if (tab === "methodology" && anchor) reveal(anchor);
    };
    const onHashChange = () => {
      const id = window.location.hash.slice(1);
      if (id) reveal(decodeURIComponent(id));
    };
    window.addEventListener(OPEN_VIEW_EVENT, onOpenView);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(OPEN_VIEW_EVENT, onOpenView);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
}

/**
 * The Methodology view: how the other views' figures are made, gathered in
 * one place, with a contents list beside it. Each section says in one line
 * what it covers; everything else is in its folded topics, and each note
 * is said once. The policy descriptions stay on Policies.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onShowTab - Switch to another view (at a sub-tab)
 */
function MethodologyTab({ onShowTab }) {
  const catalogue = useMeasureCatalogue();
  const UNAVAILABLE = unavailableMeasures(catalogue);
  useRevealLinkedAnchor();

  return (
    <div className="methodology-tab">
      <MethodContents sections={METHOD_CONTENTS} />

      <div className="method-body">
        <MethodSection
          id={METHOD_SECTIONS.overview}
          title="At a glance"
          summary={
            <>
              We run <SourceLink id="policyengine_uk_model">PolicyEngine UK</SourceLink>{" "}on a
              representative survey of UK households, with and without each policy, for each
              fiscal year from {yearRange}, and weight the difference up to the whole country.
            </>
          }
        >
          <Topic
            id={METHOD_ANCHORS.glossary}
            title="Terms used on the charts"
            preview="Net income, housing costs, deciles, poverty, Gini and other terms, one line each"
          >
            <MethodGlossary />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.data}
          title="Data"
          summary={
            <>
              Households from the <SourceLink id="frs_2024_25">Family Resources Survey 2024-25</SourceLink>,
              built into <SourceLink id="microcosm">Microcosm UK 2024-25</SourceLink>, each weighted
              to the number of UK households it stands for.
            </>
          }
        >
          <Topic title="The dataset" preview="Dataset · Pipeline · Survey · Weights · Projection · Small groups">
            <FactList
              items={[
                [
                  "Dataset",
                  <>
                    The national file (<code>microcosm_uk_2024_25</code>), certified and pinned with
                    the model version by the policyengine.py release this build uses
                    (in About this dashboard&apos;s Built with), so the
                    two cannot drift apart.
                  </>,
                ],
                [
                  "Pipeline",
                  {
                    value: (
                      <>
                        Built with <SourceLink id="microcosm_site">Microcosm</SourceLink>: a sequence of
                        stages adds to each Family Resources Survey household what the survey does not
                        record; calibration then sets each record&apos;s weight.
                      </>
                    ),
                    more: [
                      "The stages draw on other surveys and on administrative statistics for high incomes, wealth, spending, travel, benefit take-up, capital gains, pension salary sacrifice and student loans.",
                      "The same stages feed two files, certified together: the national file, and a local-area file for constituencies and local authorities.",
                      "Both files are built from survey microdata licensed through the UK Data Service, so they are not public downloads.",
                    ],
                  },
                ],
                [
                  "Survey",
                  "A survey household can appear as several records, each linked to the household it was made from.",
                ],
                [
                  "Weights",
                  {
                    value: (
                      <>
                        Calibrated to published totals for the UK, its nations and the English regions (
                        <SourceLink id="uk_calibration_targets">calibration targets</SourceLink>); the release
                        pins the calibration with the data.
                      </>
                    ),
                    more: [
                      "The totals include HMRC income and tax statistics, DWP benefit caseloads, OBR forecasts and ONS population estimates.",
                      "The local-area file is calibrated to constituency and local-authority totals as well.",
                    ],
                  },
                ],
                [
                  "Projection",
                  <>
                    Incomes and prices are projected to each year shown with{" "}
                    <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s economic
                    assumptions: over the forecast period, the <SourceLink id="obr_efo_current" />;
                    after it, the OBR&apos;s long-run assumptions (
                    <SourceLink id="obr_fiscal_risks">Fiscal risks and sustainability</SourceLink>).
                  </>,
                ],
                [
                  "Small groups",
                  <>
                    A figure for a small group rests on few survey households, so the page leaves
                    out or marks such figures: see the{" "}
                    <AnchorLink id={METHOD_ANCHORS.byIncome}>income deciles</AnchorLink>,{" "}
                    <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink>,{" "}
                    <AnchorLink id={METHOD_SECTIONS.geography}>figures by area</AnchorLink> and{" "}
                    <AnchorLink id={METHOD_SECTIONS.young}>results by age</AnchorLink>.
                  </>,
                ],
              ]}
            />
            <p className="method-more">
              <SourceLink id="uk_data_pipeline">Read how Microcosm UK is built today, stage by stage</SourceLink>.
              The page describes the current pipeline, which may be newer than this dashboard&apos;s data.
            </p>
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.model}
          title="Model and policies"
          summary={
            <>
              <SourceLink id="policyengine_uk_model">PolicyEngine UK</SourceLink>{" "}works out each
              household&apos;s taxes, benefits and <Term id="netIncome">net income</Term>{" "}under
              current law, then again with a policy; the difference is the policy&apos;s effect.
              What each policy does and how it is modelled is on{" "}
              <ViewLink tab="policies" onShowTab={onShowTab}>
                Policies
              </ViewLink>
              .
            </>
          }
        >
          <Topic title="The model" preview="Model · Baseline · Static · Years · Prices">
            <FactList
              items={[
                [
                  "Model",
                  <>
                    PolicyEngine UK (<SourceLink id="policyengine_uk">policyengine-uk</SourceLink>), run
                    through <SourceLink id="policyengine_py_release">policyengine.py</SourceLink>{" "}on
                    the <AnchorLink id={METHOD_SECTIONS.data}>data above</AnchorLink>. Measures are
                    written as parameter changes where possible, or built from tested measure
                    templates.
                  </>,
                ],
                ["Baseline", "Current law."],
                [
                  "Static",
                  <>
                    Estimates are <Term id="static">static</Term>; each policy's card says what its
                    estimate holds fixed.
                  </>,
                ],
                ["Years", "Fiscal years, April to March: 2027-28 runs from April 2027 to March 2028."],
                [
                  "Prices",
                  <>
                    <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink> and{" "}
                    <ViewLink tab="household" onShowTab={onShowTab}>Household calculator</ViewLink>{" "}figures
                    are in <Term id="real">cash terms</Term>{" "}for the year shown, not adjusted for
                    inflation.
                  </>,
                ],
              ]}
            />
          </Topic>
          {UNAVAILABLE.length > 0 && (
            <Topic title="Unavailable policies" preview="Policies with no verified results in the current publication">
              <ReasonList items={UNAVAILABLE} />
            </Topic>
          )}
          <Topic title="Not modelled" preview="Policies the household model cannot cost, and why">
            <ReasonList items={NOT_MODELLED} icon />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.population}
          title="Population impact"
          summary={
            <>
              The charts on{" "}
              <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink>{" "}add up
              every household&apos;s change with its weight, by income, age and area; no household
              is ever shown on its own.
            </>
          }
        >
          <Topic
            id={METHOD_ANCHORS.publicFinances}
            title="Public finances"
            preview="Budgetary impact · Exceptions · Net change · OBR comparison"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="finances" onShowTab={onShowTab}>revenue chart</ViewLink>{" "}
              shows the change in the government&apos;s balance.
            </p>
            <FactList
              items={[
                [
                  "Budgetary impact",
                  {
                    value: "Taxes collected less benefits and other spending, in £ billion a year.",
                    more: [
                      "It includes employer National Insurance and VAT receipts.",
                      "The employer National Insurance threshold's cost is net of the extra income tax and National Insurance on the higher pay it leads to.",
                    ],
                  },
                ],
                [
                  "Exceptions",
                  {
                    value: "A policy whose published description says it is costed another way follows that description.",
                    more: ["For example, from a Treasury cost estimate or from the change in loan repayments."],
                  },
                ],
                [
                  "Net change",
                  <>
                    With several policies selected, the net line adds their separate effects (see{" "}
                    <AnchorLink id={METHOD_SECTIONS.limitations}>limitations</AnchorLink>).
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
          </Topic>
          <Topic
            id={METHOD_ANCHORS.byIncome}
            title="Households by income"
            preview="Income deciles · Absolute change · Relative change"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="all" onShowTab={onShowTab}>decile charts</ViewLink>{" "}
              split the change by income group.
            </p>
            <FactList
              items={[
                [
                  "Income deciles",
                  {
                    value: "Ten groups of equal numbers of people, by household income.",
                    more: [
                      <>
                        Ranked by baseline <Term id="equivalised">equivalised</Term>{" "}household net
                        income <Term id="housingCosts">before housing costs</Term> (the{" "}
                        <SourceLink id="dwp_hbai">HBAI</SourceLink> measure).
                      </>,
                      "Negative incomes count as zero for the ranking.",
                      "Households without a decile are left out.",
                      "A measure whose change in any decile comes from only one or two survey households is not shown: the minimum the UK Data Service requires for survey data it supplies under its End User Licence.",
                    ],
                  },
                ],
                ["Absolute change", "The average change in household net income per household, in £ a year."],
                [
                  "Relative change",
                  <>
                    The decile&apos;s total change as a percentage of its total baseline net income
                    (the income under{" "}
                    <AnchorLink id={METHOD_ANCHORS.poverty}>Inequality</AnchorLink>).
                  </>,
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.poverty}
            title="Poverty and inequality"
            preview="Poverty rate · Inequality · Which run"
          >
            <FactList
              items={[
                [
                  "Poverty rate",
                  {
                    value: (
                      <>
                        The share of people in households in{" "}
                        <Term id="absolutePoverty">absolute poverty</Term>{" "}before housing costs, with
                        and without the policies.
                      </>
                    ),
                    more: [
                      <>
                        The poverty line is measured on <SourceLink id="dwp_hbai">HBAI</SourceLink>{" "}
                        income, which is before indirect taxes, so the VAT and fuel duty policies do
                        not change it.
                      </>,
                      "People moved out of or into poverty are the change in the rate times that year's population in the current-law projection, to the nearest 1,000.",
                    ],
                  },
                ],
                [
                  "Inequality",
                  <>
                    The relative change in the <Term id="gini">Gini coefficient</Term> of{" "}
                    <Term id="equivalised">equivalised</Term> household net income, people weighted.{" "}
                    This income includes public services in kind, such as the NHS and schools, and is
                    after fuel duty and other duties, counting any change in VAT, so the VAT and fuel
                    duty policies change it.
                  </>,
                ],
                [
                  "Which run",
                  <>
                    Neither adds up across policies, so each is read from one run: a policy&apos;s{" "}
                    <Term id="ownRuns">own</Term>, or the combined run when every policy is selected.
                  </>,
                ],
              ]}
            />
          </Topic>
          {/* Pavel's review MT1 to MT4: where this dashboard's definitions
              differ from the PolicyEngine app's */}
          <Topic
            id="definitions-compared"
            title="Definitions compared with the PolicyEngine app"
            preview="Inequality · Income deciles · Winners and losers · Poverty · Budget"
          >
            <FactList
              items={[
                [
                  "Inequality",
                  "The app uses HBAI income and counts each household once. Here inequality counts each person and uses the income described under Poverty and inequality.",
                ],
                [
                  "Income deciles",
                  "The app ranks households by household net income, not adjusted for household size, so its deciles differ.",
                ],
                [
                  "Winners and losers",
                  {
                    value: "Each chart has its own no-change threshold. None uses the app's 0.1% and 5% bands.",
                    more: [
                      <>
                        By age: as under <AnchorLink id={METHOD_SECTIONS.young}>Results by age</AnchorLink>.
                      </>,
                      "Figures by area: under 50p (or 0.005% of income) either way is no change. The map's Little change is under £10 (or 0.1%) either way.",
                      "Household scatter: under £1 either way is no change.",
                    ],
                  },
                ],
                [
                  "Poverty",
                  "The headline poverty measure here is absolute, before housing costs; the app's is relative, before housing costs. A child is a dependent child as HBAI defines one; the PolicyEngine app counts everyone aged 0 to 17.",
                ],
                [
                  "Budget",
                  "Here a policy is costed by its change in the government's balance, as set out under Public finances. The app costs it as the change in households' taxes less benefits, so its cost for the employer National Insurance threshold differs.",
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.scatter}
            title="Household scatter"
            preview="Bands · Gain, loss, no change · Disclosure · Sign-off"
          >
            <p className="method-more">The spread of changes behind the averages, as groups of households.</p>
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
                        <span className="method-chips">
                          {SCATTER_CHANGE_EDGE_LIST.map((edge) => (
                            <Tag key={edge}>{edge}</Tag>
                          ))}
                        </span>
                      </>,
                      `Changes of ${pounds(SCATTER_CHANGE_MAX)} or more either way form one open band at each end, outside the chart's −£5,000 to £5,000 axis.`,
                      "About 500 dots, shared out by each income group's households in 2027-28.",
                      "A group's k-th dot sits at its k-th quantile of change, so it keeps its row between years.",
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
          </Topic>
          <Topic
            id={METHOD_SECTIONS.geography}
            title="Figures by area"
            preview="Disclosure checks · 90% intervals · Map colours"
          >
            <p className="method-more">
              Regional and constituency figures come from the same survey. Each is published only
              after disclosure checks, with a 90% interval, and the map colours a constituency only
              when its interval is narrow enough to place it.
            </p>
            <GeographyMethodology />
          </Topic>
          <Topic
            id={METHOD_SECTIONS.young}
            title="Results by age"
            preview="Age bands · Change by year · Who counts · Pensioners"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="age" age="16-24" hash="young-people" onShowTab={onShowTab}>
                results by age
              </ViewLink>{" "}
              count winners and losers in each age band and single year of age.
            </p>
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
                        <ExternalLink href={AGE_BAND_SOURCE.url}>ONS A05 SA</ExternalLink>{" "}
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
                ["Single year of age", "One bar per year of age across the chosen age group; 90 and over is one bar."],
                [
                  "Change by year",
                  {
                    lead: "The Change by year chart on By age:",
                    points: [
                      "Each point is a whole fiscal year: all the selected policies run together when that run is published, otherwise the sum of each policy's own effect; the curve between points never goes past them.",
                      "A label names the policy behind each of the largest year-on-year steps.",
                      "Breakdown by policy stacks each policy's own change, with the net change as the line; the running total adds each year's change from the first year.",
                      "No share of income is shown: the results by age carry no income to divide by.",
                    ],
                  },
                ],
                [
                  "Who counts",
                  {
                    value: (
                      <>
                        People in households with an{" "}
                        <AnchorLink id={METHOD_ANCHORS.byIncome}>income decile</AnchorLink>.
                      </>
                    ),
                    more: [
                      `A band or age with fewer than ${MIN_SAMPLE_SIZE} records in the dataset is not shown. Microcosm builds several records from one survey household, so this counts records, not households.`,
                      "In the age and decile tables, a figure resting on one or two survey households is not published, nor any figure in the same table that would give it back.",
                      <>
                        Each person counts their whole household&apos;s change in net income, not
                        equivalised, and averages are <Term id="perPerson">per person</Term>.
                      </>,
                    ],
                  },
                ],
                [
                  "Pensioners",
                  <>
                    People at or over <Term id="statePensionAge">State Pension age</Term>, on{" "}
                    <ViewLink tab="dashboard" sub="age" age="pensioners" onShowTab={onShowTab}>By age, with Pensioners chosen</ViewLink>.
                  </>,
                ],
                [
                  "Winners and losers",
                  {
                    value: "Household net income rises or falls by more than 0.01%; otherwise no change.",
                    more: ["The 0.01% is of baseline net income, with a baseline below £1 counted as £1."],
                  },
                ],
              ]}
            />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.personal}
          title="Household calculator"
          summary={
            <span id={METHOD_SECTIONS.singleYear} className="method-anchor">
              The same model and policies, applied to one household&apos;s answers on the{" "}
              <ViewLink tab="household" onShowTab={onShowTab}>
                Household calculator tab
              </ViewLink>
              .
            </span>
          }
        >
          <Topic
            id={METHOD_ANCHORS.householdCalc}
            title="How the household calculation works"
            preview={SINGLE_YEAR_METHOD.map(([term]) => term).join(" · ")}
          >
            <FactList items={SINGLE_YEAR_METHOD.map(([term, text]) => [term, text])} />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.incomePosition}
            title="Where your income sits"
            preview="Income · Tenths · Distribution · Who moves · Among all households"
          >
            <FactList
              items={[
                [
                  "Income",
                  <>
                    Household net income after taxes (fuel duty and any change in VAT included) and
                    with benefits, divided by your household&apos;s size on the HBAI scale. Unlike the
                    income under <AnchorLink id={METHOD_ANCHORS.poverty}>Inequality</AnchorLink>, it
                    leaves out public services in kind.
                  </>,
                ],
                [
                  "Tenths",
                  "The tenths' average changes are the decile charts' own, ranked by HBAI income without VAT and fuel duty, so a household near a boundary may sit in the next tenth there. The average UK household's change has no published % of net income.",
                ],
                [
                  "Distribution",
                  `Published from the ${ordinal(LOWEST_PERCENTILE)} to the ${ordinal(HIGHEST_PERCENTILE)} percentile, as averages over bands one percentile wide; the lowest and highest 1% are not drawn.`,
                ],
                [
                  "Who moves",
                  "Everyone is ranked before and after the selected policies: a person moves up when the whole percentile (or tenth) of their rank is higher after. A share from fewer than 10 survey households is not published.",
                ],
                [
                  "Among all households",
                  "The Population impact scatter: each household sits by its 2027-28 net income before the policies, not adjusted for household size, in every year, and you by yours. Each dot is a group of households.",
                ],
              ]}
            />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.living}
          title="Pre-measures forecast"
          summary={
            <>
              Incomes and poverty under current law, before any policy, on the{" "}
              <ViewLink tab="outlook" sub="living" onShowTab={onShowTab}>
                Living standards
              </ViewLink>{" "}
              and{" "}
              <ViewLink tab="outlook" sub="poverty" onShowTab={onShowTab}>
                Poverty
              </ViewLink>{" "}
              tabs, built on the forecast that{" "}
              <ViewLink tab="outlook" sub="forecast" onShowTab={onShowTab}>
                Forecast changes
              </ViewLink>{" "}
              shows.
            </>
          }
        >
          {/* The Forecast changes sub-tab links here */}
          <Topic
            id={FORECAST_FEED_ANCHOR}
            title="How the forecast feeds the baseline"
            preview="Growth rates · Years past the forecast · Parameters"
          >
            <ForecastFeedMethod />
          </Topic>
          <LivingStandardsMethod />
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.limitations}
          title="Limitations"
          summary="Most charts add up policies run separately, the economic assumptions follow one OBR forecast, fuel duty covers households' own fuel only, and surveys under-record some incomes."
        >
          <Topic title="Policies added up" preview="Revenue, decile and age charts · Household scatter · Winners and losers">
            <p className="method-more">
              Each policy is also simulated on its own. Where several are selected, the revenue
              and decile charts add up their separate effects, so they leave out interactions
              between policies (<Term id="ownRuns">policies run on their own</Term>); the
              average-change age charts do so only when no run of the whole selection is
              published; the{" "}
              <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink>{" "}and the
              winners and losers charts come from a run of the whole selection, so they include
              interactions, and show nothing for a selection with no such run.
            </p>
            <p className="method-more">
              Some policies replace values reported in the survey with modelled ones, and their
              descriptions say so. That policy's own run and the run of all policies together use the
              modelled values, while the other policies on their own use the survey's. So the effects
              of each policy on its own need not add up to all policies together.
              Modelled values can depend on pay, as student loan repayments do. A
              policy that raises pay keeps the survey's values in its own run, and they do not rise
              with the higher pay, so on its own its cost is higher, and its fall in poverty larger,
              than in the run of all policies together.
            </p>
          </Topic>
          <Topic title="Economic assumptions" preview="One OBR forecast behind the assumptions and weights">
            <p className="method-more">
              The economic assumptions and the weights follow the{" "}
              <SourceLink id="obr_efo_current" />. Rebasing them on a new forecast is a separate
              step.
            </p>
          </Topic>
          <Topic title="Business fuel use" preview="Fuel duty on households' own purchases only">
            <p className="method-more">
              Fuel duty is modelled on households' own petrol and diesel purchases. Duty on fuel
              for vans, lorries and business use of cars, roughly half of fuel duty receipts, is
              not in the model, so the revenue from a change in fuel duty is lower than a full
              costing would show.
            </p>
          </Topic>
          <Topic title="Survey coverage" preview="Where under-recorded incomes affect a policy">
            <p className="method-more">
              The{" "}
              <ViewLink tab="policies" onShowTab={onShowTab}>
                policy notes
              </ViewLink>{" "}
              say where this affects a policy.
            </p>
          </Topic>
        </MethodSection>
      </div>
    </div>
  );
}

export default MethodologyTab;
