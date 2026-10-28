import { describe, expect, it } from "vitest";
import {
  LOCAL_AUTHORITIES,
  exactLocalAuthority,
  foldText,
  localAuthorityRegion,
  searchLocalAuthorities,
} from "./localAuthorities";
import { REGION_OPTIONS, WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest, requestKey } from "./householdImpactApi";
import { presetRequests } from "./householdPresets";

describe("the local authority table", () => {
  it("holds the UK's 361 local authorities, each once, in a region the form offers", () => {
    expect(LOCAL_AUTHORITIES).toHaveLength(361);
    expect(new Set(LOCAL_AUTHORITIES.map((council) => council.name)).size).toBe(361);
    expect(new Set(LOCAL_AUTHORITIES.map((council) => council.key)).size).toBe(361);
    const regions = new Set(REGION_OPTIONS.map(([value]) => value));
    for (const council of LOCAL_AUTHORITIES) expect(regions.has(council.region)).toBe(true);
    // Every region the form offers has its councils
    for (const region of regions) expect(LOCAL_AUTHORITIES.some((council) => council.region === region)).toBe(true);
  });

  it("has as many local authorities in each region as ONS's LAD 2024 lookups give", () => {
    const counts = {};
    for (const { region } of LOCAL_AUTHORITIES) counts[region] = (counts[region] ?? 0) + 1;
    expect(counts).toEqual({
      NORTH_EAST: 12,
      NORTH_WEST: 35,
      YORKSHIRE: 15,
      EAST_MIDLANDS: 35,
      WEST_MIDLANDS: 30,
      EAST_OF_ENGLAND: 45,
      LONDON: 33,
      SOUTH_EAST: 64,
      SOUTH_WEST: 27,
      WALES: 22,
      SCOTLAND: 32,
      NORTHERN_IRELAND: 11,
    });
  });

  it("gives a local authority's region", () => {
    expect(localAuthorityRegion("Rushmoor")).toBe("SOUTH_EAST");
    expect(localAuthorityRegion("Manchester")).toBe("NORTH_WEST");
    expect(localAuthorityRegion("Camden")).toBe("LONDON");
    expect(localAuthorityRegion("Cardiff")).toBe("WALES");
    expect(localAuthorityRegion("Glasgow City")).toBe("SCOTLAND");
    expect(localAuthorityRegion("Belfast")).toBe("NORTHERN_IRELAND");
    expect(localAuthorityRegion("Nowhere")).toBeNull();
  });
});

describe("searching local authorities", () => {
  it("ignores case, accents and punctuation", () => {
    expect(foldText("  St.  Helens ")).toBe("st helens");
    expect(foldText("Ynys Môn")).toBe("ynys mon");
    expect(exactLocalAuthority("st helens")?.name).toBe("St. Helens");
    expect(exactLocalAuthority("kings lynn and west norfolk")?.name).toBe("King's Lynn and West Norfolk");
    expect(exactLocalAuthority("st")).toBeNull();
  });

  it("puts names that start with the query first, then those with a word that does", () => {
    const bristol = searchLocalAuthorities("bristol").map((council) => council.name);
    expect(bristol[0]).toBe("Bristol, City of");
    const hull = searchLocalAuthorities("hull").map((council) => council.name);
    // Hull is a word in "Kingston upon Hull, City of", ahead of Solihull
    expect(hull.indexOf("Kingston upon Hull, City of")).toBeLessThan(hull.indexOf("Solihull"));
  });

  it("lists every local authority for an empty query, and none for a name not there", () => {
    expect(searchLocalAuthorities("")).toHaveLength(361);
    expect(searchLocalAuthorities("zzz")).toEqual([]);
  });
});

describe("the request the form sends", () => {
  it("carries the region only: the council picked changes nothing else", () => {
    const options = { year: 2027, policies: ["a", "b"] };
    const plain = buildHouseholdRequest(WIZARD_DEFAULTS, options);
    const picked = buildHouseholdRequest({ ...WIZARD_DEFAULTS, council: "Manchester", region: "NORTH_WEST" }, options);
    expect(requestKey(picked)).toBe(requestKey(plain));
    expect(JSON.stringify(picked)).not.toMatch(/council"|Manchester|local_authority/);
  });

  it.each([
    ["Glasgow City", "SCOTLAND"],
    ["Cardiff", "WALES"],
    ["Belfast", "NORTHERN_IRELAND"],
    ["Manchester", "NORTH_WEST"],
    ["Cornwall", "SOUTH_WEST"],
    ["Westminster", "LONDON"],
    ["Isle of Wight", "SOUTH_EAST"],
  ])("sends %s's region, %s, as the household's region", (name, region) => {
    const council = exactLocalAuthority(name);
    expect(council?.name).toBe(name);
    // As the form's picker does on choosing a council
    const inputs = { ...WIZARD_DEFAULTS, council: council.name, region: council.region };
    const request = buildHouseholdRequest(inputs, { year: 2027, policies: ["a"] });
    expect(request.household.region).toBe(region);
  });

  it("leaves the examples' precomputed requests as they were", () => {
    // On #104 the measures come from the publication; any list will do
    for (const { request } of presetRequests(["alpha", "beta"])) {
      expect(JSON.stringify(request)).not.toMatch(/"council"|local_authority/);
    }
  });
});
