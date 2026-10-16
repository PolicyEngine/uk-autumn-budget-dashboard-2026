import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../publication/csv";
import {
  REGIONS,
  isRegionCode,
  regionByCode,
  regionForBoundary,
} from "./regions";

const REGIONS_CSV = path.resolve(__dirname, "../../../data_inputs/regions.csv");

describe("regions", () => {
  it("mirror data_inputs/regions.csv", () => {
    const [header, ...rows] = parseCsv(readFileSync(REGIONS_CSV, "utf-8"));
    const column = (name) => header.indexOf(name);
    const fromCsv = rows.map((cells) => ({
      code: cells[column("code")],
      name: cells[column("name")],
      geojsonRegion: cells[column("geojson_region")],
      geojsonCountry: cells[column("geojson_country")],
    }));
    expect(fromCsv).toHaveLength(12);
    expect(REGIONS).toEqual(fromCsv);
  });

  it("look up by code", () => {
    expect(isRegionCode("E12000007")).toBe(true);
    expect(isRegionCode("Z14000001")).toBe(false);
    expect(regionByCode("W92000004").name).toBe("Wales");
    expect(regionByCode("X")).toBeNull();
  });

  it("place a constituency from its boundary properties", () => {
    expect(
      regionForBoundary({ CTR_REG: "Greater London", Country: "England" }).code,
    ).toBe("E12000007");
    expect(
      regionForBoundary({
        CTR_REG: "Yorkshire and the Humber",
        Country: "England",
      }).code,
    ).toBe("E12000003");
    expect(regionForBoundary({ CTR_REG: "", Country: "Scotland" }).code).toBe(
      "S92000003",
    );
    expect(
      regionForBoundary({ CTR_REG: "", Country: "Northern Ireland" }).code,
    ).toBe("N92000002");
    expect(regionForBoundary({ CTR_REG: "", Country: "England" })).toBeNull();
    expect(regionForBoundary({ CTR_REG: "Atlantis", Country: "England" })).toBeNull();
    expect(regionForBoundary(undefined)).toBeNull();
  });
});
