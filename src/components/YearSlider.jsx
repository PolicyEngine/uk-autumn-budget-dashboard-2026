import { useEffect, useId, useRef, useState } from "react";
import "./YearSlider.css";
import { CalendarDays } from "lucide-react";
import PillChevron from "./PillChevron";
import { SELECTABLE_YEARS } from "../utils/displayYears";

// The years a reader can choose (from 2027-28; see utils/displayYears.js)
const YEARS = SELECTABLE_YEARS;

// Play shows each year for 2.25s: long enough for the charts' 850ms
// tween (utils/chartMotion.js) to settle and the year to be read
export const PLAY_STEP_MS = 2250;

function YearSlider({ selectedYear, onYearChange }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        onYearChange((prevYear) => {
          const currentIndex = YEARS.indexOf(prevYear);
          if (currentIndex >= YEARS.length - 1) {
            // Stop playing when reaching the end
            setIsPlaying(false);
            return prevYear;
          }
          return YEARS[currentIndex + 1];
        });
      }, PLAY_STEP_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, onYearChange]);

  const currentIndex = YEARS.indexOf(selectedYear);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(currentIndex);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const label = (year) => `${year}-${(year + 1).toString().slice(-2)}`;

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // Close on a click outside.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Focus the list when it opens, on the selected year.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const startPlaying = () => {
    // From the last year, play restarts at the first
    if (currentIndex >= YEARS.length - 1) onYearChange(YEARS[0]);
    setIsPlaying(true);
    close(true);
  };

  const choose = (index) => {
    onYearChange(YEARS[index]);
    setIsPlaying(false);
    close(true);
  };

  const handleToggle = () => {
    if (isPlaying) {
      // While playing, the button is the pause control
      setIsPlaying(false);
      return;
    }
    setActiveIndex(currentIndex);
    setOpen((value) => !value);
  };

  const handleListKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(YEARS.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(YEARS.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const optionId = (index) => `${listId}-year-${index}`;

  return (
    <div className="year-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="policy-selector-toggle band-control year-picker-toggle"
        aria-haspopup={isPlaying ? undefined : "listbox"}
        aria-expanded={isPlaying ? undefined : open}
        aria-controls={open ? listId : undefined}
        aria-pressed={isPlaying ? true : undefined}
        aria-label={
          isPlaying
            ? `Playing, ${label(selectedYear)}: pause`
            : `Year, ${label(selectedYear)}`
        }
        onClick={handleToggle}
      >
        {/* The band control's parts, as on the measures control: icon,
            a small label over the value, chevron */}
        <CalendarDays className="band-control-icon" size={16} strokeWidth={2} aria-hidden="true" />
        <span className="band-control-text">
          <span className="band-control-label">{isPlaying ? "Playing" : "Year"}</span>
          <span className="band-control-value year-picker-value">{label(selectedYear)}</span>
        </span>
        {isPlaying ? (
          <span className="policy-selector-icon pill-chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
              <path
                d="M5.5 4v8M10.5 4v8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : (
          <PillChevron />
        )}
      </button>

      {open && (
        <div className="year-picker-dropdown">
          <button type="button" className="year-picker-play" onClick={startPlaying}>
            ▶ Play through years
          </button>
          <ul
            ref={listRef}
            id={listId}
            className="year-picker-list"
            role="listbox"
            aria-label="Year"
            tabIndex={-1}
            aria-activedescendant={optionId(activeIndex)}
            onKeyDown={handleListKeyDown}
          >
            {YEARS.map((year, index) => (
              <li
                key={year}
                id={optionId(index)}
                role="option"
                aria-selected={index === currentIndex}
                className={`year-picker-option ${index === activeIndex ? "is-active" : ""}`}
                onClick={() => choose(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="year-picker-check" aria-hidden="true">
                  {index === currentIndex ? "✓" : ""}
                </span>
                {label(year)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default YearSlider;
