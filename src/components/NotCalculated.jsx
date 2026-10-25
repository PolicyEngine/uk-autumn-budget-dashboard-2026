/**
 * The line a drill shows in place of a chart it did not calculate. `cell`
 * puts it in a chart grid's second column, beside a chart it did calculate.
 */
export default function NotCalculated({ cell = false }) {
  return (
    <p className={`not-calculated ${cell ? "not-calculated-cell" : ""}`}>
      Not calculated in this drill.
    </p>
  );
}
