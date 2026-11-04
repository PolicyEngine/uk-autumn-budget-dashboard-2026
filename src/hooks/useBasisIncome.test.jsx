import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useBasisIncome, { clearBasisIncomeCache } from "./useBasisIncome";
import { clearHouseholdImpactCache, peekHouseholdImpact, seedHouseholdImpactCache } from "./useHouseholdImpact";
import { buildHouseholdRequest, normaliseHouseholdImpact, requestKey } from "../utils/householdImpactApi";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";
import { APPROVED_COMMIT, approvedDefinition, reportedDefinitions, requestedDefinitions } from "../test/definitionsFixture";
import { IDENTITY_FIELDS } from "../utils/publication/definitions";

const API = "https://api.test/api/household-impact";
const PUBLICATION = "snapshot-a";
const BASIS_YEAR = 2027;
const POLICIES = HOUSEHOLD_FIXTURE.included;
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = HOUSEHOLD_FIXTURE.engine;
const PUBLISHED_ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };
// Each measure's approved definition (synthetic: definitionsFixture.js)
const APPROVED = Object.fromEntries(POLICIES.map((id) => [id, approvedDefinition(id)]));
// The examples' measures: every published one, more than the selection
const PRESET = [...POLICIES, "another_measure"];
const PRESET_APPROVED = Object.fromEntries(PRESET.map((id) => [id, approvedDefinition(id)]));

// useHouseholdImpact's key for the basis-year request: snapshot, then request
const pageKey = (publication) =>
  `${publication}:${requestKey(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: POLICIES }))}`;
const presetKey = `${PUBLICATION}:${requestKey(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: PRESET }))}`;
// A cached answer, reporting `definitions` (each measure's approved one unless given)
const answer = (definitions = APPROVED) => ({
  ...normaliseHouseholdImpact(householdAnswerFor(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: POLICIES }))),
  definitions,
});
// What an API running the approved code answers: the definitions the
// request names, each at its approved commit
const approvedAnswer = (url, body) => ({ ...householdAnswerFor(body), definitions: reportedDefinitions(url) });

let asked;
let urls;
let respond;
beforeEach(() => {
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  asked = 0;
  urls = [];
  respond = approvedAnswer;
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", API);
  vi.stubGlobal("fetch", async (url, init) => {
    asked += 1;
    urls.push(String(url));
    return Response.json(respond(String(url), JSON.parse(init.body)));
  });
});
afterEach(() => {
  cleanup();
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const render = (overrides = {}) =>
  renderHook(() =>
    useBasisIncome({
      inputs: WIZARD_DEFAULTS,
      policies: POLICIES,
      publicationKey: PUBLICATION,
      expectedEngine: PUBLISHED_ENGINE,
      expectedDefinitions: APPROVED,
      basisYear: BASIS_YEAR,
      enabled: true,
      ...overrides,
    }),
  );

it("uses an answer the page cached under this publication snapshot, asking nothing", () => {
  const data = answer();
  seedHouseholdImpactCache([[pageKey(PUBLICATION), data]]);
  const { result } = render();
  expect(result.current).toEqual({ status: "ready", income: data.net.before });
  expect(asked).toBe(0);
});

it("ignores an answer cached under another publication snapshot and asks for its own", async () => {
  seedHouseholdImpactCache([[pageKey("snapshot-b"), answer()]]);
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(asked).toBe(1);
});

it("refuses its own answer when the package versions differ from the receipts'", async () => {
  const { result } = render({ expectedEngine: { ...PUBLISHED_ENGINE, "policyengine-uk": "0.0.0" } });
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.income).toBeNull();
});

it("never puts its own answer in the page's cache, which shows it as the headline", async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(Number.isFinite(result.current.income)).toBe(true);
  expect(peekHouseholdImpact(pageKey(PUBLICATION), PUBLISHED_ENGINE, APPROVED, POLICIES)).toBeNull();
  // and it is not asked for again while the session lasts
  const again = render();
  expect(again.result.current.status).toBe("ready");
  expect(asked).toBe(1);
});

it("ignores an answer cached under this snapshot from another engine, and asks for its own", async () => {
  const stale = { ...answer(), engine: { ...HOUSEHOLD_FIXTURE.engine, "policyengine-uk": "0.0.0-other" } };
  seedHouseholdImpactCache([[pageKey(PUBLICATION), stale]]);
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(asked).toBe(1);
});

// #136: the baseline is built from the selected measures' baseline side
// (household_impact.measure_sides), which a measure's baseline modifier
// changes, so an answer counts only when it reports the approved
// definition of every measure it was asked with.
it("names the approved definition of each measure it asks with", async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(urls).toHaveLength(1);
  expect(requestedDefinitions(urls[0]).sort()).toEqual(POLICIES.map((id) => [id, APPROVED_COMMIT]).sort());
});

// Every way one measure's reported definition can differ from its approved
// one: the commit, or one identity field on either side. Review of 48584d69
// (P1): a deployment on the receipts' engine whose baseline modifier
// changed reports another baseline identity.
const CHANGES = [
  ["git_sha", (definition) => ({ ...definition, git_sha: "f".repeat(40) })],
  ...["baseline", "reform"].flatMap((side) =>
    IDENTITY_FIELDS.map((field) => [
      `${side}.${field}`,
      (definition) => ({ ...definition, [side]: { ...definition[side], [field]: `another ${field}` } }),
    ]),
  ),
];
const ONE_CHANGED = POLICIES.flatMap((id) => CHANGES.map(([field, change]) => [id, field, change]));

it.each(ONE_CHANGED)(
  "refuses its own answer when %s's reported %s differs from the approved one, on the receipts' engine",
  async (id, _field, change) => {
    respond = (url, body) => {
      const reported = reportedDefinitions(url);
      return { ...householdAnswerFor(body), definitions: { ...reported, [id]: change(reported[id]) } };
    };
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.income).toBeNull();
  },
);

it.each([
  ["none", () => undefined],
  ["no definition for one measure", (url) => {
    const { [POLICIES[0]]: _left, ...rest } = reportedDefinitions(url);
    return rest;
  }],
])("refuses its own answer when it reports %s, and keeps nothing of it", async (_case, definitionsFor) => {
  respond = (url, body) => ({ ...householdAnswerFor(body), definitions: definitionsFor(url) });
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.income).toBeNull();
  // Asked again, it asks again, and takes an answer that reports them
  respond = approvedAnswer;
  const again = render();
  await waitFor(() => expect(again.result.current.status).toBe("ready"));
  expect(asked).toBe(2);
});

it.each([
  ["reports another baseline for a measure", answer({ ...APPROVED, [POLICIES[0]]: { ...APPROVED[POLICIES[0]], baseline: { ...APPROVED[POLICIES[0]].baseline, reform_sha256: "e".repeat(64) } } })],
  ["reports none", answer(null)],
  ["leaves a measure out", answer(Object.fromEntries(POLICIES.slice(1).map((id) => [id, APPROVED[id]])))],
])("ignores an answer cached under this snapshot that %s, and asks for its own", async (_case, data) => {
  seedHouseholdImpactCache([[pageKey(PUBLICATION), data]]);
  const { result } = render();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(asked).toBe(1);
});

it.each([
  ["no approved definitions at all", null],
  ["none for one selected measure", Object.fromEntries(POLICIES.slice(1).map((id) => [id, APPROVED[id]]))],
])("asks nothing and places nothing with %s", async (_case, expectedDefinitions) => {
  seedHouseholdImpactCache([[pageKey(PUBLICATION), answer()]]);
  const { result } = render({ expectedDefinitions });
  expect(result.current).toEqual({ status: "idle", income: null });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(asked).toBe(0);
});

it("asks again when the approved definitions change, never reusing an answer checked against others", async () => {
  const { result, rerender } = renderHook((props) => useBasisIncome(props), {
    initialProps: {
      inputs: WIZARD_DEFAULTS,
      policies: POLICIES,
      publicationKey: PUBLICATION,
      expectedEngine: PUBLISHED_ENGINE,
      expectedDefinitions: APPROVED,
      basisYear: BASIS_YEAR,
      enabled: true,
    },
  });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  const moved = Object.fromEntries(POLICIES.map((id) => [id, { ...APPROVED[id], git_sha: "a".repeat(40) }]));
  rerender({
    inputs: WIZARD_DEFAULTS,
    policies: POLICIES,
    publicationKey: PUBLICATION,
    expectedEngine: PUBLISHED_ENGINE,
    expectedDefinitions: moved,
    basisYear: BASIS_YEAR,
    enabled: true,
  });
  await waitFor(() => expect(asked).toBe(2));
  expect(requestedDefinitions(urls[1]).map(([, commit]) => commit)).toEqual(POLICIES.map(() => "a".repeat(40)));
});

describe("the examples' precomputed answers, asked with every published measure", () => {
  it("are used when they report each of those measures' approved definitions", () => {
    const data = { ...answer(), definitions: PRESET_APPROVED };
    seedHouseholdImpactCache([[presetKey, data]]);
    const { result } = render({ presetPolicies: PRESET, presetDefinitions: PRESET_APPROVED });
    expect(result.current).toEqual({ status: "ready", income: data.net.before });
    expect(asked).toBe(0);
  });

  it.each([
    ["the examples' measures have no approved definitions", PRESET_APPROVED, null],
    ["the answer reports none", null, PRESET_APPROVED],
    // The measure left out of the selection still makes the answer's baseline
    [
      "it reports another baseline for a measure the selection leaves out",
      { ...PRESET_APPROVED, another_measure: { ...PRESET_APPROVED.another_measure, baseline: { ...PRESET_APPROVED.another_measure.baseline, reform_sha256: "e".repeat(64) } } },
      PRESET_APPROVED,
    ],
  ])("are not used when %s: the hook asks for its own", async (_case, reported, presetDefinitions) => {
    seedHouseholdImpactCache([[presetKey, { ...answer(), definitions: reported }]]);
    const { result } = render({ presetPolicies: PRESET, presetDefinitions });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(asked).toBe(1);
  });
});

it("finds nothing in the page's cache with no measures to check an answer against", () => {
  seedHouseholdImpactCache([[pageKey(PUBLICATION), answer()]]);
  expect(peekHouseholdImpact(pageKey(PUBLICATION), PUBLISHED_ENGINE, APPROVED, POLICIES)).not.toBeNull();
  for (const policies of [[], undefined, null]) {
    expect(peekHouseholdImpact(pageKey(PUBLICATION), PUBLISHED_ENGINE, APPROVED, policies)).toBeNull();
  }
  expect(peekHouseholdImpact(pageKey(PUBLICATION), PUBLISHED_ENGINE, undefined, POLICIES)).toBeNull();
});

describe("with the calculator-only savings rise, which every household request carries", () => {
  // It publishes no figures, so it has no approved definition
  // (utils/calculatorOnlyMeasures.js)
  const SAVINGS = "savings_income_rates_up";
  const WITH_SAVINGS = [...POLICIES, SAVINGS];
  const named = (url) => requestedDefinitions(url).sort();
  const publishedAt = (commit) => POLICIES.map((id) => [id, commit]).sort();

  it("asks with it, naming only the published measures' definitions, and places the household", async () => {
    const { result } = render({ policies: WITH_SAVINGS });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(urls).toHaveLength(1);
    expect(named(urls[0])).toEqual(publishedAt(APPROVED_COMMIT));
  });

  it("uses the examples' precomputed answers, asked with it, asking nothing", () => {
    const presetWithSavings = [...PRESET, SAVINGS];
    const key = `${PUBLICATION}:${requestKey(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: presetWithSavings }))}`;
    const data = { ...answer(), definitions: PRESET_APPROVED };
    seedHouseholdImpactCache([[key, data]]);
    const { result } = render({ policies: WITH_SAVINGS, presetPolicies: presetWithSavings, presetDefinitions: PRESET_APPROVED });
    expect(result.current).toEqual({ status: "ready", income: data.net.before });
    expect(asked).toBe(0);
  });

  it("still refuses an answer that reports another definition for a published measure", async () => {
    respond = (url, body) => {
      const reported = reportedDefinitions(url);
      return { ...householdAnswerFor(body), definitions: { ...reported, [POLICIES[0]]: { ...reported[POLICIES[0]], git_sha: "f".repeat(40) } } };
    };
    const { result } = render({ policies: WITH_SAVINGS });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.income).toBeNull();
  });

  it("checks it as any other once it has an approved definition", async () => {
    const withItsOwn = { ...APPROVED, [SAVINGS]: approvedDefinition(SAVINGS) };
    respond = (url, body) => {
      const reported = reportedDefinitions(url);
      return { ...householdAnswerFor(body), definitions: { ...reported, [SAVINGS]: { ...reported[SAVINGS], git_sha: "f".repeat(40) } } };
    };
    const { result } = render({ policies: WITH_SAVINGS, expectedDefinitions: withItsOwn });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(named(urls[0])).toEqual(WITH_SAVINGS.map((id) => [id, APPROVED_COMMIT]).sort());
  });
});
