import {
  loadPublishedFile,
  useCachedResource,
  useGeographyData,
} from "./useGeographyData";
import { POVERTY_FILE, parsePovertyTable } from "../utils/demographics/poverty";

/**
 * Results by demographic group (demographics.csv), fetched once and shared.
 * The file is in the format of the results by area, one level per way of
 * grouping people, and is checked by the same reader (see
 * utils/geography/parse). The state is useGeographyData's.
 */
export const useDemographicsData = () => useGeographyData("demographics");

/** Fetch and check poverty_by_age.csv; never rejects. */
export const loadPovertyByAge = (options) =>
  loadPublishedFile(POVERTY_FILE, parsePovertyTable, options);

const loadDefault = () => loadPovertyByAge();

/**
 * Poverty rates by age group (poverty_by_age.csv), fetched once and shared:
 * `{status, table, error}` as useGeographyData's, with `table` from
 * utils/demographics/poverty.
 */
export const usePovertyByAge = () =>
  useCachedResource("poverty_by_age", loadDefault);

export default useDemographicsData;
