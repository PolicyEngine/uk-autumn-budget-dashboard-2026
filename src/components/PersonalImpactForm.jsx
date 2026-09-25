import { useState } from "react";
import "./PersonalImpactForm.css";

function PersonalImpactForm({ onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    employment_income: 50000,
    income_growth_rate: 2,
    is_married: false,
    partner_income: 0,
    children_ages: [],
    property_income: 0,
    savings_income: 0,
    dividend_income: 0,
    pension_contributions_salary_sacrifice: 0,
    fuel_spending: 1200,
    bus_spending: 800,
    capital_gains: 0,
    region: "LONDON",
    fuel_type: "PETROL",
  });

  const [childAgeInput, setChildAgeInput] = useState("");

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleNumberChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value === "" ? "" : parseFloat(value),
    }));
  };

  const addChild = () => {
    const age = parseInt(childAgeInput);
    if (!isNaN(age) && age >= 0 && age <= 25) {
      setFormData((prev) => ({
        ...prev,
        children_ages: [...prev.children_ages, age].sort((a, b) => a - b),
      }));
      setChildAgeInput("");
    }
  };

  const removeChild = (index) => {
    setFormData((prev) => ({
      ...prev,
      children_ages: prev.children_ages.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Convert percentage to decimal
    const submitData = {
      ...formData,
      income_growth_rate: formData.income_growth_rate / 100,
    };
    onSubmit(submitData);
  };

  return (
    <form className="personal-impact-form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h3>Capital gains</h3>
        <div className="form-group">
          <label htmlFor="capital_gains">Annual gains before tax and behavioural response</label>
          <div className="input-with-prefix"><span className="prefix">£</span>
            <input type="number" id="capital_gains" name="capital_gains" min="0" step="1000" value={formData.capital_gains} onChange={handleNumberChange} />
          </div>
        </div>
      </div>
      <div className="form-section">
        <h3>Employment income</h3>
        <div className="form-group">
          <label htmlFor="employment_income">
            Your annual employment income (2025)
          </label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="employment_income"
              name="employment_income"
              value={formData.employment_income}
              onChange={handleNumberChange}
              min="0"
              step="1000"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="income_growth_rate">
            Expected annual income growth
          </label>
          <div className="input-with-suffix">
            <input
              type="number"
              id="income_growth_rate"
              name="income_growth_rate"
              value={formData.income_growth_rate}
              onChange={handleNumberChange}
              min="-50"
              max="50"
              step="0.5"
            />
            <span className="suffix">%</span>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="pension_contributions_salary_sacrifice">
            Salary sacrifice pension contributions (annual)
          </label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="pension_contributions_salary_sacrifice"
              name="pension_contributions_salary_sacrifice"
              value={formData.pension_contributions_salary_sacrifice}
              onChange={handleNumberChange}
              min="0"
              step="500"
            />
          </div>
          <span className="help-text">
            Pre-tax pension contributions via salary sacrifice
          </span>
        </div>
      </div>

      <div className="form-section">
        <h3>Household composition</h3>
        <div className="form-group">
          <label htmlFor="region">UK region</label>
          <select id="region" name="region" value={formData.region} onChange={handleChange}>
            <option value="NORTH_EAST">North East</option>
            <option value="NORTH_WEST">North West</option>
            <option value="YORKSHIRE">Yorkshire and the Humber</option>
            <option value="EAST_MIDLANDS">East Midlands</option>
            <option value="WEST_MIDLANDS">West Midlands</option>
            <option value="EAST_OF_ENGLAND">East of England</option>
            <option value="LONDON">London</option>
            <option value="SOUTH_EAST">South East</option>
            <option value="SOUTH_WEST">South West</option>
            <option value="WALES">Wales</option>
            <option value="SCOTLAND">Scotland</option>
            <option value="NORTHERN_IRELAND">Northern Ireland</option>
          </select>
          <span className="help-text">The £2 bus fare scenario applies from 2027 to English regions outside London. Region is a proxy for eligible services.</span>
        </div>
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              name="is_married"
              checked={formData.is_married}
              onChange={handleChange}
            />
            Married or cohabiting
          </label>
        </div>

        {formData.is_married && (
          <div className="form-group">
            <label htmlFor="partner_income">
              Partner&apos;s annual employment income
            </label>
            <div className="input-with-prefix">
              <span className="prefix">£</span>
              <input
                type="number"
                id="partner_income"
                name="partner_income"
                value={formData.partner_income}
                onChange={handleNumberChange}
                min="0"
                step="1000"
              />
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Children (ages in 2025)</label>
          <div className="children-input">
            <input
              type="number"
              value={childAgeInput}
              onChange={(e) => setChildAgeInput(e.target.value)}
              placeholder="Age"
              min="0"
              max="25"
            />
            <button type="button" onClick={addChild} className="add-child-btn">
              Add child
            </button>
          </div>
          {formData.children_ages.length > 0 && (
            <div className="children-list">
              {formData.children_ages.map((age, index) => (
                <span key={index} className="child-tag">
                  {age} years
                  <button
                    type="button"
                    onClick={() => removeChild(index)}
                    className="remove-child-btn"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <span className="help-text">
            Children will be automatically aged each year
          </span>
        </div>
      </div>

      <div className="form-section">
        <h3>Other income</h3>
        <div className="form-group">
          <label htmlFor="property_income">Annual property income</label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="property_income"
              name="property_income"
              value={formData.property_income}
              onChange={handleNumberChange}
              min="0"
              step="500"
            />
          </div>
          <span className="help-text">Rental income from property</span>
        </div>

        <div className="form-group">
          <label htmlFor="savings_income">Annual savings income</label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="savings_income"
              name="savings_income"
              value={formData.savings_income}
              onChange={handleNumberChange}
              min="0"
              step="100"
            />
          </div>
          <span className="help-text">Interest from savings accounts</span>
        </div>

        <div className="form-group">
          <label htmlFor="dividend_income">Annual dividend income</label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="dividend_income"
              name="dividend_income"
              value={formData.dividend_income}
              onChange={handleNumberChange}
              min="0"
              step="100"
            />
          </div>
          <span className="help-text">Dividends from shares/investments</span>
        </div>
      </div>

      <div className="form-section">
        <h3>Transport spending</h3>
        <div className="form-group">
          <label htmlFor="fuel_spending">Annual fuel spending</label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="fuel_spending"
              name="fuel_spending"
              value={formData.fuel_spending}
              onChange={handleNumberChange}
              min="0"
              step="100"
            />
          </div>
          <span className="help-text">Petrol or diesel for personal vehicles, as selected below</span>
        </div>
        <div className="form-group">
          <label htmlFor="fuel_type">Fuel type</label>
          <select id="fuel_type" name="fuel_type" value={formData.fuel_type} onChange={handleChange}>
            <option value="PETROL">Petrol</option>
            <option value="DIESEL">Diesel</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="bus_spending">Annual bus spending</label>
          <div className="input-with-prefix">
            <span className="prefix">£</span>
            <input
              type="number"
              id="bus_spending"
              name="bus_spending"
              value={formData.bus_spending}
              onChange={handleNumberChange}
              min="0"
              step="100"
            />
          </div>
          <span className="help-text">Bus and coach fares before the cap reduction; the model cannot identify participating journeys</span>
        </div>
      </div>

      <button type="submit" className="submit-btn" disabled={isLoading}>
        {isLoading ? "Calculating..." : "Calculate my impact"}
      </button>
    </form>
  );
}

export default PersonalImpactForm;
