/** Public explanations and supported years come from the approved catalogue. */
export function measureModelling(catalogue) {
  return catalogue.displayable.map((measure) => ({
    ...measure,
    how: measure.description,
    from: (measure.years ?? []).filter((year) => !(measure.unsupported_years ?? []).includes(year)).sort((a, b) => a - b)[0] ?? null,
  }));
}
