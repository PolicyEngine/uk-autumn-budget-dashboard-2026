import budgetYears from "../uk_budget_data/budget_years.json";
import { useState, useRef, useEffect } from "react";
import "./YearSelector.css";

function YearSelector({ selectedYear, onYearChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const years = budgetYears.policy_years;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="year-selector" ref={dropdownRef}>
      <button
        className="year-selector-button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="year-label">Year: {selectedYear}</span>
        <svg
          className={`dropdown-arrow ${isOpen ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2 4 6 8 10 4"></polyline>
        </svg>
      </button>

      {isOpen && (
        <div className="year-dropdown">
          {years.map((year) => (
            <button
              key={year}
              className={`year-option ${selectedYear === year ? "selected" : ""}`}
              onClick={() => {
                onYearChange(year);
                setIsOpen(false);
              }}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default YearSelector;
