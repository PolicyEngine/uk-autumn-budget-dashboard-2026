import { useEffect, useState } from "react";
import { X } from "lucide-react";
import "./publication.css";

export const UPDATE_TOAST_TEXT = "Updated with the latest published results";
const VISIBLE_MS = 4000;

// Once per page session: a later update (a correction, or local data files
// swapped on a preview) changes the figures without a second toast
let shownThisSession = false;

/** Forget that the toast has shown (tests). */
export function resetUpdateToast() {
  shownThisSession = false;
}

/**
 * A small note in the bottom corner when the page has replaced its figures
 * with newer published ones: it fades out after a few seconds, or on
 * dismissal, and is announced politely. It shows at most once per session.
 */
export default function UpdateToast({ show }) {
  // The page remounts its views with each newer snapshot, so the toast
  // decides once, when it mounts
  const [visible, setVisible] = useState(() => Boolean(show) && !shownThisSession);
  useEffect(() => {
    if (!visible) return undefined;
    shownThisSession = true;
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  return (
    <div className="update-toast-region" aria-live="polite">
      {visible && (
        <div className="update-toast" role="status">
          <span>{UPDATE_TOAST_TEXT}</span>
          <button type="button" className="update-toast-close" aria-label="Dismiss" onClick={() => setVisible(false)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
