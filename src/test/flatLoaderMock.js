/**
 * TEST ONLY: flat view files served straight from fetch, without the release
 * index, for tests of what a view does with its rows. Binding and byte
 * verification are tested in src/utils/publication/flat.test.js.
 */
export function unverifiedFlatLoader() {
  const loadVerifiedFlat = async (name, _catalogue, { fetchImpl = fetch, basePath = "" } = {}) => {
    const response = await fetchImpl(`${basePath}/data/${name}`);
    if (!response.ok) throw new Error(`${name} is unavailable`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
    return { text, aliases: {} };
  };
  return {
    loadVerifiedFlat,
    loadVerifiedFlatCsv: async (...args) => (await loadVerifiedFlat(...args)).text,
  };
}
