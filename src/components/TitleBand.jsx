import { useEffect, useRef, useState } from "react";
import PillSelect from "./PillSelect";
import PolicySelector from "./PolicySelector";

/**
 * The page's sticky title band: the title, the view pill and the policy
 * pill. It docks at the top once the reader scrolls past it; the sentinel
 * above it tells it when it is stuck. Each chart chooses its own year.
 */
function TitleBand({
  activeTab,
  onTabChange,
  policies,
  selectedPolicies,
  onPolicyToggle,
}) {
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setStuck(!entry.isIntersecting),
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="title-sentinel" aria-hidden="true" />
      <div className={`title-row ${stuck ? "is-stuck" : ""}`}>
        <h1>UK Autumn Budget 2026</h1>

        {/* The view (Population or Personal impact), switching the tab
            panel below */}
        <div className="band-view">
          <PillSelect
            name="View"
            label="impact"
            value={activeTab}
            onChange={onTabChange}
            options={[
              { value: "dashboard", label: "Population impact", badge: "Population" },
              { value: "personal", label: "Personal impact", badge: "Personal" },
            ]}
          />
        </div>
        {/* The policy pill applies to both views */}
        <div className="band-policy">
          <PolicySelector
            policies={policies}
            selectedPolicies={selectedPolicies}
            onPolicyToggle={onPolicyToggle}
          />
        </div>
      </div>
    </>
  );
}

export default TitleBand;
