# 2026 candidate policy results

National CSVs were regenerated locally on 25 September 2026 using the installed
policyengine.py 6.0.0 bundle (policyengine-uk 2.90.2) and `data/enhanced_frs_2024_25.h5`, with the three reforms
returned by `get_autumn_budget_2026_reforms()`, for 2026–2030.

The income curves use the illustrative household described in the dashboard:
two adults, three children, £10,000 pension contributions, £10,000 capital gains
before responses, £1,200 petrol spending and £800 bus spending per year.

`household_scatter.csv` is generated from `household_scatter_full.csv` with
`scripts/sample_household_scatter.py`, selecting the same 500 households for
all three reforms and five years.

Constituency CSVs have NOT been regenerated: the required
`parliamentary_constituency_weights.h5` is not available locally. They contain
legacy policies and are not displayed for the three candidate policies.

These are individual-policy estimates. The dashboard adds their effects when
multiple policies are selected; it does not estimate policy interactions.
