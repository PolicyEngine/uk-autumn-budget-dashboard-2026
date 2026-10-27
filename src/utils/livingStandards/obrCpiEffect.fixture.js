// Test fixture: the OBR's Autumn Budget 2025 estimate of the measures' effect
// on CPI inflation (EFO November 2025, Chart 3.4, page 64; chapter 3 charts and
// tables workbook, sheet C3.4), as public/data/obr_cpi_policy_effect.json would
// carry it. For tests only: the file itself is published on Budget day.
export const AB2025_CPI_EFFECT = {
    "schema": "uk-budget-obr-cpi-policy-effect/v1",
    "budget": "Autumn Budget 2025",
    "budget_date": "2025-11-26",
    "previous_budget": true,
    "efo": "Economic and fiscal outlook, November 2025",
    "efo_url": "https://obr.uk/efo/economic-and-fiscal-outlook-november-2025/",
    "source_table": "Chart 3.4: Impact of Budget policies on CPI inflation",
    "source_file": "chapter 3 charts and tables workbook, sheet C3.4",
    "page": 64,
    "basis": "fiscal_years",
    "years": [
      {
        "year": "2025-26",
        "pp": 0.003546
      },
      {
        "year": "2026-27",
        "pp": -0.429582
      },
      {
        "year": "2027-28",
        "pp": 0.089809
      },
      {
        "year": "2028-29",
        "pp": 0.138541
      },
      {
        "year": "2029-30",
        "pp": 0.009622
      },
      {
        "year": "2030-31",
        "pp": -0.002723
      }
    ],
    "by_measure": [
      {
        "measure": "Energy bills package",
        "years": [
          {
            "year": "2025-26",
            "pp": 0.003546
          },
          {
            "year": "2026-27",
            "pp": -0.251956
          },
          {
            "year": "2027-28",
            "pp": 0.001319
          },
          {
            "year": "2028-29",
            "pp": 0.014846
          },
          {
            "year": "2029-30",
            "pp": 0.019235
          },
          {
            "year": "2030-31",
            "pp": 0.012271
          }
        ]
      },
      {
        "measure": "Fuel duty freeze extension",
        "years": [
          {
            "year": "2025-26",
            "pp": 0.0
          },
          {
            "year": "2026-27",
            "pp": -0.128978
          },
          {
            "year": "2027-28",
            "pp": 0.075964
          },
          {
            "year": "2028-29",
            "pp": -0.000451
          },
          {
            "year": "2029-30",
            "pp": -0.000374
          },
          {
            "year": "2030-31",
            "pp": -0.000248
          }
        ]
      },
      {
        "measure": "Rail fares freeze",
        "years": [
          {
            "year": "2025-26",
            "pp": 0.0
          },
          {
            "year": "2026-27",
            "pp": -0.045537
          },
          {
            "year": "2027-28",
            "pp": -0.002199
          },
          {
            "year": "2028-29",
            "pp": -0.001845
          },
          {
            "year": "2029-30",
            "pp": -0.00165
          },
          {
            "year": "2030-31",
            "pp": -0.001941
          }
        ]
      },
      {
        "measure": "Mileage-based charge on electric cars",
        "years": [
          {
            "year": "2025-26",
            "pp": 0.0
          },
          {
            "year": "2026-27",
            "pp": -0.018401
          },
          {
            "year": "2027-28",
            "pp": -0.008151
          },
          {
            "year": "2028-29",
            "pp": 0.132532
          },
          {
            "year": "2029-30",
            "pp": -0.001026
          },
          {
            "year": "2030-31",
            "pp": -0.012804
          }
        ]
      },
      {
        "measure": "Output gap",
        "indirect": true,
        "years": [
          {
            "year": "2025-26",
            "pp": 0.0
          },
          {
            "year": "2026-27",
            "pp": 0.015291
          },
          {
            "year": "2027-28",
            "pp": 0.022877
          },
          {
            "year": "2028-29",
            "pp": -0.006541
          },
          {
            "year": "2029-30",
            "pp": -0.006563
          },
          {
            "year": "2030-31",
            "pp": 0.0
          }
        ]
      }
    ],
    "notes": [
      "The OBR estimates the largest effect, 0.5 percentage points lower, in the second quarter of 2026; in calendar years, 0.3 points lower in 2026 (paragraph 2.33).",
      "The fuel duty freeze extension in the OBR's forecast differs slightly from the final policy; the OBR says the final policy would have changed its inflation forecast by less than 0.1 percentage points (footnote 6)."
    ]
  };
