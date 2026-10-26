import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import useBasisIncome, { clearBasisIncomeCache } from "./useBasisIncome";
import { clearHouseholdImpactCache, peekHouseholdImpact, seedHouseholdImpactCache } from "./useHouseholdImpact";
import { buildHouseholdRequest, normaliseHouseholdImpact, requestKey } from "../utils/householdImpactApi";
import { WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { HOUSEHOLD_FIXTURE, householdAnswerFor } from "../test/householdFixture";

const API = "https://api.test/api/household-impact";
const PUBLICATION = "snapshot-a";
const BASIS_YEAR = 2027;
const POLICIES = HOUSEHOLD_FIXTURE.included;
const { policyengine, "policyengine-uk": uk, "policyengine-core": core } = HOUSEHOLD_FIXTURE.engine;
const PUBLISHED_ENGINE = { policyengine, "policyengine-uk": uk, "policyengine-core": core };

// useHouseholdImpact's key for the basis-year request: snapshot, then request
const pageKey = (publication) =>
  `${publication}:${requestKey(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: POLICIES }))}`;
const answer = () =>
  normaliseHouseholdImpact(householdAnswerFor(buildHouseholdRequest(WIZARD_DEFAULTS, { year: BASIS_YEAR, policies: POLICIES })));

let asked;
beforeEach(() => {
  clearHouseholdImpactCache();
  clearBasisIncomeCache();
  asked = 0;
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", API);
  vi.stubGlobal("fetch", async (url, init) => {
    asked += 1;
    return Response.json(householdAnswerFor(JSON.parse(init.body)));
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
  expect(peekHouseholdImpact(pageKey(PUBLICATION))).toBeNull();
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
