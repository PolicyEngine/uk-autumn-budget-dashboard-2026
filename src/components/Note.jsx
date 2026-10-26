/** The ⓘ a note starts with. */
export function InfoIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/** A reading caveat: a short visible line with an ⓘ, under a chart or a section. */
function Note({ children }) {
  return (
    <p className="note">
      <InfoIcon />
      <span>{children}</span>
    </p>
  );
}

export default Note;
