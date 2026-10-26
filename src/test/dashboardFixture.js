import { BASE_PATH, fixtureFetch } from "./publicationFixture";

/** Real receipt-verified publication fixture, served at the app's root. */
export function dashboardFixtureFetch(options) {
  const serve = fixtureFetch(options);
  return (url, init) => {
    const path = String(url).slice(String(url).indexOf("/data/"));
    return serve(`${BASE_PATH}${path}`, init);
  };
}
