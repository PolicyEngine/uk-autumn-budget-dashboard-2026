import { useState } from "react";
import "./PersonalImpactForm.css";

const REGIONS = [
  ["NORTH_EAST", "North East"], ["NORTH_WEST", "North West"],
  ["YORKSHIRE", "Yorkshire and the Humber"], ["EAST_MIDLANDS", "East Midlands"],
  ["WEST_MIDLANDS", "West Midlands"], ["EAST_OF_ENGLAND", "East of England"],
  ["LONDON", "London"], ["SOUTH_EAST", "South East"],
  ["SOUTH_WEST", "South West"], ["WALES", "Wales"],
  ["SCOTLAND", "Scotland"], ["NORTHERN_IRELAND", "Northern Ireland"],
];

export default function MockPersonalImpactForm({ onSubmit, isLoading }) {
  const [input, setInput] = useState({
    employment_income: 50_000,
    self_employment_income: 0,
    partner_income: 0,
    is_married: false,
    income_growth_percent: 0,
    children_ages_text: "",
    region: "LONDON",
    fuel_litres: 0,
    domestic_energy_bill: 0,
    electricity_bill: 0,
    capital_gains: 0,
    home_value_2026: 0,
    rent: 0,
    tenure_type: "OWNED_OUTRIGHT",
    state_pension_income: 0,
    private_pension_income: 0,
    partner_state_pension_income: 0,
    partner_private_pension_income: 0,
    age_2025: 35,
    partner_age_2025: 33,
    claims_pension_credit: true,
  });

  const change = (event) => {
    const { name, value, type, checked } = event.target;
    setInput((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : type === "number" ? (value === "" ? "" : Number(value)) : value,
    }));
  };

  const moneyField = (name, label, help, step = 100) => (
    <div className="form-group">
      <label htmlFor={name}>{label}</label>
      <div className="input-with-prefix"><span className="prefix">£</span>
        <input id={name} name={name} type="number" min="0" step={step}
          value={input[name]} onChange={change} required />
      </div>
      {help && <span className="help-text">{help}</span>}
    </div>
  );

  const submit = (event) => {
    event.preventDefault();
    const children_ages = input.children_ages_text.trim()
      ? input.children_ages_text.split(",").map((age) => Number(age.trim()))
      : [];
    onSubmit({
      ...input,
      children_ages,
      income_growth_rate: input.income_growth_percent / 100,
      partner_income: input.is_married ? input.partner_income : 0,
    });
  };

  return <form className="personal-impact-form" onSubmit={submit}>
    <section className="form-section">
      <h3>Income and family</h3>
      <div className="form-group">
        <label htmlFor="age_2025">Your age in 2025</label>
        <input id="age_2025" name="age_2025" type="number" min="16" max="100" step="1"
          value={input.age_2025} onChange={change} required />
      </div>
      {moneyField("employment_income", "Your annual employee earnings (2025)")}
      {moneyField("self_employment_income", "Your annual self-employment profits (2025)")}
      {moneyField("state_pension_income", "Your annual State Pension", "Enter the annual amount expected in the model year.")}
      {moneyField("private_pension_income", "Your annual private pension")}
      {moneyField("capital_gains", "Your annual capital gains", "Gains realised in each year, before the annual exempt amount. The mock rate rise applies from 6 April 2027.", 1000)}
      <div className="form-group">
        <label htmlFor="income_growth_percent">Expected annual income growth</label>
        <div className="input-with-suffix">
          <input id="income_growth_percent" name="income_growth_percent" type="number"
            min="-50" max="50" step="0.5" value={input.income_growth_percent} onChange={change} required />
          <span className="suffix">%</span>
        </div>
      </div>
      <div className="form-group checkbox-group">
        <label><input name="is_married" type="checkbox" checked={input.is_married} onChange={change} /> Married or cohabiting</label>
      </div>
      {input.is_married && <>
        <div className="form-group">
          <label htmlFor="partner_age_2025">Partner’s age in 2025</label>
          <input id="partner_age_2025" name="partner_age_2025" type="number" min="16" max="100" step="1"
            value={input.partner_age_2025} onChange={change} required />
        </div>
        {moneyField("partner_income", "Partner's annual employee earnings (2025)")}
        {moneyField("partner_state_pension_income", "Partner’s annual State Pension")}
        {moneyField("partner_private_pension_income", "Partner’s annual private pension")}
      </>}
      <div className="form-group checkbox-group">
        <label><input name="claims_pension_credit" type="checkbox" checked={input.claims_pension_credit} onChange={change} /> Claims Pension Credit if entitled</label>
      </div>
      <div className="form-group">
        <label htmlFor="children_ages_text">Children’s ages in 2025</label>
        <input id="children_ages_text" name="children_ages_text" type="text" value={input.children_ages_text}
          onChange={change} placeholder="For example: 4, 7" pattern="\s*(\d{1,2}\s*,\s*)*\d{1,2}\s*|\s*" />
        <span className="help-text">Separate ages with commas. Child Benefit and its high-income charge are included.</span>
      </div>
    </section>
    <section className="form-section">
      <h3>Location and annual bills</h3>
      <div className="form-group">
        <label htmlFor="region">UK region</label>
        <select id="region" name="region" value={input.region} onChange={change}>
          {REGIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="tenure_type">Housing tenure</label>
        <select id="tenure_type" name="tenure_type" value={input.tenure_type} onChange={change}>
          <option value="OWNED_OUTRIGHT">Own outright</option>
          <option value="OWNED_WITH_MORTGAGE">Own with a mortgage</option>
          <option value="RENT_PRIVATELY">Rent privately</option>
          <option value="RENT_FROM_HA">Rent from a housing association</option>
          <option value="RENT_FROM_COUNCIL">Rent from a council</option>
        </select>
      </div>
      {moneyField("rent", "Annual eligible rent", "Used to calculate Universal Credit interactions where relevant.")}
      <div className="form-group">
        <label htmlFor="fuel_litres">Petrol or diesel litres per year</label>
        <input id="fuel_litres" name="fuel_litres" type="number" min="0" step="1"
          value={input.fuel_litres} onChange={change} required />
        <span className="help-text">Assumed to be used evenly through the year. Includes pump VAT pass-through.</span>
      </div>
      {moneyField("domestic_energy_bill", "Annual gas and electricity bill including 5% VAT")}
      {moneyField("electricity_bill", "Annual electricity bill including 5% VAT", "Electricity only. The mock zero rate continues in Great Britain from April 2027 to March 2028; gas stays at 5%.")}
      {moneyField("home_value_2026", "Home value in April 2026", "For owner-occupiers; ignored for tenants. The surcharge extension applies to English homes from £1.5m to below £2m.", 1000)}
    </section>
    <button type="submit" disabled={isLoading}>{isLoading ? "Calculating…" : "Calculate impact"}</button>
  </form>;
}
