"""MOCK drill 3: costing static and Table 4.1 post-behavioural figures (£m), copied from
MOCK-policy-costings.md and MOCK-policy-decisions.xlsx (released 13:40)."""
FY = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31", "2031-32"]
STATIC = {
    1: [0, 0, 0, 0, 0, 2945],
    2: [0, -290, -620, -1020, -1480, -1855],
    3: [-540, -550, 0, 0, 0, 0],
    4: [0, 115, 1655, 1725, 1795, 1870],
    5: [0, -1395, -1445, -1495, -1545, -1600],
    6: [0, 0, 55, 55, 55, 60],
    7: [0, 1460, 1885, 1960, 2040, 2120],
    8: [0, -1700, -1895, -2045, -2190, -2335],
    9: [-395, -1280, -880, -905, -935, -965],
    10: [0, 155, 615, 635, 650, 670],
    20: [0, 0, 0, 780, 815, 850],
}
POST = {
    1: [0, 0, 0, 0, 0, 2830],
    2: [0, -285, -615, -1010, -1465, -1835],
    3: [-540, -550, 0, 0, 0, 0],
    4: [95, 1260, -285, 535, 945, 980],
    5: [0, -1145, -1040, -1015, -1020, -1040],
    6: [0, 0, 45, 45, 45, 45],
    7: [0, 760, 980, 1020, 1060, 1100],
    8: [0, -1750, -1950, -2105, -2255, -2405],
    9: [-385, -1240, -855, -880, -905, -935],
    10: [0, 130, 525, 540, 555, 570],
    20: [0, 0, 0, 690, 720, 750],
}
# Measure 2 alone in 2031-32 (static) is -1,640; stacked after measure 1 it is -1,855.
INTERACTION_1_2_STATIC_2031 = -1855 - (-1640)
ID = {
    1: "mock3_threshold_freeze_2032", 2: "mock3_pensioner_allowance", 3: "mock3_whd_top_up",
    4: "mock3_cgt_higher_rate_aea", 5: "mock3_employer_ni_under_22", 6: "mock3_hvcts_top_bands",
    7: "mock3_additional_rate_threshold", 8: "mock3_lha_30th_percentile",
    9: "mock3_fuel_duty_phasing", 10: "mock3_class4_main_rate", 20: "mock3_salary_sacrifice_cap",
}
