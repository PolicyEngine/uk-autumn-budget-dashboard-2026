import { useEffect, useId, useRef, useState } from "react";
import "./ChartDownloadMenu.css";

const FORMAT_LABELS = {
  csv: { name: "CSV", detail: "Data" },
  png: { name: "PNG", detail: "Image" },
  svg: { name: "SVG", detail: "Vector image" },
  txt: { name: "TXT", detail: "Plain text" },
};

const ORDER = ["csv", "png", "svg", "txt"];

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/**
 * One download menu per chart: a disclosure button that shows a short list
 * of format buttons. `formats` maps a format (csv, png, svg, txt) to the
 * function that downloads it; formats without a function are left out.
 * Escape or a click outside closes the list; Escape returns focus to the
 * button.
 */
function ChartDownloadMenu({
  formats,
  label = "Download",
  ariaLabel,
  disabledReason,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();
  const available = ORDER.filter((format) => typeof formats?.[format] === "function");

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Shown but disabled until there is something to download, so the card's
  // layout is final before its results are published.
  if (disabledReason) {
    return (
      <div className="chart-download">
        <button
          type="button"
          className="chart-download-button"
          disabled
          title={disabledReason}
          aria-label={ariaLabel ? `${ariaLabel}: ${disabledReason}` : undefined}
        >
          <DownloadIcon />
          {label}
        </button>
      </div>
    );
  }

  if (available.length === 0) return null;

  const run = async (format) => {
    setBusy(format);
    try {
      await formats[format]();
    } catch (error) {
      console.error(`Download as ${format} failed`, error);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div className="chart-download" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="chart-download-button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <DownloadIcon />
        {label}
      </button>
      {open && (
        <ul className="chart-download-menu" id={menuId}>
          {available.map((format) => (
            <li key={format}>
              <button
                type="button"
                className="chart-download-item"
                data-format={format}
                disabled={busy !== null}
                onClick={() => run(format)}
              >
                <span className="chart-download-format">{FORMAT_LABELS[format].name}</span>{" "}
                <span className="chart-download-detail">
                  {busy === format ? "Preparing…" : FORMAT_LABELS[format].detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ChartDownloadMenu;
