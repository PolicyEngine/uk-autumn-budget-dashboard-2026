/**
 * A title whose fiscal years ("2029-30") never break across lines: each
 * year is wrapped in a no-wrap span, so the line breaks before it instead.
 */
const YEAR = /(\d{4}-\d{2})/;

function NoBreakYear({ text }) {
  return String(text)
    .split(YEAR)
    .map((part, index) =>
      YEAR.test(part) ? (
        <span key={index} className="nowrap">
          {part}
        </span>
      ) : (
        part
      ),
    );
}

export default NoBreakYear;
