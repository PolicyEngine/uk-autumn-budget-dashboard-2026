/**
 * The plot area of a chart for a year the config lists but the published
 * files do not cover yet: the same height as the chart, a note, no bars or
 * lines, so the year is never read as zero.
 */
function UnpublishedPlot({ height, yearLabel }) {
  return (
    <div className="unpublished-plot" style={{ height }} role="status">
      <p>We have not yet published results for {yearLabel}.</p>
    </div>
  );
}

export default UnpublishedPlot;
