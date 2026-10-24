import { LIFECYCLE_REFORMS } from "../utils/policyConfig";
import "./LifecycleCalculator.css";

// Lifetime chart items that raise revenue (the rest cost revenue), for the
// legend's two groups, as on the population charts
export const RAISER_KEYS = new Set([
  "impact_threshold_freeze",
  "impact_unearned_income_tax",
  "impact_salary_sacrifice_cap",
  "impact_sl_threshold_freeze",
]);

// What the lifetime model does for each policy (its own values, from
// uk_budget_data/lifecycle_calculator.py). Some differ from the policy
// notes on Population impact; they are left as the model has them.
const ABOUT_POLICIES = [
  { key: "impact_threshold_freeze", text: "income tax thresholds frozen until 2030-31." },
  { key: "impact_unearned_income_tax", text: "tax on that income up 5%." },
  { key: "impact_salary_sacrifice_cap", text: "£2,000 a year, from 2029." },
  { key: "impact_sl_threshold_freeze", text: "Plan 2 frozen at £27,295, 2027-28 to 2029-30." },
  { key: "impact_two_child_limit", text: "removed from 2026." },
  { key: "impact_fuel_duty_freeze", text: "the 5p cut kept longer, then phased rises." },
  { key: "impact_rail_fare_freeze", text: "regulated fares held for one year in 2026." },
];

// The model's assumptions, from run_lifecycle_model and LifecycleInputs in
// uk_budget_data/lifecycle_calculator.py
const ASSUMPTIONS = [
  "The projection starts in 2026 at the age and salary entered, and runs to the life expectancy entered.",
  "Earnings follow an age profile that starts at 22: they rise to 2.2 times their level at 22 by 50, then stay there. A salary entered before 22 is held flat until 22.",
  "On top of that profile, earnings grow by 1% a year.",
  "After the retirement age entered, income is the State Pension.",
  "CPI and RPI follow the OBR forecast, then 2% and 2.39%.",
];

const reform = (key) => LIFECYCLE_REFORMS.find((r) => r.key === key);

/**
 * The lifetime model behind the Personal impact view: what it estimates,
 * the policies as it models them, and its assumptions. Shown on the
 * Methodology view, under a level-3 heading, so its own headings are
 * level 4.
 */
function LifecycleAbout() {
  return (
    <div className="methodology-content lifecycle-about">
      <p className="method-lead">
        Estimates the lifetime change in take-home pay for one person from the
        selected policies, allowing for earnings growth, tax thresholds and
        student loan repayments. It is a separate, simpler model with its own
        policy values, not the PolicyEngine UK model behind the national
        figures.
      </p>

      <div className="about-columns">
        <div>
          <h4>Policies modelled</h4>
          {[
            ["Raise revenue", ABOUT_POLICIES.filter((item) => RAISER_KEYS.has(item.key))],
            ["Cost revenue", ABOUT_POLICIES.filter((item) => !RAISER_KEYS.has(item.key))],
          ].map(([heading, items]) => (
            <div key={heading} className="about-group">
              <p className="about-group-heading">{heading}</p>
              <ul className="about-policies">
                {items.map((item) => (
                  <li key={item.key}>
                    <span
                      className="about-swatch"
                      style={{ background: reform(item.key)?.color }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{reform(item.key)?.label}</strong>: {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div>
          <h4>Assumptions</h4>
          <ul className="about-bullets">
            {ASSUMPTIONS.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="about-note">
        Positive values mean higher net income under the policies; negative values
        mean lower.
      </p>
    </div>
  );
}

export default LifecycleAbout;
