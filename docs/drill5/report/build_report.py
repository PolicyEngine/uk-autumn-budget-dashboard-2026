"""Drill 5 report: the new pair's approved figures as an A4 PolicyEngine report.

Reads the flat files the #185-template view publishes (drill5-on-185-template),
draws each chart as SVG with matplotlib (text kept as text, set in Inter by the
page) and writes report.html, which print.mjs turns into an A4 PDF.

    uv run --with matplotlib python -I build_report.py <public/data> <logo.svg> <out dir>
"""
import csv
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("svg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402

DATA, LOGO, OUT = (Path(a) for a in sys.argv[1:4])
COMBINED = "autumn_budget_2026_combined"
YEAR = "2027"  # 2027-28, the first full year of most measures
YEARS = ["2026", "2027", "2028", "2029", "2030", "2031"]

# Colour by the job it does: teal for a gain to households / a cost to the
# Treasury, amber for a loss to households / revenue raised (the dashboard's
# convention). Pair validated with the dataviz validator (all checks pass).
TEAL, AMBER = "#14A39A", "#D97706"
INK, MUTED, GRID, AXIS = "#1F2937", "#6B7280", "#E5E7EB", "#9CA3AF"
BRAND_DARK = "#285E61"

plt.rcParams.update({
    "svg.fonttype": "none",
    "font.family": "sans-serif",
    "font.size": 9,
    "axes.edgecolor": AXIS,
    "axes.labelcolor": MUTED,
    "axes.titlesize": 9,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def fy(year):
    y = int(year)
    return f"{y}-{(y + 1) % 100:02d}"


def read(name):
    with open(DATA / name, newline="") as f:
        return list(csv.DictReader(f))


budget = read("budgetary_impact.csv")
metrics = read("metrics.csv")
deciles = read("winners_losers.csv")
relative = read("distributional_impact.csv")
ages = read("age_impact.csv")
outlook = json.loads((DATA / "living_standards_outlook.json").read_text())

names = {r["reform_id"]: r["reform_name"] for r in budget if r["reform_id"] != COMBINED}
by_measure = defaultdict(dict)
for r in budget:
    by_measure[r["reform_id"]][r["year"]] = float(r["value"])
package = by_measure.pop(COMBINED)
mean_bn = {k: sum(v.values()) / len(v) for k, v in by_measure.items()}
order = sorted(mean_bn, key=lambda k: mean_bn[k], reverse=True)


def svg(fig):
    buffer = io.StringIO()
    fig.savefig(buffer, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    text = buffer.getvalue()
    text = text[text.index("<svg"):]
    # The page sets the type; keep the chart's own family out of the way
    text = re.sub(r"font-family:[^;\"']*", "font-family: Inter, sans-serif", text)
    text = re.sub(r'font-family="[^"]*"', 'font-family="Inter, sans-serif"', text)
    text = re.sub(r'(<svg[^>]*?) width="[^"]*" height="[^"]*"', r'\1 width="100%"', text, count=1)
    return text


def grid(ax, axis="y"):
    ax.grid(axis=axis, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def label_bars(ax, bars, values, fmt, horizontal=False):
    for bar, v in zip(bars, values):
        if horizontal:
            x = bar.get_width()
            ax.annotate(fmt(v), (x, bar.get_y() + bar.get_height() / 2),
                        xytext=(4 if v >= 0 else -4, 0), textcoords="offset points",
                        ha="left" if v >= 0 else "right", va="center", fontsize=7.5, color=INK)
        else:
            y = bar.get_height()
            ax.annotate(fmt(v), (bar.get_x() + bar.get_width() / 2, y),
                        xytext=(0, 3 if v >= 0 else -3), textcoords="offset points",
                        ha="center", va="bottom" if v >= 0 else "top", fontsize=7.5, color=INK)


def sgn(v, digits=0, suffix=""):
    """A signed number with a true minus sign; a value that rounds to zero is unsigned."""
    text = f"{abs(v):,.{digits}f}"
    if float(text.replace(",", "")) == 0:
        return text + suffix
    return ("+" if v > 0 else "−") + text + suffix


def bn(v):
    return f"−£{abs(v):.1f}bn" if v < 0 else f"£{v:.1f}bn"


# --- Charts -------------------------------------------------------------

charts = {}

# 1. The package's net effect on the public finances, by year
fig, ax = plt.subplots(figsize=(6.6, 2.6))
vals = [package[y] for y in YEARS]
bars = ax.bar([fy(y) for y in YEARS], vals, color=[TEAL if v < 0 else AMBER for v in vals], width=0.55)
ax.axhline(0, color=INK, linewidth=0.8)
label_bars(ax, bars, vals, bn)
ax.set_ylabel("£bn a year")
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}".replace("-", "−")))
ax.set_ylim(min(vals) * 1.25, max(0.5, max(vals) * 1.3))
grid(ax)
charts["package"] = svg(fig)

# 2. Each measure, average a year 2026-27 to 2031-32
fig, ax = plt.subplots(figsize=(6.6, 4.6))
labels = [names[k] for k in order][::-1]
vals = [mean_bn[k] for k in order][::-1]
bars = ax.barh(labels, vals, color=[AMBER if v > 0 else TEAL for v in vals], height=0.62)
ax.axvline(0, color=INK, linewidth=0.8)
label_bars(ax, bars, vals, bn, horizontal=True)
ax.set_xlabel("Average effect on government revenue, £bn a year (2026-27 to 2031-32)")
lo, hi = min(vals), max(vals)
ax.set_xlim(lo * 1.35, hi + (hi - lo) * 0.18)
ax.tick_params(axis="y", length=0, labelsize=7.8, labelcolor=INK)
grid(ax, "x")
charts["measures"] = svg(fig)

# 3. Households by income decile, the package in 2027-28: £ a year and % of income
dec = {r["decile"]: float(r["avg_change"]) for r in deciles if r["reform_id"] == COMBINED and r["year"] == YEAR}
rel = {r["decile"]: float(r["value"]) for r in relative if r["reform_id"] == COMBINED and r["year"] == YEAR}
keys = [str(i) for i in range(1, 11)]
rel_keys = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]
fig, (a1, a2) = plt.subplots(2, 1, figsize=(6.8, 4.6))
v1 = [dec[k] for k in keys]
b1 = a1.bar(keys, v1, color=[TEAL if v >= 0 else AMBER for v in v1], width=0.62)
a1.axhline(0, color=INK, linewidth=0.8)
label_bars(a1, b1, v1, lambda v: sgn(v, 0))
a1.set_title("£ a year", color=INK, loc="left")
v2 = [rel[k] for k in rel_keys]
b2 = a2.bar(keys, v2, color=[TEAL if v >= 0 else AMBER for v in v2], width=0.62)
a2.axhline(0, color=INK, linewidth=0.8)
label_bars(a2, b2, v2, lambda v: sgn(v, 2, "%"))
a2.set_title("% of net income", color=INK, loc="left")
a2.set_xlabel("Income decile (1 = poorest tenth, 10 = richest)")
for a, v in ((a1, v1), (a2, v2)):
    grid(a)
    a.set_ylim(min(0, min(v)) * 1.6 - abs(max(v)) * 0.05, max(v) * 1.25)
    a.yaxis.set_major_formatter(FuncFormatter(lambda t, _: f"{t:g}".replace("-", "−")))
fig.tight_layout(h_pad=1.5)
charts["deciles"] = svg(fig)

# 4. By age, the package in 2027-28
bands = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+"]
age = {r["age_band"]: r for r in ages if r["reform_id"] == COMBINED and r["year"] == YEAR}
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.8, 2.5))
v1 = [float(age[b]["mean_change"]) for b in bands]
b1 = a1.bar(bands, v1, color=TEAL, width=0.62)
label_bars(a1, b1, v1, lambda v: f"£{v:.0f}")
a1.set_title("Average change in household net income, £ a year", color=INK, loc="left", fontsize=8.5)
a1.set_xlabel("Age")
v2 = [float(age[b]["pct_better_off"]) for b in bands]
b2 = a2.bar(bands, v2, color=TEAL, width=0.62)
label_bars(a2, b2, v2, lambda v: f"{v:.0f}%")
a2.set_title("People in households better off, %", color=INK, loc="left", fontsize=8.5)
a2.set_xlabel("Age")
a2.set_ylim(0, 110)
a1.set_ylim(0, max(v1) * 1.2)
for a in (a1, a2):
    grid(a)
fig.tight_layout(w_pad=2.5)
charts["age"] = svg(fig)

# 5. Poverty and inequality, the package by year (two panels, never two axes)
met = {r["year"]: r for r in metrics if r["reform_id"] == COMBINED}
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.8, 2.4))
v1 = [float(met[y]["poverty_change_pp"]) for y in YEARS]
b1 = a1.bar([fy(y) for y in YEARS], v1, color=[TEAL if v <= 0 else AMBER for v in v1], width=0.6)
a1.axhline(0, color=INK, linewidth=0.8)
label_bars(a1, b1, v1, lambda v: sgn(v, 2, "pp"))
a1.set_title("Poverty rate, change in percentage points", color=INK, loc="left", fontsize=8.5)
v2 = [float(met[y]["gini_change"]) * 100 for y in YEARS]
b2 = a2.bar([fy(y) for y in YEARS], v2, color=[TEAL if v <= 0 else AMBER for v in v2], width=0.6)
a2.axhline(0, color=INK, linewidth=0.8)
label_bars(a2, b2, v2, lambda v: sgn(v, 2))
a2.set_title("Gini index, change in points (0 to 100 scale)", color=INK, loc="left", fontsize=8.5)
for a, v in ((a1, v1), (a2, v2)):
    grid(a)
    a.set_ylim(min(v) * 1.45, max(0.02, max(v) * 1.45))
    a.tick_params(axis="x", labelsize=7)
    a.yaxis.set_major_formatter(FuncFormatter(lambda t, _: f"{t:g}".replace("-", "−")))
fig.tight_layout(w_pad=2.5)
charts["poverty"] = svg(fig)

# 6. The outlook before any measure: real median income and absolute poverty
ls_proj = outlook["living_standards"]["projection"]["median_equivalised_income"]
pov = outlook["poverty"]["projection"]["absolute_bhc"]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.8, 2.4))
xs = [p["year"] for p in ls_proj]
a1.plot(xs, [p["real"] / 1000 for p in ls_proj], color=TEAL, linewidth=2, marker="o", markersize=4)
a1.set_ylim(0, max(p["real"] for p in ls_proj) / 1000 * 1.15)
a1.set_title("Median household income (BHC), £k a year,\n2027-28 prices, for a couple with no children", color=INK, loc="left", fontsize=8.5)
a1.tick_params(axis="x", rotation=45)
xs2 = [p["year"] for p in pov["all"]]
a2.plot(xs2, [p["rate"] * 100 for p in pov["all"]], color=TEAL, linewidth=2, marker="o", markersize=4, label="All people")
a2.plot(xs2, [p["rate"] * 100 for p in pov["children"]], color=BRAND_DARK, linewidth=2, marker="s", markersize=4, linestyle="--", label="Children")
a2.set_title("Absolute poverty (BHC), % of people", color=INK, loc="left", fontsize=8.5)
a2.set_ylim(0, max(p["rate"] for p in pov["children"]) * 100 * 1.35)
a2.legend(frameon=False, fontsize=7.5, loc="upper center", ncol=2)
a2.tick_params(axis="x", rotation=45)
for a in (a1, a2):
    grid(a)
    a.tick_params(axis="x", labelsize=6.8)
fig.tight_layout(w_pad=2.5)
charts["outlook"] = svg(fig)

# 7. Results by constituency, 2027-28: two measures that vary by place
from matplotlib.collections import PatchCollection  # noqa: E402
from matplotlib.colors import BoundaryNorm, ListedColormap  # noqa: E402
from matplotlib.patches import Polygon as MplPolygon  # noqa: E402

geo = json.loads((DATA / "uk_constituencies_2024.geojson").read_text())
seats = defaultdict(dict)
for r in read("constituency.csv"):
    if r["year"] == YEAR and r["outcome"] == "relative_change":
        seats[r["reform"]][r["area_code"]] = (r["value"], r["tier"])
MAP_MEASURES = ["lha_reset_april_2027", "domestic_electricity_zero_vat"]
# One teal hue, light to dark (sequential); withheld seats a neutral grey
SEQ = ["#D5F0ED", "#9ADBD4", "#4FBFB4", "#14A39A", "#0B6E68"]
WITHHELD = "#E5E7EB"


def shapes(feature):
    g = feature["geometry"]
    rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [poly[0] for poly in g["coordinates"]]
    return [MplPolygon(ring, closed=True) for ring in rings]


fig, axes = plt.subplots(1, 2, figsize=(6.8, 4.6))
map_stats = {}
for ax, measure in zip(axes, MAP_MEASURES):
    values = [float(v) * 100 for v, t in seats[measure].values() if v != ""]
    top = max(values)
    edges = [0, top * 0.2, top * 0.4, top * 0.6, top * 0.8, top * 1.0001]
    norm = BoundaryNorm(edges, len(SEQ))
    patches, colours = [], []
    for feature in geo["features"]:
        value, tier = seats[measure].get(feature["properties"]["GSScode"], ("", "withheld"))
        colour = WITHHELD if value == "" else SEQ[min(norm(float(value) * 100), len(SEQ) - 1)]
        for shape in shapes(feature):
            patches.append(shape)
            colours.append(colour)
    ax.add_collection(PatchCollection(patches, facecolor=colours, edgecolor="white", linewidth=0.12))
    ax.autoscale_view()
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(f"{names[measure]}\n% of household net income", color=INK, loc="left", fontsize=8.2)
    cbar = fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=ListedColormap(SEQ)), ax=ax, orientation="horizontal", fraction=0.035, pad=0.02)
    cbar.ax.tick_params(labelsize=6.5)
    cbar.ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.2f}"))
    cbar.outline.set_visible(False)
    shown = sum(1 for v, t in seats[measure].values() if v != "")
    map_stats[measure] = (shown, len(seats[measure]), top)
fig.tight_layout(w_pad=1.5)
charts["map"] = svg(fig)

# --- Figures quoted in the text -----------------------------------------

y27 = package[YEAR]
all_hh = dec["all"]
pp27 = float(met[YEAR]["poverty_change_pp"])
gini27 = float(met[YEAR]["gini_change"]) * 100
affected27 = float(met[YEAR]["people_affected"])
largest_cost = min(mean_bn, key=mean_bn.get)
largest_raise = max(mean_bn, key=mean_bn.get)
sum_measures_27 = sum(v[YEAR] for k, v in by_measure.items() if k != "state_pension_income_tax_protection_extended")
pen = float(age["65+"]["mean_change"])
young = float(age["16-24"]["mean_change"])
top_decile = dec["10"]
bottom_decile_pct = rel["1st"]

# Measure table: £bn by year
policy_rows = []
for k in order:
    cells = "".join(
        f'<td class="num {"neg" if by_measure[k][y] < -0.0005 else "pos" if by_measure[k][y] > 0.0005 else ""}">'
        f'{"−" if by_measure[k][y] < -0.0005 else ""}{abs(by_measure[k][y]):.2f}</td>' for y in YEARS)
    policy_rows.append(f"<tr><td>{names[k]}</td>{cells}</tr>")
package_row = "".join(f'<td class="num">{"−" if package[y] < 0 else ""}{abs(package[y]):.2f}</td>' for y in YEARS)

# Measure table: households and poverty, 2027-28
m27 = {r["reform_id"]: r for r in metrics if r["year"] == YEAR}
w27 = {r["reform_id"]: float(r["avg_change"]) for r in deciles if r["year"] == YEAR and r["decile"] == "all"}
hh_rows = []
for k in order:
    r = m27[k]
    hh_rows.append(
        f"<tr><td>{names[k]}</td>"
        f'<td class="num">{sgn(w27[k], 0)}</td>'
        f'<td class="num">{float(r["people_affected"]):.1f}%</td>'
        f'<td class="num">{sgn(float(r["poverty_change_pp"]), 2)}</td>'
        f'<td class="num">{sgn(float(r["gini_change"]) * 100, 3)}</td></tr>'
    )

# Who gains and loses, by measure, 2027-28: the poorest and richest tenth, and people 65 and over
d27 = {(r["reform_id"], r["decile"]): float(r["avg_change"]) for r in deciles if r["year"] == YEAR}
a27 = {r["reform_id"]: float(r["mean_change"]) for r in ages if r["year"] == YEAR and r["age_band"] == "65+"}
split_rows = "".join(
    f"<tr><td>{names[k]}</td><td class=\"num\">{sgn(d27[(k, '1')], 0)}</td>"
    f"<td class=\"num\">{sgn(d27[(k, '10')], 0)}</td><td class=\"num\">{sgn(a27[k], 0)}</td></tr>"
    for k in order if abs(d27[(k, '1')]) >= 0.5 or abs(d27[(k, '10')]) >= 0.5 or abs(a27[k]) >= 0.5)
top_drivers = sorted((k for k in order if k != "state_pension_income_tax_protection_extended"), key=lambda k: d27[(k, "10")])[:2]
pen_drivers = sorted((k for k in order if k != "state_pension_income_tax_protection_extended"), key=lambda k: -a27[k])[:3]
sp_pen = a27["state_pension_income_tax_protection"]
freeze_31 = by_measure["threshold_freeze_2031_32"]["2031"]
PHRASE = {
    "fuel_duty_rise_deferral": "the fuel duty deferral",
    "warm_home_discount_top_up": "the Warm Home Discount top-up",
    "uc_standard_allowance_below_cpi": "the lower Universal Credit standard allowance",
    "state_pension_income_tax_protection": "the State Pension income tax protection",
    "state_pension_income_tax_protection_extended": "the extended State Pension income tax protection",
    "domestic_electricity_zero_vat": "zero VAT on electricity",
    "employer_ni_secondary_threshold_raised": "the higher employer NI threshold",
    "employer_ni_relief_under_25s": "the employer NI relief for under-25s",
    "cgt_main_rates_up_2pp": "the capital gains tax rise",
    "council_tax_surcharge_from_1_5m": "the council tax surcharge",
    "lha_reset_april_2027": "the Local Housing Allowance reset",
    "dividend_rates_up_1pp": "the dividend tax rise",
    "domestic_gas_zero_vat": "zero VAT on gas",
    "threshold_freeze_2031_32": "the threshold freeze",
    "badr_lifetime_limit_cut": "the Business Asset Disposal Relief restriction",
}


def cap(text):
    return text[0].upper() + text[1:]


relief_in_force = sum(by_measure["employer_ni_relief_under_25s"][y] for y in YEARS[1:]) / len(YEARS[1:])

logo = LOGO.read_text()
logo = re.sub(r'width="\d+" height="\d+"', 'class="logo"', logo, count=1)

measures_text = {
    "fuel_duty_rise_deferral": "Holds fuel duty at 52.95p a litre through winter 2026-27 and restores the 5p in two steps in 2027-28.",
    "warm_home_discount_top_up": "Raises the Warm Home Discount from £150 to £250 for winter 2026-27.",
    "uc_standard_allowance_below_cpi": "Sets the Universal Credit standard allowance 1% below current law from April 2027 (mock).",
    "state_pension_income_tax_protection": "An income tax allowance equal to the full new State Pension for pensioners whose only income is the State Pension.",
    "state_pension_income_tax_protection_extended": "As above, never withdrawn: an alternative, left out of the combined run.",
    "domestic_electricity_zero_vat": "Removes the 5% VAT on domestic electricity, Great Britain only.",
    "employer_ni_secondary_threshold_raised": "Raises the employer NI secondary threshold from £5,000 to £6,000 (mock), at fixed pay.",
    "employer_ni_relief_under_25s": "No employer NI on earnings of 21 to 24-year-olds up to the upper secondary threshold.",
    "cgt_main_rates_up_2pp": "Raises the main capital gains tax rates to 20% and 26% (mock); static.",
    "council_tax_surcharge_from_1_5m": "Starts the high value council tax surcharge at £1.5m, £2,500 a year, from April 2028 (mock).",
    "lha_reset_april_2027": "Resets Local Housing Allowance to the 30th percentile of rents in April 2027, then freezes it.",
    "dividend_rates_up_1pp": "Raises each dividend tax rate by 1 point (mock).",
    "domestic_gas_zero_vat": "Removes the 5% VAT on domestic gas for 2027-28 (mock), Great Britain only.",
    "threshold_freeze_2031_32": "Holds the personal allowance and basic rate band in 2031-32.",
    "badr_lifetime_limit_cut": "Cuts the Business Asset Disposal Relief lifetime limit from £1m to £500,000.",
}
measure_list = "".join(
    f'<tr><td class="mname"><span class="dot" style="background:{AMBER if mean_bn[k] > 0 else TEAL}"></span>{names[k]}</td><td>{measures_text[k]}</td></tr>'
    for k in order)


def neg(v, f):
    return ("−" if v < 0 else "") + f.format(abs(v))


html = f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>Autumn Budget 2026 rehearsal (mock data)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page {{ size: A4; margin: 18mm 18mm 20mm 18mm; }}
@page :first {{ margin: 0 0 14mm 0; }}
* {{ box-sizing: border-box; }}
html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
body {{ font-family: Inter, sans-serif; color: {INK}; font-size: 9.6pt; line-height: 1.55; margin: 0; }}
h1, h2, h3 {{ font-weight: 700; letter-spacing: -0.01em; }}
h2 {{ font-size: 17pt; color: {BRAND_DARK}; margin: 0 0 4mm; padding-top: 2mm; }}
h3 {{ font-size: 11pt; margin: 6mm 0 2mm; }}
p {{ margin: 0 0 3mm; }}
.section {{ break-before: page; }}
.kicker {{ text-transform: uppercase; letter-spacing: 0.08em; font-size: 7.5pt; font-weight: 600; color: {TEAL}; margin-bottom: 1mm; }}
.mock {{ background: #B91C1C; color: #fff; font-weight: 700; font-size: 8pt; padding: 2mm 4mm; border-radius: 1.5mm; display: inline-block; letter-spacing: 0.03em; }}
.mockline {{ border: 1px solid #FCA5A5; background: #FEF2F2; color: #991B1B; padding: 3mm 4mm; border-radius: 2mm; font-size: 8.6pt; margin: 4mm 0; }}
/* Cover */
.cover {{ height: 283mm; position: relative; background: linear-gradient(160deg, #F0FAF9 0%, #ffffff 55%); padding: 22mm 20mm; }}
.cover .logo {{ width: 52mm; height: auto; }}
.cover h1 {{ font-size: 32pt; line-height: 1.12; margin: 46mm 0 6mm; color: {INK}; }}
.cover .sub {{ font-size: 13pt; color: {MUTED}; max-width: 150mm; }}
.cover .band {{ position: absolute; left: 0; right: 0; bottom: 0; height: 9mm; background: {TEAL}; }}
.cover .meta {{ position: absolute; left: 20mm; right: 20mm; bottom: 20mm; font-size: 8.5pt; color: {MUTED}; border-top: 1px solid {GRID}; padding-top: 4mm; display: flex; justify-content: space-between; }}
/* Key figures */
.tiles {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin: 5mm 0 6mm; }}
.tile {{ border: 1px solid {GRID}; border-radius: 2.5mm; padding: 4mm; }}
.tile .v {{ font-size: 19pt; font-weight: 800; color: {BRAND_DARK}; line-height: 1.1; }}
.tile .l {{ font-size: 8pt; color: {MUTED}; margin-top: 1.5mm; }}
ul.findings {{ padding-left: 5mm; margin: 0 0 3mm; }}
ul.findings li {{ margin-bottom: 2mm; }}
figure {{ margin: 3mm 0 5mm; break-inside: avoid; }}
figcaption {{ font-size: 8pt; color: {MUTED}; margin-top: 1.5mm; }}
figure .ftitle {{ font-weight: 600; font-size: 9.5pt; margin-bottom: 1mm; }}
table {{ width: 100%; border-collapse: collapse; font-size: 8.2pt; margin: 2mm 0 4mm; break-inside: avoid; }}
th {{ text-align: left; font-weight: 600; color: {MUTED}; border-bottom: 1.5px solid {INK}; padding: 1.5mm 1.5mm; font-size: 7.6pt; }}
td {{ border-bottom: 1px solid {GRID}; padding: 1.3mm 1.5mm; vertical-align: top; }}
td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }}
td.neg {{ color: #0F766E; }} td.pos {{ color: #B45309; }}
tr.total td {{ font-weight: 700; border-top: 1.5px solid {INK}; }}
.dot {{ display: inline-block; width: 2.4mm; height: 2.4mm; border-radius: 50%; margin-right: 2mm; vertical-align: middle; }}
td.mname {{ font-weight: 600; width: 52mm; }}
.legend {{ font-size: 8pt; color: {MUTED}; margin: 1mm 0 2mm; }}
.legend span.sw {{ display: inline-block; width: 3mm; height: 3mm; border-radius: 0.6mm; vertical-align: -0.4mm; margin: 0 1.5mm 0 4mm; }}
.callout {{ background: #F0FAF9; border-left: 1.2mm solid {TEAL}; padding: 3mm 4mm; margin: 4mm 0; font-size: 9pt; }}
.pending {{ border: 1.5px dashed {AXIS}; border-radius: 2.5mm; padding: 10mm; text-align: center; color: {MUTED}; margin: 6mm 0; }}
.small {{ font-size: 8pt; color: {MUTED}; }}
.toc {{ margin: 4mm 0; display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }}
.keep {{ break-inside: avoid; }}
h3 {{ break-after: avoid; }}
.toc div {{ display: flex; justify-content: space-between; border-bottom: 1px dotted {AXIS}; padding: 1.4mm 0; font-size: 9.5pt; }}
</style></head><body>

<section class="cover">
  {logo}
  <div style="margin-top:10mm"><span class="mock">MOCK DATA · BUDGET REHEARSAL · NOT A BUDGET ANALYSIS</span></div>
  <h1>Autumn Budget 2026<br>rehearsal (mock data)</h1>
  <div class="sub">How fifteen candidate Autumn Budget 2026 measures (fourteen in the combined run) would affect the public finances, households across the income distribution and age groups, poverty and inequality, modelled with PolicyEngine UK.</div>
  <div class="meta"><span>PolicyEngine · Draft, 26 October 2026</span><span>policyengine 6.11.0 · policyengine-uk 2.151.0</span></div>
  <div class="band"></div>
</section>

<section class="section">
  <div class="kicker">Summary</div>
  <h2>Key findings</h2>
  <div class="mockline"><b>This is a rehearsal, not an analysis of the Budget.</b> The fifteen measures are candidates chosen for PolicyEngine's Drill 5 (26 October 2026), several with assumed (mock) values, and every approval, Treasury figure and attestation behind these figures is mock. The Budget is on 28 October 2026.</div>
  <div class="tiles">
    <div class="tile"><div class="v">{bn(y27)}</div><div class="l">Net effect on government revenue in 2027-28, all fourteen measures in the combined run</div></div>
    <div class="tile"><div class="v">{neg(all_hh, "£{:,.0f}")}</div><div class="l">Average change in household net income a year, 2027-28</div></div>
    <div class="tile"><div class="v">{neg(pp27, "{:.2f}pp")}</div><div class="l">Change in the absolute poverty rate (BHC), 2027-28</div></div>
  </div>
  <ul class="findings">
    <li><b>Public finances.</b> Together the measures reduce revenue by £{abs(y27):.1f}bn in 2027-28, and by between £{abs(max(package[y] for y in YEARS[1:])):.1f}bn and £{abs(min(package[y] for y in YEARS[1:])):.1f}bn a year from 2027-28 to 2031-32. Run separately, the same fourteen reduce it by £{abs(sum_measures_27):.1f}bn in 2027-28; the difference is how the measures interact. About £{abs(by_measure["employer_ni_relief_under_25s"][YEAR]):.1f}bn of the 2027-28 cost is the employer NI relief for under-25s, which goes to employers and, with pay held fixed, does not show in household incomes.</li>
    <li><b>The largest measures.</b> Averaged over 2026-27 to 2031-32, {PHRASE[largest_cost]} costs the most, £{abs(mean_bn[largest_cost]):.1f}bn a year (£{abs(relief_in_force):.1f}bn a year from 2027-28, when it is in force all year), and {PHRASE[largest_raise]} raises the most, £{mean_bn[largest_raise]:.1f}bn. The threshold freeze raises more in its one year, £{freeze_31:.1f}bn in 2031-32.</li>
    <li><b>Households.</b> Household net income rises by £{all_hh:,.0f} a year on average in 2027-28. Gains are largest as a share of income in the poorest tenth ({sgn(bottom_decile_pct, 1, "%")}); the richest tenth lose £{abs(top_decile):,.0f} a year on average, most of it from {PHRASE[top_drivers[0]]} and {PHRASE[top_drivers[1]]} (table in section 2).</li>
    <li><b>Age.</b> People aged 16 to 24 live in households gaining £{young:,.0f} a year on average and people aged 65 and over £{pen:,.0f}.</li>
    <li><b>Poverty and inequality.</b> Absolute poverty before housing costs falls by {abs(pp27):.2f} percentage points in 2027-28 and the Gini index by {abs(gini27):.2f} points (on a 0 to 100 scale); {affected27:.0f}% of people live in a household whose net income changes.</li>
  </ul>
  <h3>Contents</h3>
  <div class="toc">
    <div><span>1. Public finances</span></div>
    <div><span>2. Households by income</span></div>
    <div><span>3. Young people and pensioners</span></div>
    <div><span>4. Poverty and inequality</span></div>
    <div><span>5. The outlook before the measures</span></div>
    <div><span>6. Results by constituency</span></div>
    <div><span>7. The measures</span></div>
    <div><span>8. Method, data and caveats</span></div>
  </div>
</section>

<section class="section">
  <div class="kicker">Section 1</div>
  <h2>Public finances</h2>
  <p>The net effect of the measures on government revenue each year, as PolicyEngine costs them: static, with no behavioural response, on the Microcosm UK 2024-25 national dataset. Below zero is a cost to the Treasury.</p>
  <figure><div class="ftitle">The fourteen measures together, by year</div>{charts["package"]}
  <figcaption>Change in government revenue, £bn a year. Combined run of fourteen measures (the extended State Pension protection is an alternative and left out). Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
  <figure><div class="ftitle">Each measure, average a year</div>
  <div class="legend"><span class="sw" style="background:{AMBER}"></span>Raises revenue<span class="sw" style="background:{TEAL}"></span>Costs revenue</div>
  {charts["measures"]}
  <figcaption>Average change in government revenue, £bn a year, 2026-27 to 2031-32. Each measure run on its own against current law. Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
</section>

<section>
  <div class="keep"><h3>Each measure by year, £bn</h3>
  <table><thead><tr><th>Measure</th>{"".join(f'<th class="num">{fy(y)}</th>' for y in YEARS)}</tr></thead>
  <tbody>{"".join(policy_rows)}<tr class="total"><td>Combined run (fourteen measures)</td>{package_row}</tr></tbody></table>
  <p class="small">Negative values cost revenue. Each row is a measure on its own; the combined run includes the interactions between them and leaves out the extended State Pension protection.</p></div>
</section>

<section class="section">
  <div class="kicker">Section 2</div>
  <h2>Households by income</h2>
  <p>How household net income changes across the income distribution in 2027-28, with all fourteen measures in place. Households are ranked into tenths (deciles) by their equivalised net income before the measures.</p>
  <figure><div class="ftitle">Average change in household net income by income decile, 2027-28</div>{charts["deciles"]}
  <figcaption>Top: £ a year. Bottom: % of net income. Here teal is a gain to households and amber a loss (in section 1 the same colours mean a cost to and a gain for the Treasury). Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
  <div class="callout">The measures that raise revenue from dividends, capital gains and business disposals fall mostly on the richest tenth. The zero VAT on electricity and gas, the fuel duty deferral and the Local Housing Allowance reset raise lower incomes most as a share of income; setting the Universal Credit standard allowance below current law lowers them. The employer NI measures change no household's income here, because pay is held fixed.</div>
  <div class="keep"><h3>Who gains and loses, by measure, 2027-28</h3>
  <table><thead><tr><th>Measure</th><th class="num">Poorest tenth, £ a year</th><th class="num">Richest tenth, £ a year</th><th class="num">People 65+, £ a year</th></tr></thead>
  <tbody>{split_rows}</tbody></table>
  <p class="small">Average change in household net income for households in the poorest and richest tenths, and for people aged 65 and over. Measures with no effect in 2027-28 are left out.</p></div>
  <div class="keep"><h3>Households and poverty, by measure, 2027-28</h3>
  <table><thead><tr><th>Measure</th><th class="num">Avg £ a year</th><th class="num">People affected</th><th class="num">Poverty (pp)</th><th class="num">Gini points</th></tr></thead>
  <tbody>{"".join(hh_rows)}</tbody></table>
  <p class="small">Average change in household net income over all households; people in households whose net income changes; change in the absolute poverty rate before housing costs; change in the Gini index of equivalised household net income. A measure starting after 2027-28 shows no effect in this year.</p></div>
</section>

<section class="section">
  <div class="kicker">Section 3</div>
  <h2>Young people and pensioners</h2>
  <p>The same package by age, in 2027-28: the average change in the net income of the households people live in, and the share of people in households that are better off.</p>
  <figure>{charts["age"]}
  <figcaption>Per person, by the age of the person; household income is shared by everyone in the household. Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
  <p>The employer NI relief applies to the earnings of 21 to 24-year-olds but, with pay held fixed, raises none of their incomes here. For people aged 65 and over the largest gains come from {", ".join(PHRASE[k] for k in pen_drivers[:-1])} and {PHRASE[pen_drivers[-1]]} (table in section 2). The State Pension income tax protection adds £{sp_pen:.0f} a year on average across them, because it reaches only those whose only income is the State Pension.</p>

  <div class="kicker" style="margin-top:9mm">Section 4</div>
  <h2>Poverty and inequality</h2>
  <p>The change in absolute poverty before housing costs (below 60% of the 2024-25 median, held fixed in real terms) and in the Gini index of equivalised household net income, with all fourteen measures, by year.</p>
  <figure>{charts["poverty"]}
  <figcaption>Left: percentage points. Right: Gini points on a 0 to 100 scale. Teal is a fall. Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
</section>

<section class="section">
  <div class="kicker">Section 5</div>
  <h2>The outlook before the measures</h2>
  <p>PolicyEngine's projection of living standards under current law, before any of the measures: real median household income and absolute poverty, from 2024-25 to 2031-32. These are the baseline the measures change.</p>
  <figure>{charts["outlook"]}
  <figcaption>Equivalised household net income before housing costs; poverty below 60% of the 2024-25 median, fixed in real terms. Baseline projection on policyengine-uk 2.132.6 and the 19 October Microcosm national build (the outlook published on the dashboard, not regenerated for this drill). Modelled incomes at the bottom and middle of the distribution are higher than in the official HBAI statistics (the median by about 6%), so modelled poverty rates sit below the official ones.</figcaption></figure>

</section>

<section class="section">
  <div class="kicker">Section 6</div>
  <h2>Results by constituency</h2>
  <p>Average change in household net income by Westminster constituency (2024 boundaries) in 2027-28, as a share of income, for two measures whose effect varies by place. Every measure is published by constituency on the dashboard.</p>
  <figure>{charts["map"]}
  <figcaption>Grey: withheld, where the estimate is too uncertain or could disclose survey records ({map_stats["lha_reset_april_2027"][1] - map_stats["lha_reset_april_2027"][0]} of {map_stats["lha_reset_april_2027"][1]} seats for the Local Housing Allowance reset, which reaches few households in each seat; {map_stats["domestic_electricity_zero_vat"][1] - map_stats["domestic_electricity_zero_vat"][0]} for zero VAT on electricity, which is for Great Britain only, so Northern Ireland's seats show no change). Microcosm's local-area data, disclosure-controlled. Source: PolicyEngine UK, Drill 5 (mock data).</figcaption></figure>
</section>

<section class="section">
  <div class="kicker">Section 7</div>
  <h2>The measures</h2>
  <p>The fifteen candidate measures in Drill 5, ordered from the largest revenue raiser to the largest cost. Values marked mock are drill choices where reporting gave no figure.</p>
  <table><thead><tr><th>Measure</th><th>What it does, as modelled</th></tr></thead><tbody>{measure_list}</tbody></table>
</section>

<section class="section">
  <div class="kicker">Section 8</div>
  <h2>Method, data and caveats</h2>
  <h3>Model and data</h3>
  <p>PolicyEngine UK, a microsimulation model of the UK tax and benefit system, through policyengine 6.11.0 (policyengine-uk 2.151.0), on the Microcosm UK 2024-25 national dataset (microcosm-uk-2024-25-national-20261025T091414Z-a6299504). We simulated each measure on its own against current law, and the fourteen together in one combined run, for 2026-27 to 2031-32. We ran them in the cloud, one machine per measure; each run records its inputs and package versions.</p>
  <h3>What the figures leave out</h3>
  <ul class="findings">
    <li><b>Static costings.</b> No behavioural response: capital gains, dividends, fuel and energy use and pay are held fixed. The employer NI measures are costed at fixed pay, so they change no household's income.</li>
    <li><b>Known gaps in three measures</b> (from PolicyEngine's review of the drill measures, not fixed in this run): the capital gains measure leaves the additional rate at 24%; the Local Housing Allowance reset leaves Northern Ireland frozen; the dividend measure leaves the £10m bracket unchanged.</li>
    <li><b>Combined run.</b> Fourteen measures: the extended State Pension protection is an alternative design and left out.</li>
    <li><b>The outlook</b> in section 5 is the dashboard's published baseline on the earlier pin (policyengine-uk 2.132.6), not regenerated for this run.</li>
  </ul>
  <h3>Rehearsal status</h3>
  <div class="mockline">Every approval, attestation and Treasury figure behind these numbers is MOCK, made for Drill 5 only. The measures are candidates, several with assumed values, and none has been announced. Nothing here is PolicyEngine's analysis of the Autumn Budget 2026.</div>
  <p class="small">Replication: github.com/PolicyEngine/uk-autumn-budget-dashboard-2026, branch drill5-wednesday-path-newpair (figures) and drill5-on-185-template (flat files). Drill log: issue #144.</p>
</section>
</body></html>
"""
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "report.html").write_text(html)
print("wrote", OUT / "report.html")
