import { useState, useRef, useEffect } from "react";
import "./PolicySelector.css";
import { ListChecks } from "lucide-react";
import PillChevron from "./PillChevron";
import { useMeasureCatalogue } from "../utils/measureCatalogue";

function PolicySelector({ policies: providedPolicies, selectedPolicies, onPolicyToggle, disabledReason }) {
  const { displayable } = useMeasureCatalogue();
  const policies = (providedPolicies ?? displayable).filter(
    (policy) => policy.displayable !== false,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  const selectedCount = selectedPolicies.length;

  return (
    <div className="policy-selector" ref={dropdownRef}>
      <button
        className="policy-selector-toggle band-control"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={disabledReason ? `Select policies: ${disabledReason}` : "Select policies"}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
      >
        <ListChecks className="band-control-icon" size={16} strokeWidth={2} aria-hidden="true" />
        <span className="band-control-text">
          <span className="band-control-label">Measures</span>
          {/* "All 9 measures" or "9 of 15 measures"; on a phone "All 9" or
              "9 of 15" (the unit is hidden) */}
          <span className="band-control-value">
            {selectedCount === policies.length && selectedCount > 0 ? "All " : ""}
            <span className="policy-selector-count">{selectedCount}</span>
            {selectedCount === policies.length && selectedCount > 0 ? "" : ` of ${policies.length}`}
            <span className="band-control-unit"> {policies.length === 1 ? "measure" : "measures"}</span>
          </span>
        </span>
        <PillChevron />
      </button>

      {isExpanded && (
        <div className="policy-selector-dropdown">
          <div className="policy-list">
            {policies.map((policy) => (
              <label key={policy.id} className="policy-item">
                <input
                  type="checkbox"
                  checked={selectedPolicies.includes(policy.id)}
                  onChange={() => onPolicyToggle(policy.id)}
                />
                <div className="policy-info">
                  <span className="policy-name">{policy.name}</span>
                  <span className="policy-description">
                    {policy.description}
                  </span>
                </div>
              </label>
            ))}
          </div>
          {/* Select all, clear and close: on a phone the list fills the
              screen, so it needs its own way out */}
          <div className="policy-selector-actions">
            <button
              type="button"
              className="policy-selector-action"
              disabled={selectedCount === policies.length}
              onClick={() =>
                policies.filter((p) => !selectedPolicies.includes(p.id)).forEach((p) => onPolicyToggle(p.id))
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="policy-selector-action"
              disabled={selectedCount === 0}
              onClick={() =>
                policies.filter((p) => selectedPolicies.includes(p.id)).forEach((p) => onPolicyToggle(p.id))
              }
            >
              Clear
            </button>
            <button type="button" className="policy-selector-done" onClick={() => setIsExpanded(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PolicySelector;
