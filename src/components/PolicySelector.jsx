import { useState, useRef, useEffect } from "react";
import "./PolicySelector.css";
import PillChevron from "./PillChevron";

function PolicySelector({ policies, selectedPolicies, onPolicyToggle, disabledReason }) {
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
        className="policy-selector-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={disabledReason ? `Select policies: ${disabledReason}` : "Select policies"}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
      >
        <span className="policy-selector-count">{selectedCount}</span>
        <span className="policy-selector-label">
          {selectedCount === 0
            ? "Select policies"
            : selectedCount === 1
              ? "policy selected"
              : "policies selected"}
        </span>
        <span className="policy-selector-label-short" aria-hidden="true">
          selected
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
