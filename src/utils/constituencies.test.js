import { describe, expect, it } from "vitest";
import {
  CONSTITUENCIES,
  constituencyRegion,
  exactConstituency,
  foldText,
  searchConstituencies,
} from "./constituencies";
import { REGION_OPTIONS, WIZARD_DEFAULTS } from "../components/HouseholdCalculator";
import { buildHouseholdRequest, requestKey } from "./householdImpactApi";
import { presetRequests } from "./householdPresets";

describe("the constituency table", () => {
  it("holds the 650 constituencies of 2024, each once, in a region the API takes", () => {
    expect(CONSTITUENCIES).toHaveLength(650);
    expect(new Set(CONSTITUENCIES.map((seat) => seat.name)).size).toBe(650);
    const regions = new Set(REGION_OPTIONS.map(([value]) => value));
    for (const seat of CONSTITUENCIES) expect(regions.has(seat.region)).toBe(true);
  });

  it("has as many seats in each region as ONS's lookups give", () => {
    const counts = {};
    for (const { region } of CONSTITUENCIES) counts[region] = (counts[region] ?? 0) + 1;
    expect(counts).toEqual({
      NORTH_EAST: 27,
      NORTH_WEST: 73,
      YORKSHIRE: 54,
      EAST_MIDLANDS: 47,
      WEST_MIDLANDS: 57,
      EAST_OF_ENGLAND: 61,
      LONDON: 75,
      SOUTH_EAST: 91,
      SOUTH_WEST: 58,
      WALES: 32,
      SCOTLAND: 57,
      NORTHERN_IRELAND: 18,
    });
  });

  it("gives a constituency's region", () => {
    expect(constituencyRegion("Aldershot")).toBe("SOUTH_EAST");
    expect(constituencyRegion("Manchester Central")).toBe("NORTH_WEST");
    expect(constituencyRegion("Holborn and St Pancras")).toBe("LONDON");
    expect(constituencyRegion("Montgomeryshire and Glyndŵr")).toBe("WALES");
    expect(constituencyRegion("Glasgow East")).toBe("SCOTLAND");
    expect(constituencyRegion("Belfast West")).toBe("NORTHERN_IRELAND");
    expect(constituencyRegion("Nowhere")).toBeNull();
  });
});

describe("searching constituencies", () => {
  it("ignores case and accents", () => {
    expect(foldText("  Ynys  Môn ")).toBe("ynys mon");
    expect(searchConstituencies("glyndwr").map((seat) => seat.name)).toEqual(["Montgomeryshire and Glyndŵr"]);
    expect(exactConstituency("ynys mon")?.name).toBe("Ynys Môn");
    expect(exactConstituency("ynys")).toBeNull();
  });

  it("puts names that start with the query first, then those with a word that does", () => {
    const names = searchConstituencies("bath").map((seat) => seat.name);
    // Bath and Bathgate and Linlithgow start with it; none has it inside
    expect(names.slice(0, 2)).toEqual(["Bath", "Bathgate and Linlithgow"]);
    const west = searchConstituencies("west").map((seat) => seat.name);
    // Westmorland and Lonsdale starts with it, before Belfast West
    expect(west.indexOf("Westmorland and Lonsdale")).toBeLessThan(west.indexOf("Belfast West"));
    const leeds = searchConstituencies("leeds").map((seat) => seat.name);
    expect(leeds.every((name) => name.startsWith("Leeds"))).toBe(true);
    const central = searchConstituencies("central").map((seat) => seat.name);
    expect(central).toContain("Manchester Central");
  });

  it("lists every constituency for an empty query, and none for a name not there", () => {
    expect(searchConstituencies("")).toHaveLength(650);
    expect(searchConstituencies("zzz")).toEqual([]);
  });
});

describe("the request the form sends", () => {
  it("carries the region only: the constituency picked changes nothing else", () => {
    const options = { year: 2027, policies: ["a", "b"] };
    const plain = buildHouseholdRequest(WIZARD_DEFAULTS, options);
    const picked = buildHouseholdRequest({ ...WIZARD_DEFAULTS, constituency: "Manchester Central", region: "NORTH_WEST" }, options);
    expect(requestKey(picked)).toBe(requestKey(plain));
    expect(JSON.stringify(picked)).not.toMatch(/constituency|Manchester/);
  });

  it("leaves the examples' precomputed requests as they were", () => {
    // On #104 the measures come from the publication; any list will do
    for (const { request } of presetRequests(["alpha", "beta"])) {
      expect(JSON.stringify(request)).not.toMatch(/constituency/);
    }
  });
});
