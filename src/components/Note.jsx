import { Info } from "lucide-react";

/** A reading caveat: a short visible line with the info icon (lucide's Info, as InfoTip), under a chart or a section. */
function Note({ children }) {
  return (
    <p className="note">
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default Note;
