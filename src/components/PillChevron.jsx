import "./PillChevron.css";

/**
 * The chevron on every pill dropdown: 14px, currentColor, stroke 2 with
 * round caps. It turns over when the pill's button is aria-expanded (see
 * PillChevron.css), so it never re-renders or shifts.
 */
function PillChevron() {
  return (
    <span className="policy-selector-icon pill-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default PillChevron;
