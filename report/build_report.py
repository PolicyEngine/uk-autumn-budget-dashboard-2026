"""The Budget-day PDF report, built from the published manifest and its artifacts.

Reads ``<data>/manifest.json`` and the artifacts it names (never the flat
CSVs beside it), shows only displayable entries (approved or provisional),
and uses the combined run only when it covers exactly the displayed measures
with their current outputs, as the dashboard does (``src/utils/publication/
select.js``). Every figure printed is written to ``figures.json`` with the
file, row and column it came from; ``check`` recomputes them.

    uv run --with matplotlib==3.10.1 --with playwright==1.52.0 \\
        python -I report/build_report.py build --data public/data --out build/report --pdf

    uv run python -I report/build_report.py check build/report/figures.json --data public/data

Nothing here writes under ``public/``, runs a simulation or changes a figure.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import html
import io
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CONTRACT = REPO / "src" / "utils" / "publication" / "contract.json"
MANIFEST_SCHEMA = "uk-budget-dashboard/publication-manifest/v1"

# The dashboard's choices, mirrored (src/utils/publication/manifest.js,
# displayYears.js, chartTheme.js, ageImpact.js).
DISPLAYABLE = ("approved", "provisional")
PROVISIONAL_LABEL = "Provisional: statement figures, awaiting Treasury costing"
CANDIDATE_PROVISIONAL_LABEL = (
    "Provisional: candidate measures modelled before the Budget, not announced policy"
)


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def is_candidate_manifest(manifest: dict) -> bool:
    """Whether the manifest's entries are pre-Budget candidates, the page's
    rule (src/utils/publication/manifest.js, isCandidateManifest).

    The forecast basis alone cannot say this: the runbook keeps it at
    pre_budget on Budget day unless the forecast is rebased. So: last written
    (updated_at, UTC) before the Budget date the manifest names (budget.date,
    from CURRENT_BUDGET), and not rebased. Without both dates, not a
    candidate: "not announced policy" is said only on evidence.
    """
    forecast = (manifest.get("basis") or {}).get("forecast") or {}
    if forecast.get("status") == "updated":
        return False
    updated = manifest.get("updated_at")
    budget_date = (manifest.get("budget") or {}).get("date")
    if not isinstance(updated, str) or not isinstance(budget_date, str):
        return False
    if not _ISO_DATE.match(updated) or not _ISO_DATE.match(budget_date):
        return False
    return updated[:10] < budget_date[:10]


DEFAULT_YEAR = 2027
AGE_BANDS = [
    ("0-15", "Under 16"),
    ("16-24", "16 to 24"),
    ("25-34", "25 to 34"),
    ("35-49", "35 to 49"),
    ("50-64", "50 to 64"),
    ("65+", "65 and over"),
]
DECILES = [str(i) for i in range(1, 11)]
REL_DECILES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]
WITHHELD = "withheld"
WITHHELD_NOTE = "Withheld: too few survey households."
NOT_SHOWN_REASONS = {
    "staged": "awaiting review",
    "stale": "superseded by a model or data change; awaiting a new run",
    "withdrawn": "withdrawn",
    "not_computable": "cannot be costed on the certified data",
}


def fy(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def count_words(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else f"{n:,}"


def long_date(text: str) -> str:
    """2026-10-28 or an ISO timestamp → 28 October 2026 (with the time, if any)."""
    try:
        when = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return text or ""
    if len(text) <= 10:
        return f"{when.day} {when:%B %Y}"
    return f"{when.day} {when:%B %Y}, {when:%H:%M} UTC"


def esc(text) -> str:
    return html.escape(str(text), quote=True)



# --- Formats ------------------------------------------------------------
# Each number format is defined once, here; figures.json records which one
# printed a figure and ``check`` recomputes it with the same function, so a
# figure is traced by its value, its source and its rounding.

MINUS = "−"


def _signed(value: float, body: str, plus: bool) -> str:
    if float(re.sub(r"[^0-9.]", "", body) or 0) == 0:
        return body
    if value < 0:
        return MINUS + body
    return ("+" + body) if plus else body


FORMATS = {
    # £ billion, 1 decimal everywhere
    "bn1": lambda v: _signed(v, f"£{abs(v):,.1f}bn", True),  # labels: "−£11.0bn"
    "bn1_num": lambda v: _signed(v, f"{abs(v):,.1f}", True),  # tables (unit in the subtitle): "−11.0"
    "bn1_words": lambda v: f"£{abs(v):,.1f}bn",  # prose, the sign in the verb
    # £ a year per household, to the pound
    "gbp": lambda v: _signed(v, f"£{abs(v):,.0f}", True),
    "gbp_plain": lambda v: f"£{abs(v):,.0f}",
    # % of net income and shares of people, 1 decimal
    "pct1": lambda v: _signed(v, f"{abs(v):.1f}%", True),
    "pct1_plain": lambda v: f"{abs(v):.1f}%",
    "pct1_num": lambda v: f"{abs(v):.1f}",
    # relative changes (Gini, 90/10), 2 decimals
    "pct2": lambda v: _signed(v, f"{abs(v):.2f}%", True),
    # percentage points, 2 decimals
    "pp2": lambda v: _signed(v, f"{abs(v):.2f}", True),  # tables
    "pp2_label": lambda v: _signed(v, f"{abs(v):.2f}pp", True),  # chart labels
    "pp2_words": lambda v: f"{abs(v):.2f}",  # prose: "falls by 0.32 percentage points"
    "count": lambda v: f"{v:,.0f}",
}

TRANSFORMS = {
    "value": lambda xs: xs[0],
    "x100": lambda xs: xs[0] * 100,
    "sum": lambda xs: sum(xs),
    "neg": lambda xs: -xs[0],
}


class Trace:
    """Every printed figure, with where it came from and the exhibit it is in."""

    def __init__(self, data: Path):
        self.data = data
        self.items: list[dict] = []
        self.exhibit = None

    def fig(self, value, fmt, file, column, where, transform="value", section="", of=None):
        text = FORMATS[fmt](value)
        item = {
            "section": section,
            "exhibit": self.exhibit,
            "text": text,
            "value": value,
            "format": fmt,
            "file": str(file.relative_to(self.data)) if isinstance(file, Path) else file,
            "column": column,
            "where": where,
            "transform": transform,
        }
        if of is not None:
            item["of"] = of
        self.items.append(item)
        return text

# --- Reading the publication --------------------------------------------


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Entry:
    def __init__(self, data: Path, key: str, entry: dict, combined: bool):
        self.key = key
        self.entry = entry
        self.combined = combined
        self.status = entry["status"]
        self.name = entry.get("name") or key
        self.description = entry.get("description", "")
        self.dir = data / entry["artifact"] if entry.get("artifact") else None
        self.years = [y for y in entry.get("years", []) if y not in entry.get("unsupported_years", [])]
        self.unsupported = list(entry.get("unsupported_years", []))
        self.receipt = None
        self._tables = {}
        if self.dir is None:
            raise SystemExit(f"{key}: the manifest names no artifact")
        if not (self.dir / "receipt.json").exists():
            raise SystemExit(f"{key}: no receipt.json in {self.dir}, so its files cannot be checked")
        self.receipt = json.loads((self.dir / "receipt.json").read_text())
        self._verify_files()

    def _verify_files(self):
        """Each table must be the file the receipt names, byte for byte."""
        files = (self.receipt.get("dashboard") or {}).get("files") or {}
        for name, digest in files.items():
            path = self.dir / name
            if not path.exists():
                raise SystemExit(f"{self.key}: {name} is named in its receipt but missing ({path})")
            if sha256(path) != digest:
                raise SystemExit(f"{self.key}: {name} differs from its receipt ({path})")

    def path(self, table: str) -> Path:
        return self.dir / f"{table}.csv"

    def table(self, table: str) -> list[dict]:
        if table not in self._tables:
            path = self.path(table)
            rows = read_csv(path) if path.exists() else []
            self._tables[table] = [r for r in rows if r.get("reform_id") == self.key]
        return self._tables[table]

    def row(self, table: str, **match):
        for r in self.table(table):
            if all(str(r.get(k)) == str(v) for k, v in match.items()):
                return r
        return None


class Publication:
    def __init__(self, data: Path):
        self.data = data
        self.manifest_path = data / "manifest.json"
        if not self.manifest_path.exists():
            raise SystemExit(
                f"No manifest.json in {data}. Build from a publication: a checkout whose public/data "
                "holds manifest.json and artifacts/ (e.g. the Budget-day release branch), via --data."
            )
        self.manifest = json.loads(self.manifest_path.read_text())
        if self.manifest.get("schema") != MANIFEST_SCHEMA:
            raise SystemExit(f"Not a publication manifest: {self.manifest.get('schema')!r}")
        m = self.manifest
        self.measures = {
            k: Entry(data, k, e, False) for k, e in sorted(m["measures"].items()) if e["status"] in DISPLAYABLE
        }
        if not self.measures:
            raise SystemExit("The manifest has no approved or provisional measure: nothing to report")
        self.not_shown = [
            (k, e) for k, e in sorted(m["measures"].items()) if e["status"] not in DISPLAYABLE
        ]
        self.combined = self._combined()
        self.provisional = any(e.status == "provisional" for e in self.measures.values()) or (
            self.combined is not None and self.combined.status == "provisional"
        )
        self.candidate = is_candidate_manifest(m)
        self.provisional_label = CANDIDATE_PROVISIONAL_LABEL if self.candidate else PROVISIONAL_LABEL

    def _combined(self):
        ids = set(self.measures)
        if len(ids) == 1:
            return next(iter(self.measures.values()))
        for key in sorted(self.manifest.get("combined", {})):
            e = self.manifest["combined"][key]
            if e["status"] not in DISPLAYABLE or set(e.get("measures", [])) != ids:
                continue
            current = all(
                (e.get("member_outputs_sha256") or {}).get(i) == self.manifest["measures"][i].get("outputs_sha256")
                for i in ids
            )
            if current:
                return Entry(self.data, key, e, True)
        return None

    def flat(self, name: str):
        """A published flat file the manifest names (e.g. constituency.csv), checked."""
        digest = (self.manifest.get("flat_files") or {}).get(name)
        path = self.data / name
        if not digest or not path.exists():
            return None
        if sha256(path) != digest:
            raise SystemExit(f"{name} differs from the manifest's digest")
        return path


# --- Charts -------------------------------------------------------------


# --- Chart style --------------------------------------------------------
# The dashboard's tokens (src/utils/chartTheme.js CHART_COLOURS and
# POLICY_RAMPS; test_build_report.py parses the JS and checks they match).

CHART_COLOURS = {
    "gain": "#319795",
    "gainText": "#0F766E",
    "loss": "#D97706",
    "lossText": "#B45309",
    "noChange": "#9CA3AF",
    "highlight": "#285E61",
    "rowBand": "#F9FAFB",
    "net": "#000000",
    "zeroLine": "#374151",
    "grid": "#E5E7EB",
    "axis": "#D1D5DB",
    "tick": "#6B7280",
    "axisTitle": "#4B5563",
    "text": "#374151",
    "surface": "#FFFFFF",
    "hatchLine": "#B8BDC5",
    "gainLight": "#81E6D9",
    "mapGain": "#14B8A6",
    "ink": "#1F2937",
    "noticeBg": "#FFF7E6",
    "noticeText": "#7A5A1F",
}
POLICY_RAMPS = {
    "raise": ["#78350F", "#92400E", "#B45309", "#D97706", "#F59E0B", "#FBBF24"],
    "cost": ["#0D9488", "#14B8A6", "#2DD4BF", "#5EEAD4"],
}
MEASURE_RAMPS = {
    "cost": {"stops": POLICY_RAMPS["cost"], "hue": 25, "chroma": 1},
    "revenue": {"stops": POLICY_RAMPS["raise"], "hue": -8, "chroma": 0.6},
    "alternateAbove": 8,
    "neutral": CHART_COLOURS["noChange"],
}

GAIN, LOSS = CHART_COLOURS["gain"], CHART_COLOURS["loss"]
INK, TEXT, MUTED = CHART_COLOURS["ink"], CHART_COLOURS["text"], CHART_COLOURS["axisTitle"]
TICK, GRID, AXIS = CHART_COLOURS["tick"], CHART_COLOURS["grid"], CHART_COLOURS["axis"]
NO_CHANGE_FILL, NO_CHANGE_LINE = CHART_COLOURS["grid"], CHART_COLOURS["noChange"]
NET, HIGHLIGHT, ZERO = CHART_COLOURS["net"], CHART_COLOURS["highlight"], CHART_COLOURS["zeroLine"]
DARK_TEAL = CHART_COLOURS["gainText"]
# Figure 5's change categories: the loss ramp, no change, then the gain ramp
SPREAD_COLOURS = ["#B45309", "#D97706", "#E5E7EB", "#81E6D9", "#14B8A6", "#0F766E"]

MM = 1 / 25.4
CHART_W_MM = 166.0
COL_W = CHART_W_MM * MM  # the text block, A4 less 22mm margins, in inches (6.54)

PE_STYLE = {
    "svg.fonttype": "none",
    "font.family": "sans-serif",
    "font.sans-serif": ["Inter", "DejaVu Sans"],
    "font.size": 8,
    "text.color": TEXT,
    "axes.edgecolor": AXIS,
    "axes.linewidth": 0.6,
    "axes.labelcolor": MUTED,
    "axes.labelsize": 8,
    "axes.titlesize": 8,
    "axes.titlecolor": INK,
    "axes.titlelocation": "left",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.spines.left": False,
    "axes.unicode_minus": True,
    "axes.facecolor": "#FFFFFF",
    "figure.facecolor": "#FFFFFF",
    "xtick.color": TICK,
    "ytick.color": TICK,
    "xtick.labelcolor": TICK,
    "ytick.labelcolor": TICK,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "ytick.major.size": 0,
    "xtick.major.size": 0,
    "xtick.major.pad": 3,
    "ytick.major.pad": 3,
    "legend.fontsize": 8,
    "legend.labelcolor": TEXT,
    "legend.frameon": False,
    "hatch.linewidth": 0.4,
}


def setup_matplotlib():
    import matplotlib

    matplotlib.use("svg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(PE_STYLE)
    return plt


def svg_of(plt, fig) -> str:
    buffer = io.StringIO()
    # Drawn at the text width with constrained layout and not cropped, so
    # stretching to the column keeps text at its set size; opaque white, so
    # the faint watermark never shows through a chart.
    fig.savefig(buffer, format="svg", facecolor="#FFFFFF")
    plt.close(fig)
    text = buffer.getvalue()
    text = text[text.index("<svg"):]
    text = re.sub(r"font-family:[^;\"']*", "font-family: Inter, sans-serif", text)
    text = re.sub(r'font-family="[^"]*"', 'font-family="Inter, sans-serif"', text)
    text = re.sub(r'(<svg[^>]*?) width="[^"]*" height="[^"]*"', r'\1 width="100%" aria-hidden="true"', text, count=1)
    return text


def png_of(plt, fig, dpi=220) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=dpi, facecolor="#FFFFFF")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# measureRamp (chartTheme.js), ported: sRGB <-> OKLab, Björn Ottosson's matrices.
def _to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _from_linear(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _cbrt(x):
    return x ** (1 / 3) if x >= 0 else -((-x) ** (1 / 3))


def hex_to_oklab(h):
    r, g, b = (_to_linear(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l = _cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)  # noqa: E741
    m = _cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = _cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]


def _oklab_to_linear(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3  # noqa: E741
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]


def _oklab_to_hex(lab):
    L, a, b = lab
    for _ in range(60):
        if all(-1e-4 <= v <= 1 + 1e-4 for v in _oklab_to_linear([L, a, b])):
            break
        a *= 0.95
        b *= 0.95
    rgb = [_from_linear(min(1, max(0, v))) * 255 for v in _oklab_to_linear([L, a, b])]
    return "#" + "".join(f"{_js_round(v):02x}" for v in rgb).upper()


def measure_ramp(direction, n):
    """chartTheme.js measureRamp: n colours for one direction, largest first."""
    import math

    ramp = MEASURE_RAMPS.get(direction)
    if not isinstance(ramp, dict):
        return [MEASURE_RAMPS["neutral"]] * n
    stops = ramp["stops"]
    if n <= len(stops):
        return [s.upper() for s in stops[:n]]
    labs = [hex_to_oklab(s) for s in stops]
    lengths = [math.dist(labs[i + 1], labs[i]) for i in range(len(labs) - 1)]
    total = sum(lengths)
    alternate = n > MEASURE_RAMPS["alternateAbove"]
    out = []
    for i in range(n):
        along = 0 if n == 1 else (i / (n - 1)) * total
        k = 0
        while k < len(lengths) - 1 and along > lengths[k]:
            along -= lengths[k]
            k += 1
        f = min(1, along / lengths[k]) if lengths[k] else 0
        L, a, b = (v + (labs[k + 1][j] - v) * f for j, v in enumerate(labs[k]))
        if alternate and i % 2 == 1:
            chroma = math.hypot(a, b) * ramp["chroma"]
            hue = math.atan2(b, a) + ramp["hue"] * math.pi / 180
            a, b = chroma * math.cos(hue), chroma * math.sin(hue)
        out.append(_oklab_to_hex([L, a, b]))
    return out


def label_bars(ax, bars, labels, values, horizontal=False, size=8, colour=None):
    for bar, text, v in zip(bars, labels, values):
        if horizontal:
            ax.annotate(text, (bar.get_width(), bar.get_y() + bar.get_height() / 2), xytext=(3 if v >= 0 else -3, 0),
                        textcoords="offset points", ha="left" if v >= 0 else "right", va="center", fontsize=size, color=colour or TEXT)
        else:
            ax.annotate(text, (bar.get_x() + bar.get_width() / 2, bar.get_height()), xytext=(0, 2.5 if v >= 0 else -2.5),
                        textcoords="offset points", ha="center", va="bottom" if v >= 0 else "top", fontsize=size, color=colour or TEXT)


def pad_limits(values, lo_pad=0.15, hi_pad=0.15):
    lo, hi = min([0.0, *values]), max([0.0, *values])
    span = (hi - lo) or 1.0
    return lo - (span * lo_pad if lo < 0 else 0), hi + (span * hi_pad if hi > 0 else 0)


def unit_ticks(ax, unit, axis="y", decimals=0, signed=True):
    """Tick labels that carry their unit: "£200", "−£200", "+0.5%", "£2.0bn"."""
    from matplotlib.ticker import FuncFormatter

    def fmt(t, _):
        if abs(t) < 1e-12:
            return {"gbp": "£0", "bn": "£0", "pct": "0%", "pp": "0"}[unit]
        body = f"{abs(t):,.{decimals}f}"
        body = {"gbp": f"£{body}", "bn": f"£{body}bn", "pct": f"{body}%", "pp": body}[unit]
        return (MINUS if t < 0 else ("+" if signed and unit in ("pct", "pp") else "")) + body

    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(FuncFormatter(fmt))


def base_axes(ax, grid="y", zero=True):
    """PE_STYLE axes: gridlines on one axis behind the data, zero line, no bottom spine with it."""
    ax.grid(axis=grid, color=GRID, linewidth=0.5)
    ax.set_axisbelow(True)
    if zero:
        (ax.axhline if grid == "y" else ax.axvline)(0, color=ZERO, linewidth=0.8, zorder=2)
        ax.spines["bottom"].set_visible(False)
    else:
        ax.spines["bottom"].set_color(AXIS)
        ax.spines["bottom"].set_linewidth(0.6)


def top_legend(ax, items, ncol=None):
    """A legend row above the plot, left-aligned, 8pt square swatches. items:
    (label, colour, kind) with kind "box" or "dot"."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    handles = []
    for label, colour, kind in items:
        if kind == "dot":
            handles.append(Line2D([], [], marker="o", linestyle="", markersize=5, markerfacecolor=colour, markeredgecolor="#FFFFFF", markeredgewidth=1, label=label))
        elif kind == "hatch":
            handles.append(Patch(facecolor=CHART_COLOURS["rowBand"], edgecolor=CHART_COLOURS["hatchLine"], hatch="//////", linewidth=0, label=label))
        else:
            handles.append(Patch(facecolor=colour, edgecolor="none", label=label))
    if ncol is None:
        longest = max((len(t) for t, _, _ in items), default=0)
        ncol = len(items) if sum(len(t) for t, _, _ in items) < 90 else (3 if longest < 30 else 2)
    return ax.legend(handles=handles, loc="lower left", bbox_to_anchor=(0, 1.01), ncol=ncol, frameon=False,
                     handlelength=1.0, handleheight=1.0, handletextpad=0.5, columnspacing=1.6, borderaxespad=0.2, borderpad=0, alignment="left")


def net_dots(ax, xs, ys, labels=None, fmt=None):
    """The combined run's value: a black dot with a white 1pt edge, optionally labelled."""
    ax.scatter(xs, ys, s=30, color=NET, edgecolors="#FFFFFF", linewidths=1, zorder=5)
    if labels:
        for x, y, t in zip(xs, ys, labels):
            ax.annotate(t, (x, y), xytext=(6, 0), textcoords="offset points", ha="left", va="center", fontsize=8, color=INK, zorder=6,
                        bbox={"boxstyle": "round,pad=0.15", "fc": "#FFFFFF", "ec": "none", "alpha": 0.9})


def stack(ax, xs, series, width=0.7, horizontal=False):
    """Stacked bars, positive values up from zero and negative down, white 0.4pt
    separators. series: list of (values, colour); None values are skipped."""
    import numpy as np

    pos = np.zeros(len(xs))
    neg = np.zeros(len(xs))
    for values, colour in series:
        v = np.array([0.0 if x is None else x for x in values])
        base = np.where(v >= 0, pos, neg)
        if horizontal:
            ax.barh(xs, v, left=base, height=width, color=colour, edgecolor="#FFFFFF", linewidth=0.4, zorder=3)
        else:
            ax.bar(xs, v, bottom=base, width=width, color=colour, edgecolor="#FFFFFF", linewidth=0.4, zorder=3)
        pos = pos + np.where(v > 0, v, 0)
        neg = neg + np.where(v < 0, v, 0)
    return pos, neg


def decile_axis(ax, xs, all_x=None):
    labels = ["1\nBottom"] + [str(i) for i in range(2, 10)] + ["10\nTop"]
    ticks = list(xs)
    if all_x is not None:
        ticks.append(all_x)
        labels.append("All")
    ax.set_xticks(ticks, labels)
    if all_x is not None:
        ax.get_xticklabels()[-1].set_fontweight("bold")
        ax.get_xticklabels()[-1].set_color(TEXT)


def contrast_text(hex_colour):
    """White or ink on a fill, whichever has the better contrast."""
    def lum(h):
        r, g, b = (_to_linear(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    bg = lum(hex_colour)
    white = 1.05 / (bg + 0.05)
    ink = (bg + 0.05) / (lum(INK) + 0.05)
    return "#FFFFFF" if white >= ink else INK

# The dashboard map's colour scale, ported from src/utils/geography/scale.js
# (scaleColour): loss #D97706 through the grid grey #E5E7EB at no change to
# mapGain #14B8A6, each half interpolated in RGB, in 100 steps, on a fixed
# domain clamped at its ends (relative_change: -1% to +1%).
MAP_SCALE = {"loss": "#D97706", "neutral": "#E5E7EB", "gain": "#14B8A6"}
MAP_EXTENT = {"relative_change": 0.01, "average_change": 100}
MAP_STEPS = 100
MAP_HATCH_LINE, MAP_HATCH_BG = "#B8BDC5", "#F9FAFB"  # withheld seat
MAP_DOTS = "#1F2937"  # approximate seat
MAP_NO_ROW_FILL, MAP_NO_ROW_EDGE = "#FFFFFF", "#9CA3AF"  # an area with no row


def _hex_rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def _js_round(x):
    import math

    return int(math.floor(x + 0.5))


def _interp_rgb(a, b, t):
    """d3.interpolateRgb (gamma 1), then d3.color(...).formatHex()."""
    ca, cb = _hex_rgb(a), _hex_rgb(b)
    return "#" + "".join(f"{max(0, min(255, _js_round(x + (y - x) * t))):02x}" for x, y in zip(ca, cb))


def scale_colour(value, extent=MAP_EXTENT["relative_change"]):
    """scale.js scaleColour: a value's colour, as #rrggbb, from -extent to +extent."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return MAP_SCALE["neutral"]
    if number != number or abs(number) == float("inf") or not extent > 0:
        return MAP_SCALE["neutral"]
    t = max(-1.0, min(1.0, number / extent))
    step = _js_round(abs(t) * MAP_STEPS) / MAP_STEPS
    if step == 0:
        return MAP_SCALE["neutral"]
    if t < 0:
        return _interp_rgb(MAP_SCALE["loss"], MAP_SCALE["neutral"], 1 - step)
    return _interp_rgb(MAP_SCALE["neutral"], MAP_SCALE["gain"], step)


def draw_seat_map(ax, geo, seats, extent=MAP_EXTENT["relative_change"]):
    """One constituency map on the dashboard's scale. ``seats`` maps a seat's
    code to its row: a withheld seat is hatched, an approximate one keeps its
    colour under dots, a seat with no row is white with a grey outline."""
    import matplotlib as mpl
    from matplotlib.collections import PatchCollection
    from matplotlib.patches import Polygon as MplPolygon

    groups = {"value": ([], []), "approx": ([], []), "withheld": ([], []), "none": ([], [])}
    for feature in geo["features"]:
        code = feature["properties"]["GSScode"]
        g = feature["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
        r = seats.get(code)
        if r is None:
            kind, face = "none", MAP_NO_ROW_FILL
        elif r.get("value", "") == "" or r.get("tier") == "withheld":
            kind, face = "withheld", MAP_HATCH_BG
        else:
            kind = "approx" if r.get("tier") == "approximate" else "value"
            face = scale_colour(float(r["value"]), extent)
        for ring in rings:
            groups[kind][0].append(MplPolygon(ring[::3] if len(ring) > 60 else ring, closed=True))
            groups[kind][1].append(face)
    with mpl.rc_context({"hatch.linewidth": 0.35}):
        ps, fs = groups["value"]
        ax.add_collection(PatchCollection(ps, facecolor=fs, edgecolor="#FFFFFF", linewidth=0.05))
        ps, fs = groups["approx"]
        ax.add_collection(PatchCollection(ps, facecolor=fs, edgecolor=MAP_DOTS, linewidth=0, hatch=".."))
        ps, fs = groups["withheld"]
        ax.add_collection(PatchCollection(ps, facecolor=fs, edgecolor=MAP_HATCH_LINE, linewidth=0, hatch="//////"))
        ps, fs = groups["none"]
        ax.add_collection(PatchCollection(ps, facecolor=fs, edgecolor=MAP_NO_ROW_EDGE, linewidth=0.15))
    ax.autoscale_view()
    # One published ring has a stray vertex near the origin; keep the frame on Great Britain and Northern Ireland
    x0, x1 = ax.get_xlim()
    ax.set_xlim(max(x0, 0), x1)
    ax.set_aspect("equal")
    ax.axis("off")


def map_gradient(n=201, extent=MAP_EXTENT["relative_change"]):
    """The scale as a list of colours from -extent to +extent, for the key."""
    return [scale_colour(-extent + 2 * extent * i / (n - 1), extent) for i in range(n)]


def curve_spikes(values, factor=5.0, floor=250.0):
    """Isolated points on a curve, as (index, departure): a point departs from
    the mean of its two neighbours by more than ``factor`` times the curve's
    median absolute step and by more than ``floor`` (£), and lies above both
    neighbours or below both (a step edge departs from one only)."""
    if len(values) < 3:
        return []
    steps = sorted(abs(b - a) for a, b in zip(values, values[1:]))
    median = steps[len(steps) // 2] if len(steps) % 2 else (steps[len(steps) // 2 - 1] + steps[len(steps) // 2]) / 2
    out = []
    for i in range(1, len(values) - 1):
        a, v, b = values[i - 1], values[i], values[i + 1]
        dep = v - (a + b) / 2
        if abs(dep) > factor * median and abs(dep) > floor and (v - a) * (v - b) > 0:
            out.append((i, dep))
    return out


ZERO_PP = 0.005  # below this a percentage-point change prints as 0.00pp
ZERO_BN = 0.005  # below this a £bn change prints as £0.00bn


def year_span(years: list[int]) -> str:
    if len(years) == 1:
        return f"in {fy(years[0])}"
    return f"from {fy(years[0])} to {fy(years[-1])}"


def sign_runs(years, values, tol):
    """Consecutive years grouped by the sign of the value (0 within tol)."""
    runs = []
    for y, v in zip(years, values):
        s = 0 if abs(v) < tol else (1 if v > 0 else -1)
        if runs and runs[-1][0] == s:
            runs[-1][1].append(y)
        else:
            runs.append((s, [y]))
    return runs



def decile_shape(values):
    """The shape of ten decile values: ("rising"|"falling"|"peaked"|"troughed"|"mixed", k).

    rising: non-decreasing, allowing one dip of under 10% of the range;
    falling: the mirror; peaked at decile k: an interior maximum with both
    ends at least 25% of the range below it; troughed: the mirror; anything
    else (or any withheld value) is mixed. k is 1-based, for peaked/troughed.
    """
    if not values or any(v is None for v in values):
        return "mixed", None
    lo, hi = min(values), max(values)
    span = hi - lo
    if span <= 0:
        return "mixed", None

    def monotone(vs):
        dips = [b - a for a, b in zip(vs, vs[1:]) if b < a]
        return len(dips) <= 1 and all(-d < 0.1 * span for d in dips) and vs[-1] > vs[0]

    if monotone(values):
        return "rising", None
    if monotone([-v for v in values]):
        return "falling", None
    k = max(range(len(values)), key=lambda i: values[i])
    if 0 < k < len(values) - 1 and values[k] - values[0] >= 0.25 * span and values[k] - values[-1] >= 0.25 * span:
        return "peaked", k + 1
    k = min(range(len(values)), key=lambda i: values[i])
    if 0 < k < len(values) - 1 and values[0] - values[k] >= 0.25 * span and values[-1] - values[k] >= 0.25 * span:
        return "troughed", k + 1
    return "mixed", None


DECILE_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]


def shape_phrase(values):
    """The classified shape in words, never a comparison of the two ends."""
    kind, k = decile_shape(values)
    if kind == "rising":
        return "rises from the bottom decile to the top decile"
    if kind == "falling":
        return "falls from the bottom decile to the top decile"
    if kind == "peaked":
        return f"is highest in the {DECILE_WORDS[k - 1]} decile"
    if kind == "troughed":
        return f"is lowest in the {DECILE_WORDS[k - 1]} decile"
    return ""


def css_string(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'




# --- The report ---------------------------------------------------------
#
# The layout follows fiscal-event briefings: a cover; key findings with the
# headline chart; contents and a "how to read" box; short numbered sections
# with numbered paragraphs that flow from page to page; numbered exhibits
# titled with what they show (generated from the data, in neutral words) over
# a units subtitle, with notes and a short source line; then annexes for the
# method, the measures as modelled, data tables, and sources and glossary.

FIG5_EDGES = [(-1e12, -100.0), (-100.0, -1.0), (-1.0, 1.0), (1.0, 100.0), (100.0, 500.0), (500.0, 1e12)]
FIG5_LABELS = ["Lose more than £100", "Lose £1 to £100", "No change (within £1)", "Gain £1 to £100", "Gain £100 to £500", "Gain more than £500"]
BETTER_OFF, UNCHANGED_FILL, WORSE_OFF = "#319795", "#E5E7EB", "#D97706"
STATUS_SENTENCE = re.compile(r"^\s*(?:candidate|provisional|approved|announced|proposed)(?: measure)?\.\s*", re.I)
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def strip_status(text: str) -> str:
    """A manifest description without a leading sentence that only states its status."""
    return STATUS_SENTENCE.sub("", text or "", count=1).strip()


def first_sentence(text: str) -> str:
    text = strip_status(text)
    return SENTENCE_SPLIT.split(text, maxsplit=1)[0] if text else ""


def budget_name(manifest: dict) -> str:
    """'uk-autumn-budget-2026' → 'Autumn Budget 2026'."""
    bid = (manifest.get("budget") or {}).get("id") or ""
    words = [w for w in bid.split("-") if w and w.lower() != "uk"]
    return " ".join(w[:1].upper() + w[1:] for w in words) if words else "Budget"


class Report:
    def __init__(self, pub: Publication, year: int, title: str | None = None):
        self.pub = pub
        self.year = year
        self.budget = budget_name(pub.manifest)
        self.custom_title = " ".join(title.split()) if title else None
        self.title = self.custom_title or f"{self.budget}: effects on households and the public finances"
        self.t = Trace(pub.data)
        self.plt = setup_matplotlib()
        self.contract = json.loads(CONTRACT.read_text()) if CONTRACT.exists() else {}
        c = pub.combined
        if c is not None and year not in c.years:
            raise SystemExit(f"The combined run has no supported figures for {fy(year)}")
        self.years = sorted(
            set(c.years) if c is not None else set().union(*(set(e.years) for e in pub.measures.values()))
        )
        self.order, self.colour = self._catalogue()
        # One measure: its own run stands for "the measures together" (as the
        # dashboard's combinedEntryFor does), and the "each measure on its
        # own" blocks are left out, since they would repeat its figures.
        self.single = c is not None and not c.combined
        self.plural = not self.single
        self.together = f"The {c.name} measure" if self.single else "The measures together"
        self.n_fig = self.n_tab = 0
        self.annex_tabs = defaultdict(int)
        self.notes: list[tuple[int, str]] = []
        self.n_fn = 0
        self.curve_review = None
        self.kf_said = set()

    # ---- measures: the dashboard's catalogue order and colours
    def _catalogue(self):
        """measureCatalogue.jsx: direction from the sum over the published
        years, size the sum of absolute values; raise revenue first, then
        cost, each largest first; each direction's ramp, largest darkest."""
        info = {}
        for k, e in self.pub.measures.items():
            rows = [r for r in e.table("budgetary_impact") if int(r["year"]) in e.years and r.get("value", "") != ""]
            impact = sum(float(r["value"]) for r in rows) if rows else None
            size = sum(abs(float(r["value"])) for r in rows)
            direction = "neutral" if not impact else ("cost" if impact < 0 else "revenue")
            info[k] = (direction, size)
        order, colours = [], {}
        for direction in ("revenue", "cost", "neutral"):
            group = sorted((k for k in info if info[k][0] == direction), key=lambda k: (-info[k][1], k))
            for k, col in zip(group, measure_ramp(direction, len(group))):
                colours[k] = col
            order += group
        return order, colours

    def name(self, key):
        return self.pub.measures[key].name

    def the(self, key):
        """A measure's name inside a sentence: 'the {name} measure'."""
        return f"the {esc(self.name(key))} measure"

    def verb(self, plural_form, singular_form):
        return plural_form if self.plural else singular_form

    @staticmethod
    def _names(names):
        names = list(names)
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]

    def the_list(self, keys):
        keys = list(keys)
        if len(keys) == 1:
            return self.the(keys[0])
        return "the " + self._names(esc(self.name(k)) for k in keys) + " measures"

    def swatch(self, key):
        return f'<span class="sw" style="--sw:{self.colour.get(key, NO_CHANGE_LINE)}" aria-hidden="true"></span>'

    # ---- traced figures
    def budget_v(self, e: Entry, year: int, fmt: str, section: str):
        r = e.row("budgetary_impact", year=year)
        if r is None or year not in e.years or r.get("value", "") == "":
            return None, "n/a"
        v = float(r["value"])
        return v, self.t.fig(v, fmt, e.path("budgetary_impact"), "value", {"reform_id": e.key, "year": year}, section=section)

    def raw(self, e, table, column, **match):
        r = e.row(table, **match) if e is not None else None
        if r is None or r.get(column, "") == "":
            return None
        return float(r[column])

    def cell(self, e, table, column, match, fmt, section, transform="value"):
        r = e.row(table, **match)
        if r is None or r.get(column, "") == "":
            return None, WITHHELD
        v = TRANSFORMS[transform]([float(r[column])])
        return v, self.t.fig(v, fmt, e.path(table), column, {"reform_id": e.key, **match}, transform, section)

    # ---- page furniture
    def next_label(self, kind, annex=None):
        if annex:
            self.annex_tabs[annex] += 1
            label = f"Table {annex}{self.annex_tabs[annex]}"
        elif kind == "figure":
            self.n_fig += 1
            label = f"Figure {self.n_fig}"
        else:
            self.n_tab += 1
            label = f"Table {self.n_tab}"
        self.t.exhibit = label
        return label

    def source(self, run):
        if run is None:
            return ""
        if self.single:
            phrase = {"contract": "example households as defined on the dashboard"}.get(run, "the measure's own run")
        else:
            phrase = {
                "together": "measures together",
                "each": "each measure on its own",
                "both": "measures together and each measure on its own",
                "contract": "measures together; example households as defined on the dashboard",
            }[run]
        return f'<p class="exhibit__source"><b>Source:</b> PolicyEngine; {phrase}.</p>'

    def exhibit(self, label, title, subtitle, body, notes="", run="together", cls="", aria=""):
        """One block: label, title, subtitle, the chart or table, notes and source."""
        self.t.exhibit = None
        eid = label.lower().replace(" ", "-")
        note = f'<p class="exhibit__notes"><b>Notes:</b> {notes}</p>' if notes else ""
        sub = f'<p class="exhibit__subtitle">{esc(subtitle)}</p>' if subtitle else ""
        return (
            f'<div class="exhibit {cls}" id="{eid}" role="group" aria-label="{esc(label)}: {esc(title)}{(". " + esc(aria)) if aria else ""}">'
            f'<p class="exhibit__label">{esc(label)}</p><p class="exhibit__title">{esc(title)}</p>{sub}'
            f'<div class="exhibit__body">{body}</div>{note}{self.source(run)}</div>'
        )

    def chart(self, svg):
        return f'<div class="chart">{svg}</div>'

    def tbl(self, head, rows, cls=""):
        return f'<table class="{cls}"><thead>{head}</thead><tbody>{"".join(rows)}</tbody></table>'

    def p(self, text):
        """A numbered paragraph in the current section (2.1, A.1, …)."""
        if not text:
            return ""
        self._pn += 1
        return f'<p class="para" data-n="{self._plabel}.{self._pn}">{text}</p>'

    def fn(self, text):
        self.n_fn += 1
        self.notes.append((self.n_fn, text))
        return f'<sup class="fn"><a href="#fn{self.n_fn}">{self.n_fn}</a></sup>'

    def begin(self, label):
        self._plabel, self._pn = label, 0

    def section(self, sid, num, title, blocks, cls="sec", break_before=False):
        blocks = [b for b in blocks if b]
        head = f'<h1 id="h-{sid}"><span class="h1-num">{esc(num)}</span> {esc(title)}</h1>'
        # The heading keeps with its first block, and with the next one too
        # when the first is only a paragraph, so a heading never ends a page.
        n_keep = 2 if len(blocks) > 1 and blocks[0].startswith('<p class="para"') else 1
        if blocks and 'class="exhibit breakable"' in blocks[0][:80]:
            n_keep = 0  # a long table may break: the heading keeps with its rows (break-after: avoid)
        first = "".join(blocks[:n_keep])
        blocks = [""] + blocks[n_keep:]
        notes = ""
        if self.notes:
            items = "".join(f'<li id="fn{n}" value="{n}">{t}</li>' for n, t in self.notes)
            notes = f'<ol class="footnotes" aria-label="Notes">{items}</ol>'
            self.notes = []
        brk = " break-before" if break_before else ""
        self._toc.append((sid, num, title, cls == "annex"))
        return f'<section class="{cls}{brk}" id="{sid}"><div class="keep">{head}{first}</div>{"".join(blocks[1:])}{notes}</section>'

    def notice(self, text):
        return f'<div class="notice" role="note"><p>{text}</p></div>'

    def no_combined(self):
        return self.notice("No combined run is published for exactly these measures, so figures for the measures together are left out rather than added up from each measure on its own.")

    @staticmethod
    def _span(ys):
        if len(ys) == 1 or all(b - a == 1 for a, b in zip(ys, ys[1:])):
            return year_span(ys)
        return "in " + ", ".join(fy(v) for v in ys[:-1]) + " and " + fy(ys[-1])

    def logo_img(self, cls="logo"):
        path = REPO / "public" / "assets" / "logos" / "policyengine-teal.png"
        if path.exists():
            data = base64.b64encode(path.read_bytes()).decode()
            return f'<img class="{cls}" src="data:image/png;base64,{data}" alt="PolicyEngine">'
        return '<p class="logo-text">PolicyEngine</p>'

    # ---- cover
    def cover(self):
        m = self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        model = ident.get("model") or {}
        dataset = (ident.get("data") or {}).get("dataset", "")
        band = f'<div class="cover__band" role="note">{esc(self.pub.provisional_label)}</div>' if self.pub.provisional else ""
        if self.custom_title:
            title = f'<h1 class="cover__title"><span class="cover__strong">{esc(self.title)}</span></h1>'
        else:
            title = (
                f'<h1 class="cover__title"><span class="cover__light">{esc(self.budget)}:</span> '
                '<span class="cover__strong">effects on households and the public finances</span></h1>'
            )
        budget_date = long_date((m.get("budget") or {}).get("date", ""))
        published = long_date((m.get("updated_at") or "")[:10])
        meta = []
        if model:
            meta.append(f"Model: {esc(model.get('name', 'policyengine-uk'))} {esc(model.get('version', ''))}")
        if dataset:
            meta.append(f"Data: {esc(dataset)}")
        meta.append("policyengine.org")
        return f"""
<section class="cover" aria-label="Cover">
  {band}
  <div class="cover__logo">{self.logo_img("cover__logo-img")}</div>
  <div class="cover__main">
    {title}
    <p class="cover__subtitle">PolicyEngine analysis of the measures in the Budget of {esc(budget_date).replace(" ", "&nbsp;")}</p>
    <div class="cover__rule"></div>
    <p class="cover__date">Published {esc(published)}. Figures are for {fy(self.year)} unless stated.</p>
  </div>
  <div class="cover__meta">{"".join(f"<p>{x}</p>" for x in meta)}</div>
</section>"""

    # ---- key findings
    def key_findings(self):
        c, y, S = self.pub.combined, self.year, "summary"
        items = []
        fig1 = ""
        if c is None:
            body = self.no_combined()
        else:
            years = self.years
            T = self.together
            they = self.verb("they", "it")
            rev = self.raw(c, "budgetary_impact", "value", year=y)
            if rev is not None:
                txt = self.t.fig(rev, "bn1_words", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": y}, section=S)
                if abs(rev) < 0.05:
                    lead = f"{T} {self.verb('leave', 'leaves')} revenue unchanged in {fy(y)}"
                else:
                    lead = f"{T} {self.verb('cost', 'costs') if rev < 0 else self.verb('raise', 'raises')} {txt} in {fy(y)}"
                support = ""
                if self.plural:
                    best = max(
                        (k for k in self.order if self.raw(self.pub.measures[k], "budgetary_impact", "value", year=y) is not None),
                        key=lambda k: abs(self.raw(self.pub.measures[k], "budgetary_impact", "value", year=y)),
                        default=None,
                    )
                    if best is not None:
                        support = f"The largest single effect comes from {self.the(best)}."
                        self.kf_said.add(("largest", y))
                items.append((lead, support))
            vals = [(yy, self.raw(c, "budgetary_impact", "value", year=yy)) for yy in years]
            if len(years) > 1 and all(v is not None for _, v in vals):
                total = sum(v for _, v in vals)
                tt = self.t.fig(total, "bn1_words", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": years}, "sum", S)
                lead = f"Over {fy(years[0])} to {fy(years[-1])} {they} {('cost' if total < 0 else 'raise') + ('' if self.plural else 's')} {tt} in total"
                runs = sign_runs(years, [v for _, v in vals], 0.05)
                support = ""
                if len(runs) > 1:
                    s, ys = runs[1]
                    word = {1: "raises revenue", -1: "costs revenue", 0: "leaves revenue unchanged"}[s]
                    support = f"The annual effect changes sign in {fy(ys[0])}, when the package {word}."
                    self.kf_said.add("revenue-sign")
                items.append((lead, support))
            hh, _ = None, None
            hh = self.raw(c, "winners_losers", "avg_change", year=y, decile="all")
            if hh is not None:
                ht = self.t.fig(hh, "gbp_plain", c.path("winners_losers"), "avg_change", {"reform_id": c.key, "year": y, "decile": "all"}, section=S)
                if abs(hh) < 0.5:
                    lead = "Household net income is unchanged on average"
                else:
                    lead = f"Household net income {'rises' if hh > 0 else 'falls'} by {ht} a year on average"
                deciles = [self.raw(c, "winners_losers", "avg_change", year=y, decile=d) for d in DECILES]
                phrase = shape_phrase(deciles)
                support = f"By income decile, the average change in pounds {phrase}." if phrase else ""
                if phrase:
                    self.kf_said.add("decile-shape")
                items.append((lead, support))
            b = self.raw(c, "age_impact", "pct_better_off", year=y, age_band="all")
            w = self.raw(c, "age_impact", "pct_worse_off", year=y, age_band="all")
            if b is not None and w is not None:
                bt = self.t.fig(b, "pct1_plain", c.path("age_impact"), "pct_better_off", {"reform_id": c.key, "year": y, "age_band": "all"}, section=S)
                wt = self.t.fig(w, "pct1_plain", c.path("age_impact"), "pct_worse_off", {"reform_id": c.key, "year": y, "age_band": "all"}, section=S)
                items.append((f"{bt} of people are better off and {wt} worse off", "People are counted by the household they live in (section 4)."))
            p = self.raw(c, "poverty_inequality", "poverty_abs_bhc_change_pp", year=y)
            k = self.raw(c, "poverty_inequality", "child_poverty_abs_bhc_change_pp", year=y)
            if p is not None:
                pt = self.t.fig(p, "pp2_words", c.path("poverty_inequality"), "poverty_abs_bhc_change_pp", {"reform_id": c.key, "year": y}, section=S)
                if abs(p) < ZERO_PP:
                    lead = "Absolute poverty before housing costs is unchanged to two decimal places"
                else:
                    lead = f"Absolute poverty before housing costs {'falls' if p < 0 else 'rises'} by {pt} percentage points"
                if k is not None:
                    kt = self.t.fig(k, "pp2_words", c.path("poverty_inequality"), "child_poverty_abs_bhc_change_pp", {"reform_id": c.key, "year": y}, section=S)
                    if abs(k) < ZERO_PP:
                        lead += ", and child poverty is unchanged"
                    elif abs(p) >= ZERO_PP and (k < 0) == (p < 0):
                        lead += f", and child poverty by {kt}"
                    else:
                        lead += f", and child poverty {'falls' if k < 0 else 'rises'} by {kt}"
                items.append((lead, ""))
            later = self._later_years(c, hh, S)
            if later:
                items.append(later)
            lis = "".join(
                f'<li class="kf__item"><span class="kf__num" aria-hidden="true">{i}</span><p><b>{lead}.</b>{(" " + sup) if sup else ""}</p></li>'
                for i, (lead, sup) in enumerate(items, 1)
            )
            body = f'<ol class="kf">{lis}</ol>'
            fig1 = self.figure1()
        return f'<section id="summary" class="summary">{self._h1_plain("summary", "Key findings")}{body}{fig1}</section>'

    def _h1_plain(self, sid, title):
        return f'<h1 id="h-{sid}" class="page-title">{esc(title)}</h1>'

    def _later_years(self, c, hh, S):
        """README: the last year, when its average household change differs in
        sign from the report year's, with the measure that takes effect."""
        last = self.years[-1]
        if last == self.year or hh is None:
            return None
        hl = self.raw(c, "winners_losers", "avg_change", year=last, decile="all")
        if hl is None or abs(hl) < 0.5 or (abs(hh) >= 0.5 and (hl > 0) == (hh > 0)):
            return None
        ht = self.t.fig(hl, "gbp_plain", c.path("winners_losers"), "avg_change", {"reform_id": c.key, "year": last, "decile": "all"}, section=S)
        lead = f"By {fy(last)} the average household change turns to a {'gain' if hl > 0 else 'loss'} of {ht}"
        support = ""
        if self.plural:
            best = None
            for k in self.order:
                e = self.pub.measures[k]
                v = self.raw(e, "winners_losers", "avg_change", year=last, decile="all")
                v0 = self.raw(e, "winners_losers", "avg_change", year=self.year, decile="all")
                if v is None:
                    continue
                new = v0 is None or abs(v0) < 0.5
                if (v > 0) == (hl > 0) and abs(v) >= 0.5 and new and (best is None or abs(v) > best[0]):
                    best = (abs(v), k)
            if best is not None:
                support = f"This is when {self.the(best[1])} takes effect."
        self.kf_said.add("later-years")
        return lead, support

    def figure1(self):
        """% of net income by decile, the measures together."""
        c, y, S = self.pub.combined, self.year, "summary"
        label = self.next_label("figure")
        vals, labs = [], []
        for d, rd in zip(DECILES, REL_DECILES):
            v, t = self.cell(c, "distributional_impact", "value", {"year": y, "decile": rd}, "pct1", S)
            vals.append(v)
            labs.append(t)
        plt = self.plt
        fig, ax = plt.subplots(figsize=(COL_W, 70 * MM), layout="constrained")
        xs = list(range(10))
        shown = [0.0 if v is None else v for v in vals]
        bars = ax.bar(xs, shown, width=0.7, color=[GAIN if v > 0 else LOSS for v in shown], zorder=3)
        label_bars(ax, bars, labs, shown)
        for x, v in zip(xs, vals):
            if v is None:
                ax.annotate(WITHHELD, (x, 0), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=7, color=TICK)
        ax.set_ylim(*pad_limits([v for v in vals if v is not None] or [0.0]))
        decile_axis(ax, xs)
        unit_ticks(ax, "pct", decimals=1)
        base_axes(ax)
        ax.set_ylabel("% of net income")
        title = self._rank_title(vals, "As a share of net income, the gain", "As a share of net income, the loss")
        return self.exhibit(label, title, f"Change in household net income by income decile, % of net income, measures together, UK, {fy(y)}",
                            self.chart(svg_of(plt, fig)), self._withheld_note(vals) + " The average across all households is given in pounds in finding 3; no all-household figure in % of net income is published.", aria="; ".join(f"decile {d}: {t}" for d, t in zip(DECILES, labs)))

    @staticmethod
    def _withheld_note(vals):
        return WITHHELD_NOTE if any(v is None for v in vals) else ""

    def _rank_title(self, vals, gain_lead, loss_lead):
        """A title from the decile shape, or the rank of the largest and smallest decile."""
        known = [(i, v) for i, v in enumerate(vals) if v is not None]
        if not known:
            return "No published figures by decile"
        phrase = shape_phrase(vals)
        allg = all(v > 0 for _, v in known)
        alll = all(v < 0 for _, v in known)
        lead = gain_lead if allg else loss_lead if alll else gain_lead.replace("the gain", "the change")
        if phrase:
            return f"{lead} {phrase}"
        hi = max(known, key=lambda iv: abs(iv[1]) if (allg or alll) else iv[1])[0]
        lo = min(known, key=lambda iv: abs(iv[1]) if (allg or alll) else iv[1])[0]
        return f"{lead} is largest in the {self._decile_name(hi + 1)} and smallest in the {self._decile_name(lo + 1)}"

    @staticmethod
    def _decile_name(i):
        return {1: "bottom decile", 10: "top decile"}.get(i, f"{DECILE_WORDS[i - 1]} decile")

    # ---- contents and Box 1
    def contents(self):
        def row(sid, num, title):
            return (
                f'<li><a href="#{sid}"><span class="toc__num">{esc(num)}</span><span class="toc__title">{esc(title)}</span>'
                f'<span class="toc__leader"></span><span class="toc__page" data-toc="{sid}"></span></a></li>'
            )

        main = [row("summary", "", "Key findings")] + [row(s, n, t) for s, n, t, a in self._toc if not a]
        annex = [row(s, n.replace("Annex ", ""), t) for s, n, t, a in self._toc if a]
        box = self.box1()
        return (
            f'<section id="contents" class="contents break-before">{self._h1_plain("contents", "Contents")}'
            f'<ol class="toc">{"".join(main)}</ol><p class="toc__sub">Annexes</p><ol class="toc">{"".join(annex)}</ol>{box}</section>'
        )

    def box(self, n, title, body):
        return f'<aside class="box" aria-label="Box {n}: {esc(title)}"><p class="exhibit__label">Box {n}</p><p class="box__title">{esc(title)}</p>{body}</aside>'

    def box1(self):
        items = []
        if self.plural:
            items.append(
                "<b>Each measure on its own, and the measures together.</b> Each measure is simulated on its own against the pre-Budget baseline, "
                "and all of them in one combined run. Figures for the measures together come only from the combined run; they can differ from "
                "the sum of the measures on their own, because measures interact (one can change the income another taxes)."
            )
        items += [
            "<b>Static costings.</b> People are assumed not to change what they earn, spend, save or claim in response to the measures.",
            "<b>Colours.</b> Teal is a gain to households, or a cost to revenue; amber is a loss to households, or revenue raised; grey is no change; hatching marks a withheld figure.",
            "<b>Income deciles.</b> Households are ranked into ten equal groups by equivalised household net income before the measures; the first decile is the bottom tenth.",
            "<b>Withheld.</b> A figure resting on too few survey households is withheld: it is never shown as zero, plotted or ranked.",
            "<b>Dashboard.</b> The interactive version, with a calculator for a household's own circumstances, is at policyengine.org/uk/autumn-budget-2026.",
        ]
        return self.box(1, "How to read this report", "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>")

    # ---- 1 The measures
    def measures(self, num):
        self.begin(num)
        y = self.year
        n = len(self.order)
        intro = self.p(
            "PolicyEngine is an open-source microsimulation model of the UK tax and benefit system. It applies the rules of each tax and benefit "
            "to a representative survey of UK households, weighted to official totals, and reports the change for the government and for households. "
            f"This report compares {'each of the ' + count_words(n) + ' measures' if n != 1 else 'the measure'} in Table 1 with the pre-Budget baseline, current law, "
            f"from {fy(self.years[0])} to {fy(self.years[-1])}. The code and data behind every figure are public."
        )
        label = self.next_label("table")
        rows = []
        for k in self.order:
            e = self.pub.measures[k]
            v, t = self.budget_v(e, y, "bn1_num", "measures")
            ys = [yy for yy in self.years if yy in e.years]
            span = f"{fy(ys[0])} to {fy(ys[-1])}" if len(ys) > 1 else (fy(ys[0]) if ys else "none")
            extra = f' <span class="muted">No figures for {", ".join(fy(u) for u in e.unsupported)}.</span>' if e.unsupported else ""
            rows.append(
                f'<tr><th scope="row">{self.swatch(k)}{esc(e.name)}</th><td>{esc(first_sentence(e.description))}{extra}</td>'
                f'<td class="nowrap">{span}</td><td class="num">{t}</td></tr>'
            )
        head = (
            '<tr><th scope="col" class="w-measure">Measure</th><th scope="col">What changes</th>'
            f'<th scope="col" class="w-years">Years modelled</th><th scope="col" class="num w-rev">Effect on revenue in {fy(y)}, £bn</th></tr>'
        )
        t1 = self.exhibit(label, "The measures at a glance", f"In the order used throughout: measures that raise revenue first, then those that cost it, each by size. £ billion, UK, {fy(y)}",
                          self.tbl(head, rows, "measures"), "A negative figure is a cost to revenue. Annex B gives each measure in full.", run="each")
        left = ""
        if self.pub.not_shown:
            items = []
            for key, e in self.pub.not_shown:
                reason = NOT_SHOWN_REASONS.get(e["status"], e["status"].replace("_", " "))
                when = re.search(r"\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b", e.get("reason") or "")
                if when and e["status"] == "withdrawn":
                    reason += f" on {when.group(1)}"
                items.append(f"<li><b>{esc(e.get('name') or key)}</b>: {esc(reason)}</li>")
            left = f'<div class="keep"><h2>Modelled but not shown</h2><ul class="plain">{"".join(items)}</ul></div>'
        return self.section("measures", num, "The measures", [intro, t1, left], break_before=True)

    # ---- 2 Public finances
    def revenue(self, num):
        self.begin(num)
        c, S = self.pub.combined, "revenue"
        plt = self.plt
        blocks = []
        label = self.next_label("figure")
        years = self.years
        fig, ax = plt.subplots(figsize=(COL_W, 70 * MM), layout="constrained")
        xs = list(range(len(years)))
        keys = [k for k in self.order if any(abs(self.raw(self.pub.measures[k], "budgetary_impact", "value", year=yy) or 0) > 0 for yy in years if yy in self.pub.measures[k].years)]
        series = []
        for k in keys:
            e = self.pub.measures[k]
            series.append(([self.raw(e, "budgetary_impact", "value", year=yy) if yy in e.years else None for yy in years], self.colour[k]))
        pos, neg = stack(ax, xs, series)
        lims = list(pos) + list(neg)
        legend = [(self.name(k), self.colour[k], "box") for k in keys]
        if c is not None and self.plural:
            cv, ct, cx = [], [], []
            for x, yy in zip(xs, years):
                v, t = self.budget_v(c, yy, "bn1", S)
                if v is not None:
                    cv.append(v)
                    ct.append(t)
                    cx.append(x)
            net_dots(ax, cx, cv, ct)
            lims += cv
            legend.append(("Measures together", NET, "dot"))
        elif self.single:
            for x, yy in zip(xs, years):
                v, t = self.budget_v(c, yy, "bn1", S)
                if v is not None:
                    ax.annotate(t, (x, v), xytext=(0, 3 if v >= 0 else -3), textcoords="offset points", ha="center", va="bottom" if v >= 0 else "top", fontsize=8, color=INK)
        ax.set_ylim(*pad_limits(lims, 0.12, 0.12))
        ax.set_xlim(-0.6, len(years) - 0.2)
        ax.set_xticks(xs, [fy(yy) for yy in years])
        unit_ticks(ax, "bn", decimals=1)
        base_axes(ax)
        top_legend(ax, legend)
        if c is not None:
            vals = [self.raw(c, "budgetary_impact", "value", year=yy) for yy in years]
            runs = sign_runs([yy for yy, v in zip(years, vals) if v is not None], [v for v in vals if v is not None], 0.05)
            parts = []
            for s, ys in runs:
                word = {1: "raise revenue", -1: "cost revenue", 0: "leave revenue unchanged"}[s]
                parts.append(f"{word} {'in every year ' + year_span(ys) if len(runs) == 1 and len(ys) > 1 else self._span(ys)}")
            who = "The measures together" if self.plural else f"The {self.name(c.key)} measure"
            if not self.plural:
                parts = [p.replace("raise ", "raises ").replace("cost ", "costs ").replace("leave ", "leaves ") for p in parts]
            title = f"{who} " + (", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0])
        else:
            title = "Change in government revenue by measure and year"
        note = ("Bars show each measure on its own; the dot shows the measures together, which can differ from the sum of the bars. " if self.plural and c is not None else "")
        idle = [k for k in self.order if k not in keys]
        if idle:
            note += f"No effect on revenue in any year: {esc(self._names(self.name(k) for k in idle))}. "
        note += "A negative figure is a cost to revenue."
        blocks.append(self.exhibit(label, title, f"Change in government revenue by measure, £ billion a year, UK, {fy(years[0])} to {fy(years[-1])}",
                                   self.chart(svg_of(plt, fig)), note, run="both" if c is not None and self.plural else "each"))
        if c is None:
            blocks.insert(0, self.no_combined())
        if self.plural:
            blocks.append(self.p(self._revenue_reading(keys)))
        return self.section("revenue", num, "Public finances", blocks)

    def _revenue_reading(self, keys):
        """Which measure has the largest effect in which years, and which act only outside the report year."""
        tops = []
        for yy in self.years:
            vals = [(abs(v), k) for k in keys if (v := self.raw(self.pub.measures[k], "budgetary_impact", "value", year=yy)) is not None and yy in self.pub.measures[k].years]
            if vals:
                tops.append((yy, max(vals)[1]))
        out = []
        runs = []
        for yy, k in tops:
            if runs and runs[-1][0] == k:
                runs[-1][1].append(yy)
            else:
                runs.append((k, [yy]))
        if runs:
            main = max(runs, key=lambda r: len(r[1]))
            others = [r for r in runs if r is not main]
            s = f"The largest effect of any single measure comes from {self.the(main[0])} {self._span(main[1])}"
            if len(main[1]) > 1 and len(runs) == 1:
                s = f"The largest effect of any single measure comes from {self.the(main[0])} in every year"
            if others:
                s += "; " + "; ".join(f"{self._span(ys)} it comes from {self.the(k)}" for k, ys in others)
            out.append(s + ".")
        only = []
        for k in self.order:
            e = self.pub.measures[k]
            ys = [yy for yy in self.years if yy in e.years and abs(self.raw(e, "budgetary_impact", "value", year=yy) or 0) >= 0.05]
            if ys and self.year not in ys:
                only.append((k, ys))
        if only:
            out.append(
                f"{count_words(len(only)).capitalize()} measure{'s' if len(only) != 1 else ''} {'do' if len(only) != 1 else 'does'} not change revenue in {fy(self.year)} at the precision of Table 1, "
                f"but {'do' if len(only) != 1 else 'does'} in other years: " + "; ".join(f"{self.the(k)}, {self._span(ys)}" for k, ys in only) + "."
            )
        return " ".join(out)

    # ---- 3 Households by income
    def deciles(self, num):
        self.begin(num)
        c, S = self.pub.combined, "deciles"
        plt = self.plt
        blocks = []
        if c is None:
            blocks.append(self.no_combined())
        else:
            # Figure 3: average change by year
            label = self.next_label("figure")
            vals, labs = [], []
            for yy in self.years:
                v, t = self.cell(c, "winners_losers", "avg_change", {"year": yy, "decile": "all"}, "gbp", S)
                vals.append(v)
                labs.append(t)
            fig, ax = plt.subplots(figsize=(COL_W, 56 * MM), layout="constrained")
            xs = list(range(len(self.years)))
            shown = [0.0 if v is None else v for v in vals]
            bars = ax.bar(xs, shown, width=0.6, color=[GAIN if v >= 0 else LOSS for v in shown], zorder=3)
            label_bars(ax, bars, labs, shown)
            ax.set_xticks(xs, [fy(yy) for yy in self.years])
            ax.set_ylim(*pad_limits([v for v in vals if v is not None] or [0.0]))
            unit_ticks(ax, "gbp")
            base_axes(ax)
            known = [(yy, v) for yy, v in zip(self.years, vals) if v is not None]
            runs = sign_runs([yy for yy, _ in known], [v for _, v in known], 0.5)
            if len(runs) == 1:
                s, ys = runs[0]
                word = {1: "rises", -1: "falls", 0: "is unchanged"}[s]
                title = f"Household net income {word} on average in every year {year_span(ys)}" if len(ys) > 1 else f"Household net income {word} on average {year_span(ys)}"
            else:
                word = {1: "rises", -1: "falls", 0: "is unchanged"}
                parts = [f"{word[s]} {self._span(ys)}" for s, ys in runs]
                title = "Household net income " + ", ".join(parts[:-1]) + " and " + parts[-1] + " on average"
            blocks.append(self.exhibit(label, title, f"Average change in household net income, measures together, £ a year per household, UK, {fy(self.years[0])} to {fy(self.years[-1])}",
                                       self.chart(svg_of(plt, fig)), self._withheld_note(vals), aria="; ".join(f"{fy(yy)}: {t}" for yy, t in zip(self.years, labs))))
            blocks.append(self.figure4())
            blocks.append(self.figure5())
            blocks.append(self.p(self._spread_reading()))
        return self.section("deciles", num, "Households by income", blocks)

    def figure4(self):
        """£ a year by decile, stacked by measure, with the combined dot and an All group."""
        c, y = self.pub.combined, self.year
        plt = self.plt
        label = self.next_label("figure")
        groups = DECILES + ["all"]
        xs = list(range(10)) + [11]
        fig, ax = plt.subplots(figsize=(COL_W, 66 * MM), layout="constrained")
        series, keys = [], []
        if self.plural:
            for k in self.order:
                e = self.pub.measures[k]
                vs = [self.raw(e, "winners_losers", "avg_change", year=y, decile=d) for d in groups]
                if any(v is not None and abs(v) >= 0.5 for v in vs):
                    keys.append(k)
                    series.append((vs, self.colour[k]))
        pos, neg = stack(ax, xs, series)
        cvals = []
        for x, d in zip(xs, groups):
            v = self.raw(c, "winners_losers", "avg_change", year=y, decile=d)
            cvals.append(v)
        if self.plural:
            net_dots(ax, [x for x, v in zip(xs, cvals) if v is not None], [v for v in cvals if v is not None])
        else:
            shown = [0.0 if v is None else v for v in cvals]
            ax.bar(xs, shown, width=0.7, color=[GAIN if v >= 0 else LOSS for v in shown], zorder=3)
        for x, v in zip(xs, cvals):
            if v is None:
                ax.annotate(WITHHELD, (x, 0), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=7, color=TICK)
        ax.set_ylim(*pad_limits(list(pos) + list(neg) + [v for v in cvals if v is not None], 0.08, 0.08))
        decile_axis(ax, xs[:10], 11)
        unit_ticks(ax, "gbp")
        base_axes(ax)
        legend = [(self.name(k), self.colour[k], "box") for k in keys]
        if self.plural:
            legend.append(("Measures together", NET, "dot"))
            top_legend(ax, legend)
        # Title: the measure that changes average income most in every decile, if one does
        tops = []
        for d in DECILES:
            best = None
            for k in keys:
                v = self.raw(self.pub.measures[k], "winners_losers", "avg_change", year=y, decile=d)
                if v is not None and (best is None or abs(v) > best[0]):
                    best = (abs(v), k)
            tops.append(best[1] if best else None)
        if self.plural and tops and None not in tops and len(set(tops)) == 1:
            title = f"The largest part of the change in every decile comes from {self.the(tops[0])}"
            title = title[0].upper() + title[1:]
        else:
            title = "Average change in household net income by income decile"
        n_idle = len(self.order) - len(keys)
        note = ("Bars show each measure on its own; the dot shows the measures together. " if self.plural else "")
        if self.plural and n_idle:
            note += f"Measures that change no decile's average by 50p or more in {fy(y)} are not drawn: {esc(self._names(self.name(k) for k in self.order if k not in keys))}. "
        note += "Values are in Annex Table C2. " + self._withheld_note(cvals)
        return self.exhibit(label, title, f"Average change in household net income by income decile, £ a year per household, UK, {fy(y)}",
                            self.chart(svg_of(plt, fig)), note.strip(), run="both" if self.plural else "together")

    def _fig5_rows(self):
        """household_scatter_binned.csv grouped into the six change categories,
        income bands above the 95th percentile of households merged into one."""
        c, y = self.pub.combined, self.year
        rows = [r for r in c.table("household_scatter_binned") if str(r["year"]) == str(y) and r.get("households", "") != ""]
        if not rows:
            return None
        bands = sorted({r["income_band"] for r in rows}, key=float)
        totals = {b: sum(float(r["households"]) for r in rows if r["income_band"] == b) for b in bands}
        grand = sum(totals.values())
        cum, cut = 0.0, len(bands)
        for i, b in enumerate(bands):
            if cum / grand < 0.95 <= (cum + totals[b]) / grand:
                cut = i
                break
            cum += totals[b]
        groups = [[b] for b in bands[:cut]] + ([bands[cut:]] if cut < len(bands) else [])
        cats = []
        for lo, hi in FIG5_EDGES:
            cats.append(sorted({r["change_band"] for r in rows if float(r["change_band"]) >= lo and float(r["change_band_upper"]) <= hi}, key=float))
        covered = sum(len(x) for x in cats)
        if covered != len({r["change_band"] for r in rows}):
            raise SystemExit("household_scatter_binned.csv has change bands that straddle Figure 5's category edges")
        return rows, groups, cats

    def figure5(self):
        c, y, S = self.pub.combined, self.year, "deciles"
        got = self._fig5_rows()
        if got is None:
            return ""
        rows, groups, cats = got
        plt = self.plt
        label = self.next_label("figure")
        path = c.path("household_scatter_binned")
        shares = []
        labels = []
        for g in groups:
            lo = float(g[0])
            labels.append(f"£{lo:,.0f} and over" if len(g) > 1 else f"£{lo:,.0f} to £{lo + 5000:,.0f}" if lo > 0 else "Under £5,000")
            den = sum(float(r["households"]) for r in rows if r["income_band"] in g)
            row = []
            for cat in cats:
                num = sum(float(r["households"]) for r in rows if r["income_band"] in g and r["change_band"] in cat)
                v = 100 * num / den
                self.t.fig(v, "pct1_num", path, "households", {"reform_id": c.key, "year": y, "income_band": g, "change_band": cat}, "share", S,
                           of={"reform_id": c.key, "year": y, "income_band": g})
                row.append(v)
            shares.append(row)
        self._fig5 = (labels, shares)
        n = len(groups)
        fig, ax = plt.subplots(figsize=(COL_W, (n * 3.7 + 20) * MM), layout="constrained")
        ys = list(range(n))[::-1]
        left = [0.0] * n
        for j, col in enumerate(SPREAD_COLOURS):
            vals = [shares[i][j] for i in range(n)]
            ax.barh(ys, vals, left=left, height=0.74, color=col, edgecolor="#FFFFFF", linewidth=0.4, zorder=3)
            left = [a + b for a, b in zip(left, vals)]
        ax.set_yticks(ys, labels)
        ax.set_xlim(0, 100)
        ax.set_ylim(-0.6, n - 0.4)
        unit_ticks(ax, "pct", axis="x", signed=False)
        ax.xaxis.set_ticks([0, 25, 50, 75, 100])
        base_axes(ax, grid="x", zero=False)
        ax.spines["bottom"].set_visible(False)
        top_legend(ax, [(lab, col, "box") for lab, col in zip(FIG5_LABELS, SPREAD_COLOURS)], ncol=3)
        if all(sum(r[3:]) > 50 for r in shares):
            title = "Most households gain in every income band"
        else:
            title = "The share of households that gain differs across income bands"
        return self.exhibit(label, title, f"Households by change in net income, within bands of household income before the measures, measures together, % of households, UK, {fy(y)}",
                            self.chart(svg_of(plt, fig)),
                            "Income bands are £5,000 wide; bands above the 95th percentile of households are merged into the top band. Shares are of the households in published cells: cells with too few survey households are not published. The change categories are fixed edges of the published change bands, not results.")

    def _spread_reading(self):
        if not getattr(self, "_fig5", None):
            return ""
        labels, shares = self._fig5
        loss = [sum(r[:2]) for r in shares]
        big = [r[5] for r in shares]
        i = max(range(len(loss)), key=lambda i: loss[i])
        j = max(range(len(big)), key=lambda i: big[i])
        lab = lambda s: s[0].lower() + s[1:] if s.startswith("Under") else s  # noqa: E731
        return (
            f"Losses are most common among households with net incomes of {lab(labels[i])}, "
            f"and gains of more than £500 among those with {lab(labels[j])}."
        )

    # ---- 4 Gainers and losers, by age
    def people(self, num):
        self.begin(num)
        c, y, S = self.pub.combined, self.year, "people"
        plt = self.plt
        blocks = [self.p(
            "A person counts as better off when their household's net income rises by more than 0.01% (£3 a year on £30,000), worse off when it falls by more than that, "
            "and unchanged otherwise. People are counted by the household they live in, so everyone in a household shares its change."
        )]
        label = self.next_label("figure")
        rows = []  # (label, entry, band, bold)
        if c is not None:
            rows.append(("All people", c, "all", True))
            rows += [(lab, c, band, False) for band, lab in AGE_BANDS]
        own = []
        if self.plural:
            own = [(self.name(k), self.pub.measures[k], "all", False) for k in self.order]
        data = []
        for lab, e, band, bold in rows + own:
            b, bt = self.cell(e, "age_impact", "pct_better_off", {"year": y, "age_band": band}, "pct1_num", S)
            u, ut = self.cell(e, "age_impact", "pct_unchanged", {"year": y, "age_band": band}, "pct1_num", S)
            w, wt = self.cell(e, "age_impact", "pct_worse_off", {"year": y, "age_band": band}, "pct1_num", S)
            data.append((lab, None if None in (b, u, w) else (b, u, w), bold))
        n_main, n_own = len(rows), len(own)
        gap = 1.4 if own and rows else 0
        ypos = []
        yy = 0.0
        for i in range(n_main + n_own):
            if i == n_main and own:
                yy += gap
            ypos.append(-yy)
            yy += 1
        fig, ax = plt.subplots(figsize=(COL_W, (len(ypos) * 5.2 + gap * 5 + 18) * MM), layout="constrained")
        for (lab, vals, bold), ypo in zip(data, ypos):
            if vals is None:
                ax.barh([ypo], [100], height=0.68, color=CHART_COLOURS["rowBand"], edgecolor=CHART_COLOURS["hatchLine"], hatch="//////", linewidth=0, zorder=3)
                ax.text(50, ypo, WITHHELD, ha="center", va="center", fontsize=8, color=TICK, zorder=4)
                continue
            left = 0.0
            for v, col in zip(vals, (BETTER_OFF, UNCHANGED_FILL, WORSE_OFF)):
                ax.barh([ypo], [v], left=left, height=0.68, color=col, edgecolor="#FFFFFF", linewidth=0.4, zorder=3)
                if v >= 8:
                    ax.text(left + v / 2, ypo, f"{v:.1f}%", ha="center", va="center", fontsize=8, color=contrast_text(col), zorder=4)
                left += v
        ax.set_yticks(ypos, [d[0] for d in data])
        for tick, (_, _, bold) in zip(ax.get_yticklabels(), data):
            if bold:
                tick.set_fontweight("bold")
                tick.set_color(TEXT)
        if own and rows:
            ax.text(-0.01, -(n_main + gap / 2) + 0.15, "Each measure on its own", transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=8, color=MUTED, fontstyle="italic")
        ax.set_xlim(0, 100)
        ax.set_ylim(min(ypos) - 0.6, 0.6)
        ax.xaxis.set_ticks([])
        for s in ax.spines.values():
            s.set_visible(False)
        top_legend(ax, [("Better off", BETTER_OFF, "box"), ("Unchanged", UNCHANGED_FILL, "box"), ("Worse off", WORSE_OFF, "box")])
        # title: rank by age of the share worse off
        title = "People better off, unchanged and worse off"
        main = [(lab, v) for (lab, v, _), _r in zip(data[:n_main], rows) if v is not None]
        if main:
            allp = main[0][1]
            bands = main[1:]
            lead = "Most people are better off" if allp[0] > 50 else ("Most people are worse off" if allp[2] > 50 else "More people are better off than worse off" if allp[0] > allp[2] else "More people are worse off than better off")
            if bands:
                worst = max(bands, key=lambda lv: lv[1][2])
                title = f"{lead}; the share worse off is largest among people aged {worst[0].lower()}" if worst[0][0].isdigit() else f"{lead}; the share worse off is largest among people {worst[0].lower()}"
            else:
                title = lead
        withheld = any(v is None for _, v, _ in data)
        note = "Shares of 8% or more are labelled. " + (WITHHELD_NOTE + " A row with any share withheld is withheld whole." if withheld else "")
        blocks.append(self.exhibit(label, title, f"% of people, {'measures together by age, then each measure on its own, ' if self.plural else ''}UK, {fy(y)}",
                                   self.chart(svg_of(plt, fig)), note.strip(), run="both" if self.plural else "together"))
        # Figure 7: average £ change by age band
        if c is not None:
            label = self.next_label("figure")
            mv, ml = [], []
            for band, lab in AGE_BANDS:
                v, t = self.cell(c, "age_impact", "mean_change", {"year": y, "age_band": band}, "gbp", S)
                mv.append(v)
                ml.append(t)
            fig, ax = plt.subplots(figsize=(COL_W, 58 * MM), layout="constrained")
            labels = [lab for _, lab in AGE_BANDS]
            xs = list(range(len(labels)))
            shown = [0.0 if v is None else v for v in mv]
            bars = ax.bar(xs, shown, width=0.6, color=[GAIN if v >= 0 else LOSS for v in shown], zorder=3)
            label_bars(ax, bars, ml, shown)
            ax.set_xticks(xs, labels)
            ax.set_ylim(*pad_limits([v for v in mv if v is not None] or [0.0]))
            unit_ticks(ax, "gbp")
            base_axes(ax)
            known = [(lab, v) for lab, v in zip(labels, mv) if v is not None]
            if known:
                hi = max(known, key=lambda lv: lv[1])
                lo = min(known, key=lambda lv: lv[1])
                aged = lambda s: f"people aged {s.lower()}" if s[0].isdigit() else f"people {s.lower()}"  # noqa: E731
                if all(v > 0 for _, v in known):
                    title = f"The average gain is largest for {aged(hi[0])} and smallest for {aged(lo[0])}"
                elif all(v < 0 for _, v in known):
                    title = f"The average loss is largest for {aged(lo[0])} and smallest for {aged(hi[0])}"
                else:
                    title = f"The average change is highest for {aged(hi[0])} and lowest for {aged(lo[0])}"
            else:
                title = "No published figures by age"
            blocks.append(self.exhibit(label, title, f"Average change in the net income of people's households, by age, measures together, £ a year, UK, {fy(y)}",
                                       self.chart(svg_of(plt, fig)), ("Each person is given their whole household's change. " + self._withheld_note(mv)).strip()))
        if self.plural:
            reach = [(v[0], lab) for lab, v, _ in data[n_main:] if v is not None]
            if reach:
                b, lab = max(reach)
                key = next(k for k in self.order if self.name(k) == lab)
                none_ = [k for k, (lab2, v, _) in zip(self.order, data[n_main:]) if v is not None and v[0] < 0.05 and v[2] < 0.05]
                s = f"Of the measures on their own, {self.the(key)} makes the most people better off."
                if none_:
                    s += f" Fewer than 0.05% of people are better or worse off under {self.the_list(none_)} in {fy(y)}."
                blocks.append(self.p(s))
        return self.section("people", num, "Gainers and losers, by age", blocks)

    # ---- 5 Poverty and inequality
    def poverty(self, num):
        self.begin(num)
        c, y, S = self.pub.combined, self.year, "poverty"
        plt = self.plt
        blocks = [self.p("Definitions are in the glossary (Annex D).")]
        if c is None:
            blocks.append(self.no_combined())
            return self.section("poverty", num, "Poverty and inequality", blocks)
        label = self.next_label("figure")
        a_v, a_l, k_v, k_l = [], [], [], []
        for yy in self.years:
            v, t = self.cell(c, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": yy}, "pp2_label", S)
            a_v.append(v)
            a_l.append(t)
            v, t = self.cell(c, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": yy}, "pp2_label", S)
            k_v.append(v)
            k_l.append(t)
        fig, ax = plt.subplots(figsize=(COL_W, 68 * MM), layout="constrained")
        xs = list(range(len(self.years)))
        w = 0.36
        for off, vals, labs, col in ((-w / 2, a_v, a_l, GAIN), (w / 2, k_v, k_l, DARK_TEAL)):
            shown = [0.0 if v is None else v for v in vals]
            bars = ax.bar([x + off for x in xs], shown, width=w, color=col, zorder=3)
            label_bars(ax, bars, [lab.replace("pp", "") for lab in labs], shown)
        ax.set_xticks(xs, [fy(yy) for yy in self.years])
        ax.set_ylim(*pad_limits([v for v in a_v + k_v if v is not None] or [0.0], 0.18, 0.18))
        unit_ticks(ax, "pp", decimals=2)
        ax.set_ylabel("Change in poverty rate (percentage points)")
        base_axes(ax)
        top_legend(ax, [("All people", GAIN, "box"), ("Children", DARK_TEAL, "box")])
        known = [v for v in a_v if v is not None]
        if known and all(v < -ZERO_PP for v in known) and all(v is None or v < -ZERO_PP for v in k_v):
            title = "Absolute poverty before housing costs falls in every year, for all people and for children"
        elif known and all(abs(v) < ZERO_PP for v in known):
            title = "Absolute poverty before housing costs is unchanged to two decimal places in every year"
        elif known:
            i = max(range(len(a_v)), key=lambda i: abs(a_v[i] or 0))
            title = f"The largest change in absolute poverty before housing costs is in {fy(self.years[i])}, when it {'rises' if a_v[i] > 0 else 'falls'}"
        else:
            title = "Change in absolute poverty before housing costs by year"
        blocks.append(self.exhibit(label, title, f"Change in the share of people in absolute poverty before housing costs, measures together, percentage points, UK, {fy(self.years[0])} to {fy(self.years[-1])}",
                                   self.chart(svg_of(plt, fig)), "Below zero, fewer people are in poverty. Colours mark the group, not the direction. " + self._withheld_note(a_v + k_v)))
        # Table 2
        label = self.next_label("table")
        rows = ['<tr class="group"><th scope="rowgroup" colspan="5">Poverty</th></tr>']
        for key, lab in (("abs_bhc", "Absolute, before housing costs"), ("abs_ahc", "Absolute, after housing costs"), ("rel_bhc", "Relative, before housing costs"), ("rel_ahc", "Relative, after housing costs")):
            cells = []
            for col, fmt in ((f"poverty_{key}_change_pp", "pp2"), (f"poverty_{key}_change_pct", "pct1"), (f"child_poverty_{key}_change_pp", "pp2"), (f"child_poverty_{key}_change_pct", "pct1")):
                _, t = self.cell(c, "poverty_inequality", col, {"year": y}, fmt, S)
                cells.append(f'<td class="num">{t}</td>')
            rows.append(f'<tr><th scope="row">{lab}</th>{"".join(cells)}</tr>')
        rows.append('<tr class="group"><th scope="rowgroup" colspan="5">Inequality</th></tr>')
        _, g = self.cell(c, "metrics", "gini_change", {"year": y}, "pct2", S, "x100")
        _, t10 = self.cell(c, "poverty_inequality", "top_10_share_change_pp", {"year": y}, "pp2", S)
        _, r9 = self.cell(c, "poverty_inequality", "p90_p10_change", {"year": y}, "pct2", S, "x100")
        rows += [
            f'<tr><th scope="row">Gini coefficient</th><td class="num"></td><td class="num">{g}</td><td class="num"></td><td class="num"></td></tr>',
            f'<tr><th scope="row">Share of income held by the top 10%</th><td class="num">{t10}</td><td class="num"></td><td class="num"></td><td class="num"></td></tr>',
            f'<tr><th scope="row">90/10 ratio</th><td class="num"></td><td class="num">{r9}</td><td class="num"></td><td class="num"></td></tr>',
        ]
        head = (
            '<tr><th scope="col" rowspan="2"></th><th scope="colgroup" colspan="2" class="num">All people</th><th scope="colgroup" colspan="2" class="num">Children</th></tr>'
            '<tr><th scope="col" class="num">Change, pp</th><th scope="col" class="num">Change, %</th><th scope="col" class="num">Change, pp</th><th scope="col" class="num">Change, %</th></tr>'
        )
        blocks.append(self.exhibit(label, f"Poverty and inequality in {fy(y)}, measures together" if self.plural else f"Poverty and inequality in {fy(y)}", f"Change from the pre-Budget baseline, UK, {fy(y)}",
                                   self.tbl(head, rows, "poverty"),
                                   "pp: percentage points. %: the change as a share of the baseline value. The top 10% row is the change in the share of all income that the 10% of people with the highest incomes receive."))
        if self.plural:
            best = None
            for k in self.order:
                v = self.raw(self.pub.measures[k], "poverty_inequality", "poverty_abs_bhc_change_pp", year=y)
                if v is not None and (best is None or abs(v) > best[0]):
                    best = (abs(v), k, v)
            if best is not None and best[0] >= ZERO_PP:
                blocks.append(self.p(f"Of the measures on their own, the largest change in absolute poverty before housing costs comes from {self.the(best[1])}, under which it {'falls' if best[2] < 0 else 'rises'}; Annex Table C3 gives each measure."))
        return self.section("poverty", num, "Poverty and inequality", blocks)

    # ---- 6 By constituency
    def areas(self, num):
        con = self.pub.flat("constituency.csv")
        if con is None:
            return ""
        self.begin(num)
        y, plt = self.year, self.plt
        rows = [r for r in read_csv(con) if str(r.get("year")) == str(y) and r.get("outcome") == "relative_change"]
        keys, idle = [], []
        for k in self.order:
            mine = [r for r in rows if r["reform"] == k]
            if not mine:
                continue
            if any(r.get("value", "") != "" and r.get("tier") != "withheld" and float(r["value"]) != 0 for r in mine):
                keys.append(k)
            else:
                idle.append(k)
        if not keys:
            return ""
        label = self.next_label("figure")
        geo_path = REPO / "public" / "data" / "uk_constituencies_2024.geojson"
        if not geo_path.exists():
            geo_path = self.pub.data / "uk_constituencies_2024.geojson"
        geo = json.loads(geo_path.read_text())
        cells = []
        for k in keys:
            fig = plt.figure(figsize=(39 * MM, 66 * MM))
            ax = fig.add_axes([0, 0, 1, 1])
            seats = {r["area_code"]: r for r in rows if r["reform"] == k}
            draw_seat_map(ax, geo, seats)
            cells.append(
                f'<div class="maps__cell"><p class="maps__title">{self.swatch(k)}{esc(self.name(k))}</p>'
                f'<img src="{png_of(plt, fig, dpi=250)}" alt="Map of constituencies: {esc(self.name(k))}"></div>'
            )
        # One shared key: the scale's colours as a gradient, then the three seat kinds
        stops = ", ".join(map_gradient(21))
        key = (
            '<div class="maps__key"><div class="maps__scale"><p>Change in household net income, % of net income</p>'
            f'<div class="maps__bar" style="--grad: linear-gradient(to right, {stops})"></div>'
            f'<div class="maps__ticks"><span>{MINUS}1%</span><span>0%</span><span>+1%</span></div></div>'
            '<div class="maps__kinds">'
            f'<span>{self._kind_svg("hatch")}Withheld</span><span>{self._kind_svg("dots")}Approximate</span><span>{self._kind_svg("none")}No data</span></div></div>'
        )
        body = f'<div class="maps">{"".join(cells)}</div>{key}'
        note = "Results by area are published for each measure on its own; no area figures for the measures together are published yet. Colours follow the dashboard map: a fixed scale from −1% to +1% of net income, the same for every map, with seats beyond either end in its end colour."
        if idle:
            note += f" No seat changes under {self.the_list(idle)} in {fy(y)}, so {'it is' if len(idle) == 1 else 'they are'} not drawn."
        ex = self.exhibit(label, "The change in household net income varies from seat to seat for each measure", f"Average change in household net income by Westminster constituency (2024 boundaries), each measure on its own, % of net income, {fy(y)}",
                          body, note, run="each", cls="wide")
        return self.section("areas", num, "By constituency", [ex])

    @staticmethod
    def _kind_svg(kind):
        """A 3mm key swatch for the maps, drawn with the map's own colours."""
        if kind == "hatch":
            inner = f'<rect width="12" height="12" fill="{MAP_HATCH_BG}"/>' + "".join(
                f'<line x1="{i}" y1="12" x2="{i + 12}" y2="0" stroke="{MAP_HATCH_LINE}" stroke-width="0.9"/>' for i in range(-12, 12, 3))
        elif kind == "dots":
            inner = f'<rect width="12" height="12" fill="{scale_colour(0.005)}"/>' + "".join(
                f'<circle cx="{x}" cy="{y}" r="0.8" fill="{MAP_DOTS}"/>' for x in (3, 9) for y in (3, 9))
        else:
            inner = f'<rect x="0.5" y="0.5" width="11" height="11" fill="{MAP_NO_ROW_FILL}" stroke="{MAP_NO_ROW_EDGE}" stroke-width="1"/>'
        return f'<svg class="k" viewBox="0 0 12 12" aria-hidden="true">{inner}</svg>'

    # ---- 7 Example households
    def households(self, num):
        self.begin(num)
        c, y, S = self.pub.combined, self.year, "households"
        self.curve_review = None
        base = "Each is one household, not an average; real households differ in rent, spending and circumstances."
        if c is None:
            return self.section("households", num, "Example households", [self.p(base), self.no_combined()])
        defs = {h["id"]: h for h in self.contract.get("income_curve_households", [])}
        rows = [r for r in c.table("income_curve") if str(r["year"]) == str(y)]
        ids = [h for h in defs if any(r["household"] == h for r in rows)] or sorted({r["household"] for r in rows})
        if not ids:
            return self.section("households", num, "Example households", [self.p(base), self.notice("No example households are published for this year.")])
        shares = (0.2, 0.4, 0.8)
        table_rows, curves, worst, signs = [], [], None, []
        label = self.next_label("table")
        for h in ids:
            hr = sorted((r for r in rows if r["household"] == h), key=lambda r: float(r["income"]))
            ch = [float(r["reform_net_income"]) - float(r["baseline_net_income"]) for r in hr]
            curves.append((h, hr, ch))
            for j, dep in curve_spikes(ch):
                if worst is None or abs(dep) > worst[0]:
                    worst = (abs(dep), h, hr, j)
            d = defs.get(h, {})
            cells = []
            top = float(d.get("x_max") or max(float(r["income"]) for r in hr))
            for share in shares:
                p = top * share
                r = min(hr, key=lambda r: abs(float(r["income"]) - p))
                if abs(float(r["income"]) - p) > 1:
                    cells.append('<td class="num">n/a</td>')
                    continue
                v = float(r["reform_net_income"]) - float(r["baseline_net_income"])
                signs.append(v)
                text = self.t.fig(v, "gbp", c.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
                cells.append(f'<td class="num">{text}<span class="at">at £{float(r["income"]):,.0f}</span></td>')
            table_rows.append(f'<tr><th scope="row">{esc(d.get("label", h))}<span class="def">{esc(self._definition(d))}</span></th>{"".join(cells)}</tr>')
        if signs and all(v >= 0.5 for v in signs):
            title = "Every example household is better off at each of the three incomes"
        elif signs and all(v <= -0.5 for v in signs):
            title = "Every example household is worse off at each of the three incomes"
        else:
            title = "Change in net income at three incomes"
        head = '<tr><th scope="col">Household</th>' + "".join(f'<th scope="col" class="num">{lab}</th>' for lab in ("Lower income", "Middle income", "Higher income")) + "</tr>"
        blocks = [
            self.p(base),
            self.exhibit(label, title, f"Change in net income, measures together, £ a year, {fy(y)}" if self.plural else f"Change in net income, £ a year, {fy(y)}",
                         self.tbl(head, table_rows, "households"),
                         "Lower, middle and higher income: 20%, 40% and 80% of the top of each household's income range on the dashboard. Households as defined on the dashboard.", run="contract"),
        ]
        if worst is not None:
            _, h, hr, j = worst
            self.curve_review = (h, hr, j, defs.get(h, {}))
        else:
            blocks.append(self._curve_figure(curves, defs))
        return self.section("households", num, "Example households", blocks)

    def _curve_figure(self, curves, defs):
        plt, y = self.plt, self.year
        label = self.next_label("figure")
        cols = 3
        nrows = (len(curves) + 1 + cols - 1) // cols
        fig, axes = plt.subplots(nrows, cols, figsize=(COL_W, 44 * MM * nrows), squeeze=False, layout="constrained")
        for i, (h, hr, ch) in enumerate(curves):
            ax = axes[i // cols][i % cols]
            xs = [float(r["income"]) / 1000 for r in hr]
            ax.plot(xs, ch, color=HIGHLIGHT, linewidth=1.3, zorder=3)
            ax.fill_between(xs, ch, 0, where=[v >= 0 for v in ch], color=GAIN, alpha=0.2, linewidth=0)
            ax.fill_between(xs, ch, 0, where=[v < 0 for v in ch], color=LOSS, alpha=0.3, linewidth=0)
            d = defs.get(h, {})
            ax.set_title(d.get("label", h), fontsize=8, loc="left", color=INK, fontweight="semibold")
            ax.set_xlabel(f"{d.get('x_label', 'Earnings')}, £ thousand", fontsize=8)
            unit_ticks(ax, "gbp")
            base_axes(ax)
        for j in range(len(curves), nrows * cols):
            axes[j // cols][j % cols].axis("off")
        kax = axes[(nrows * cols - 1) // cols][cols - 1]
        from matplotlib.patches import Patch

        kax.legend(handles=[Patch(facecolor=GAIN, alpha=0.4, label="Gain"), Patch(facecolor=LOSS, alpha=0.5, label="Loss")], loc="center left", frameon=False, handlelength=1, handleheight=1)
        return self.exhibit(label, "How the change varies with earnings", f"Change in net income against earnings, measures together, £ a year, {fy(y)}",
                            self.chart(svg_of(plt, fig)), "Each panel has its own vertical scale, so scales differ. Households as defined on the dashboard.", run="contract")

    @staticmethod
    def _definition(d):
        """The household as defined, without what it says about measures the
        dashboard can select. A clause that joins the household's own facts
        to such a measure with ", and " keeps the facts before it."""
        kept = []
        for cl in d.get("definition", "").split("; "):
            if "when selected" not in cl:
                kept.append(cl)
                continue
            head = cl[: cl.index("when selected")]
            if ", and " in head:
                kept.append(head[: head.rindex(", and ")])
        text = "; ".join(kept).strip().rstrip(".")
        return text + "."

    # ---- Annex A
    def method(self):
        self.begin("A")
        m = self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        data = ident.get("data") or {}
        fc = (m.get("basis") or {}).get("forecast") or {}
        versions = ", ".join(f"{ident[k]['name']} {ident[k]['version']}" for k in ("wrapper", "model", "core") if k in ident)
        left = [
            "<b>Behavioural responses.</b> The costings are static (Box 1): they leave out changes in work, spending, saving and claiming, and any wider effects on the economy.",
        ]
        limits = []
        for k in self.order:
            dl = self.pub.measures[k].entry.get("data_limits")
            if dl:
                limits.append(f"{self.the(k)}: {esc('; '.join(dl) if isinstance(dl, list) else str(dl))}")
        if limits:
            left.append("<b>Effects not modelled.</b> " + "; ".join(limits) + ".")
        left.append("<b>Incidence.</b> Each tax falls where the model places it, as each measure's description in Annex B says: for example, the model holds each employer's total cost of employment fixed, so a change in employer National Insurance passes to employees' pay in the same year.")
        if not self.pub.flat("constituency.csv"):
            left.append("<b>Areas.</b> Results by region and constituency are not yet published in this release.")
        else:
            left.append("<b>Areas for the measures together.</b> Results by constituency are published for each measure on its own only.")
        left.append("<b>Outlook for household incomes.</b> The dashboard's projection of household incomes over the coming years rests on a separate forecast that is not part of this publication, so it is not reproduced here.")
        if self.curve_review:
            left.append("<b>Example households.</b> " + self._curve_review_sentence())
        box2 = self.box(2, "What the figures leave out", "<ul>" + "".join(f"<li>{x}</li>" for x in left) + "</ul>")
        forecast = (
            "The economic assumptions are the model's pre-Budget ones; they have not yet been rebased on the Budget's OBR forecast."
            if fc.get("status") == "pre_budget"
            else f"The economic assumptions are {esc(fc.get('source', ''))} ({esc(fc.get('vintage', ''))})."
        )
        dataset = data.get("dataset", "")
        yr = re.search(r"(\d{4})_(\d{2})", dataset or "")
        paras = [
            self.p(f"<b>Model and data.</b> The model is {esc(versions)}, run on the {esc(dataset)} dataset{' of ' + yr.group(1) + '-' + yr.group(2) + ' survey households' if yr else ''} (build {esc(data.get('build_id', ''))}). {forecast}"),
            self.p("<b>Ranking households.</b> Deciles rank households by equivalised household net income before housing costs, under the pre-Budget baseline, each household weighted by the people in it."),
            self.p(f"<b>Runs.</b> {self._runs_sentence()}, for {fy(self.years[0])} to {fy(self.years[-1])}. Every exhibit names its run in its source line: \"measures together\" for the combined run, \"each measure on its own\" for each measure's own run."),
        ]
        paras.append(self.provenance())
        return self.section("method", "Annex A", "Methodology and caveats", [box2] + paras, cls="annex", break_before=True)

    def _runs_sentence(self):
        if self.single:
            return "The measure is simulated against the pre-Budget baseline"
        if self.pub.combined is None:
            return "Each measure is simulated on its own against the pre-Budget baseline; no combined run covers exactly these measures"
        return "Each measure is simulated on its own against the pre-Budget baseline, and all of them together in one combined run"

    def _curve_review_sentence(self):
        c, y, S = self.pub.combined, self.year, "method"
        h, hr, j, d = self.curve_review
        r = hr[j]
        label = d.get("label", h)
        label = label[0].lower() + label[1:]
        what = (d.get("x_label") or "earnings").lower()
        val = float(r["reform_net_income"]) - float(r["baseline_net_income"])
        change = self.t.fig(val, "gbp", c.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
        at = self.t.fig(float(r["income"]), "gbp_plain", c.path("income_curve"), "income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
        return (
            f"The earnings curves are not shown: the curve for the {esc(label)} has a change of {change} at {at} of {esc(what)} "
            "that its neighbouring points do not share, and is under review."
        )

    def provenance(self):
        m = self.pub.manifest
        lines = []
        entries = [self.pub.measures[k] for k in self.order]
        if self.pub.combined is not None and self.pub.combined.combined:
            entries.append(self.pub.combined)
        for e in entries:
            digest = (e.entry.get("artifact_sha256") or e.entry.get("outputs_sha256") or "")[:12]
            ys = f"{fy(e.years[0])} to {fy(e.years[-1])}" if e.years else ""
            name = "Measures together (combined run)" if e.combined else e.name
            lines.append(f"<li>{esc(name)} · <code>{esc(digest)}</code> · {esc(e.status)} · {ys}</li>")
        commit = ""
        try:
            commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
            dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--untracked-files=no", "--", "report/", "src/utils/publication/contract.json"], capture_output=True, text=True, check=True).stdout.strip()
            if commit and dirty:
                commit += " with uncommitted changes"
        except Exception:
            pass
        lines.append(f"<li>Publication manifest revision {esc(m.get('revision', ''))}, updated {esc(long_date(m.get('updated_at', '')))}; built by <code>report/build_report.py</code>{' at ' + esc(commit) if commit else ''}.</li>")
        return (
            '<div class="provenance keep"><h2>Provenance</h2><p class="small">Each artifact\'s files were checked against its receipt when this report was built; '
            "every figure is traced, with the file, row and column it came from, in the accompanying <code>figures.json</code>, which also holds the full digests. "
            "Artifact, short digest, status, years:</p>"
            f'<ul class="provenance__list">{"".join(lines)}</ul></div>'
        )

    # ---- Annex B
    def annex_measures(self):
        self.begin("B")
        label = self.next_label("table", annex="B")
        rows = []
        for k in self.order:
            e = self.pub.measures[k]
            ys = [yy for yy in self.years if yy in e.years]
            span = f"{fy(ys[0])} to {fy(ys[-1])}" if len(ys) > 1 else (fy(ys[0]) if ys else "none")
            extra = f' <span class="muted">No figures for {", ".join(fy(u) for u in e.unsupported)}.</span>' if e.unsupported else ""
            rows.append(f'<tr><th scope="row">{self.swatch(k)}{esc(e.name)}</th><td>{esc(strip_status(e.description))}{extra}</td><td>{esc(e.status.capitalize())}</td><td class="nowrap">{span}</td></tr>')
        head = '<tr><th scope="col" class="w-measure">Measure</th><th scope="col">Full description</th><th scope="col" class="w-status">Status</th><th scope="col" class="w-years">Years</th></tr>'
        blocks = [self.exhibit(label, "The measures as modelled", "In the order used throughout", self.tbl(head, rows, "measures annexb"), "", run=None)]
        if self.pub.not_shown:
            items = []
            for key, e in self.pub.not_shown:
                reason = NOT_SHOWN_REASONS.get(e["status"], e["status"].replace("_", " "))
                items.append(f"<li><b>{esc(e.get('name') or key)}</b>: {esc(reason)}</li>")
            blocks.append(f'<div class="keep"><h2>Modelled but not shown</h2><ul class="plain">{"".join(items)}</ul></div>')
        return self.section("annex-measures", "Annex B", "The measures as modelled", blocks, cls="annex")

    # ---- Annex C
    def annex_tables(self):
        self.begin("C")
        c, y, S = self.pub.combined, self.year, "annex-c"
        blocks = []
        # C1 revenue
        label = self.next_label("table", annex="C")
        total_col = c is not None and self.plural
        head = '<tr><th scope="col">Measure</th>' + "".join(f'<th scope="col" class="num">{fy(yy)}</th>' for yy in self.years) + ('<th scope="col" class="num">Six-year total</th>' if total_col and len(self.years) == 6 else ('<th scope="col" class="num">Total</th>' if total_col else "")) + "</tr>"
        rows, na = [], False
        for k in self.order:
            e = self.pub.measures[k]
            cells = []
            for yy in self.years:
                v, t = self.budget_v(e, yy, "bn1_num", S)
                na = na or v is None
                cells.append(f'<td class="num">{t}</td>')
            rows.append(f'<tr><th scope="row">{self.swatch(k)}{esc(e.name)}</th>{"".join(cells)}{"<td></td>" if total_col else ""}</tr>')
        if c is not None and self.plural:
            cells, vs = [], []
            for yy in self.years:
                v, t = self.budget_v(c, yy, "bn1_num", S)
                cells.append(f'<td class="num">{t}</td>')
                vs.append(v)
            tt = "n/a"
            if None not in vs:
                tt = self.t.fig(sum(vs), "bn1_num", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": self.years}, "sum", S)
            rows.append(f'<tr class="total"><th scope="row">Measures together</th>{"".join(cells)}<td class="num">{tt}</td></tr>')
        blocks.append(self.exhibit(label, "Change in government revenue by measure and year", f"£ billion, UK, {fy(self.years[0])} to {fy(self.years[-1])}", self.tbl(head, rows, "data"),
                                   "A negative figure is a cost to revenue." + (" n/a: no supported figure." if na else "") + (" The last row is the combined run, not the sum of the rows above." if total_col else ""),
                                   run="both" if total_col else "each"))
        # C2 £ by decile
        label = self.next_label("table", annex="C")
        groups = DECILES + ["all"]
        head = '<tr><th scope="col">Measure</th>' + "".join(f'<th scope="col" class="num">{d}</th>' for d in DECILES) + '<th scope="col" class="num">All</th></tr>'
        rows, wh = [], False
        entries = ([(k, self.pub.measures[k]) for k in self.order] if self.plural else [])
        for k, e in entries:
            cells = []
            for d in groups:
                v, t = self.cell(e, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S)
                wh = wh or v is None
                cells.append(f'<td class="num">{t}</td>')
            rows.append(f'<tr><th scope="row">{self.swatch(k)}{esc(e.name)}</th>{"".join(cells)}</tr>')
        if c is not None:
            cells = []
            for d in groups:
                v, t = self.cell(c, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S)
                wh = wh or v is None
                cells.append(f'<td class="num">{t}</td>')
            rows.append(f'<tr class="total"><th scope="row">{"Measures together" if self.plural else esc(c.name)}</th>{"".join(cells)}</tr>')
        blocks.append(self.exhibit(label, "Average change in household net income by income decile", f"£ a year per household, UK, {fy(y)}", self.tbl(head, rows, "data deciles"),
                                   "Decile 1 is the bottom tenth of households by equivalised net income. £0: no change on average, or less than 50p." + (" " + WITHHELD_NOTE if wh else ""),
                                   run="both" if self.plural and c is not None else ("each" if c is None else "together")))
        # C3 each measure's poverty and Gini
        if self.plural:
            label = self.next_label("table", annex="C")
            cols = [f"{who}poverty_{k}_change_pp" for who in ("", "child_") for k in ("abs_bhc", "abs_ahc", "rel_bhc", "rel_ahc")]
            head = (
                '<tr><th scope="col" rowspan="2">Measure</th><th scope="colgroup" colspan="4" class="num">All people, pp</th><th scope="colgroup" colspan="4" class="num">Children, pp</th><th scope="col" rowspan="2" class="num">Gini, %</th></tr>'
                "<tr>" + "".join(f'<th scope="col" class="num">{h}</th>' for h in ("Abs. BHC", "Abs. AHC", "Rel. BHC", "Rel. AHC") * 2) + "</tr>"
            )
            rows, still = [], []
            for k in self.order:
                e = self.pub.measures[k]
                raw = [self.raw(e, "poverty_inequality", col, year=y) for col in cols] + [self.raw(e, "metrics", "gini_change", year=y)]
                if all(v is not None for v in raw) and all(abs(v) < ZERO_PP for v in raw[:-1]) and abs(raw[-1] * 100) < 0.005:
                    still.append(k)
                    continue
                cells = []
                for col in cols:
                    _, t = self.cell(e, "poverty_inequality", col, {"year": y}, "pp2", S)
                    cells.append(f'<td class="num">{t}</td>')
                _, g = self.cell(e, "metrics", "gini_change", {"year": y}, "pct2", S, "x100")
                cells.append(f'<td class="num">{g}</td>')
                rows.append(f'<tr><th scope="row">{self.swatch(k)}{esc(self.name(k))}</th>{"".join(cells)}</tr>')
            if still:
                rows.append(f'<tr class="nochange"><td colspan="10">No change to two decimal places: {esc(self._names(self.name(k) for k in still))}.</td></tr>')
            blocks.append(self.exhibit(label, "Each measure on its own: poverty and inequality", f"Change from the pre-Budget baseline, UK, {fy(y)}", self.tbl(head, rows, "data poverty-c3"),
                                       "pp: percentage points. Abs.: absolute; Rel.: relative; BHC/AHC: before/after housing costs. Gini, %: the change as a share of the baseline Gini coefficient.", run="each"))
        # C4 % by decile
        if c is not None:
            label = self.next_label("table", annex="C")
            head = '<tr><th scope="col"></th>' + "".join(f'<th scope="col" class="num">{d}</th>' for d in DECILES) + "</tr>"
            cells, wh = [], False
            for rd in REL_DECILES:
                v, t = self.cell(c, "distributional_impact", "value", {"year": y, "decile": rd}, "pct2", S)
                wh = wh or v is None
                cells.append(f'<td class="num">{t}</td>')
            rows = [f'<tr class="total"><th scope="row">{"Measures together" if self.plural else esc(c.name)}</th>{"".join(cells)}</tr>']
            blocks.append(self.exhibit(label, "Change in household net income by income decile, % of net income", f"% of net income, UK, {fy(y)}", self.tbl(head, rows, "data deciles"),
                                       "The values behind Figure 1, to two decimal places." + (" " + WITHHELD_NOTE if wh else "")))
        return self.section("annex-tables", "Annex C", "Data tables", blocks, cls="annex", break_before=True)

    # ---- Annex D
    def annex_sources(self):
        self.begin("D")
        label = self.next_label("table", annex="D")
        self.t.exhibit = None
        combined_dir = str(self.pub.combined.dir.relative_to(self.pub.data)) if self.pub.combined is not None else None
        by = {}
        for it in self.t.items:
            ex = it.get("exhibit")
            if not ex:
                continue
            d = by.setdefault(ex, {"files": [], "cols": [], "runs": set()})
            f = Path(it["file"]).name
            if f not in d["files"]:
                d["files"].append(f)
            col = it["column"].replace("-", " − ")
            if col not in d["cols"]:
                d["cols"].append(col)
            if it["file"] == "constituency.csv":
                d["runs"].add("each")
            elif combined_dir and it["file"].startswith(combined_dir):
                d["runs"].add("together")
            else:
                d["runs"].add("each")

        def key(ex):
            m = re.match(r"(Figure|Table) ([A-Z]?)(\d+)", ex)
            return ({"Figure": 0, "Table": 1}[m.group(1)], m.group(2), int(m.group(3)))

        rows = []
        for ex in sorted(by, key=key):
            d = by[ex]
            run = "measures together and each measure on its own" if len(d["runs"]) == 2 else ("measures together" if "together" in d["runs"] else "each measure on its own")
            if self.single:
                run = "the measure's own run"
            cols = d["cols"] if len(d["cols"]) <= 4 else d["cols"][:3] + [f"and {len(d['cols']) - 3} more"]
            rows.append(f'<tr><th scope="row">{esc(ex)}</th><td>{esc(", ".join(d["files"]))}</td><td>{esc(", ".join(cols))}</td><td>{esc(run)}</td></tr>')
        head = '<tr><th scope="col" class="w-ex">Exhibit</th><th scope="col">Artifact file</th><th scope="col">Columns</th><th scope="col" class="w-run">Run</th></tr>'
        t = self.exhibit(label, "Figure and table sources", "Generated from figures.json", self.tbl(head, rows, "sources"), "", run=None, cls="breakable")
        terms = [
            ("90/10 ratio", "The income at the 90th percentile of people, ranked by equivalised household net income, divided by that at the 10th."),
            ("Absolute poverty", "Household income below 60% of the 2024-25 median, held fixed in real terms."),
            ("Approximate", "On the constituency maps, a seat whose estimate rests on fewer survey households; it keeps its colour under dots."),
            ("BHC, AHC", "Before housing costs and after housing costs: income measured before or after rent, mortgage interest and similar costs are taken off."),
            ("Child poverty", "Children are counted as in the Department for Work and Pensions' Households Below Average Income statistics: a child is in poverty when the household they live in is."),
            ("Decile", "One of ten equal groups of households, ranked by equivalised household net income before the measures; the first is the bottom decile."),
            ("Equivalised income", "Household income adjusted for the size and make-up of the household, so that households of different sizes can be compared."),
            ("Gini coefficient", "A measure of income inequality from 0 (everyone has the same income) to 1 (one person has all income); shown as a change relative to its baseline value."),
            ("Net income", "Household income after taxes, including benefits."),
            ("Percentage points (pp)", "The difference between two percentages."),
            ("Relative poverty", "Household income below 60% of the median in the same year, so the line moves with the measures."),
            ("Top 10% share", "The share of all equivalised household net income received by the 10% of people with the highest incomes."),
            ("Withheld", "A figure resting on too few survey households; it is never shown as zero, plotted or ranked."),
        ]
        if self.plural:
            terms.insert(6, ("Each measure on its own; the measures together", "See Box 1."))
        rows = "".join(f"<div><dt>{esc(a)}</dt><dd>{esc(b)}</dd></div>" for a, b in terms)
        gl = f'<div class="glossary-wrap"><h2>Glossary</h2><dl class="glossary">{rows}</dl></div>'
        return self.section("annex-sources", "Annex D", "Sources and glossary", [t, gl], cls="annex")

    # ---- running header and footer
    def _header_logo(self) -> str:
        """The logo for the running header: the cover's PNG in an SVG that
        sets its printed size (a margin box cannot size an image)."""
        path = REPO / "public" / "assets" / "logos" / "policyengine-teal.png"
        if not path.exists():
            return '"PolicyEngine"'
        png = base64.b64encode(path.read_bytes()).decode()
        h = 4.5
        w = round(h * 996 / 207, 2)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}mm" height="{h}mm" viewBox="0 0 996 207">'
            f'<image width="996" height="207" xlink:href="data:image/png;base64,{png}"/></svg>'
        )
        return f'url("data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}")'

    def page_css(self) -> str:
        font = 'font-family: Inter, "Helvetica Neue", Arial, sans-serif; font-size: 7.5pt; color: #6B7280;'
        rule = "border-bottom: 0.5pt solid #E5E7EB; padding-bottom: 2.5mm; vertical-align: bottom;"
        left_foot = css_string(self.pub.provisional_label) if self.pub.provisional else '""'
        return f"""
@page {{
  @top-left {{ content: {self._header_logo()}; {rule} }}
  @top-center {{ content: ""; {rule} }}
  @top-right {{ content: {css_string(f"{self.budget} · {fy(self.year)}")}; {font} {rule} }}
  @bottom-left {{ content: {left_foot}; {font} color: #7A5A1F; vertical-align: top; padding-top: 3mm; }}
  @bottom-right {{ content: "Page " counter(page) " of " counter(pages); {font} vertical-align: top; padding-top: 3mm; }}
}}
@page :first {{
  @top-left {{ content: none; border: 0; }} @top-center {{ content: none; border: 0; }} @top-right {{ content: none; border: 0; }}
  @bottom-left {{ content: none; }} @bottom-right {{ content: none; }}
}}"""

    def build(self) -> str:
        self._toc = []
        # Sections first, so the contents can list only the sections present.
        # Key findings are built first so later prose can avoid repeating them.
        summary = self.key_findings()
        nums = iter(range(1, 20))
        sections = [self.measures(str(next(nums))), self.revenue(str(next(nums))), self.deciles(str(next(nums))), self.people(str(next(nums))), self.poverty(str(next(nums)))]
        if self.pub.flat("constituency.csv") is not None:
            sections.append(self.areas(str(next(nums))))
        sections.append(self.households(str(next(nums))))
        annexes = [self.method(), self.annex_measures(), self.annex_tables(), self.annex_sources()]
        cover = self.cover()
        contents = self.contents()
        body = [cover, summary, contents] + [s for s in sections if s] + annexes
        watermark = '<div class="watermark" aria-hidden="true">Provisional</div>' if self.pub.provisional else ""
        css = (HERE / "report.css").read_text()
        fonts = "".join(
            f"@font-face{{font-family:Inter;font-style:normal;font-weight:{w};src:url(data:font/woff2;base64,"
            f"{base64.b64encode((HERE / 'fonts' / f'inter-latin-{w}-normal.woff2').read_bytes()).decode()}) format('woff2');}}"
            for w in (300, 400, 600, 700)
        )
        return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>{esc(self.title)}</title>
<meta name="author" content="PolicyEngine">
<meta name="description" content="{esc(self.title)}: figures for {fy(self.year)} from publication manifest revision {esc(self.pub.manifest.get('revision', ''))}">
<style>{fonts}
{css}
{self.page_css()}</style></head><body>
{watermark}
{''.join(body)}
</body></html>"""



def _print(html_text: str, html_path: Path, pdf_path: Path, chrome: str | None):
    from playwright.sync_api import sync_playwright

    html_path.write_text(html_text)
    with sync_playwright() as p:
        kwargs = {"executable_path": chrome} if chrome else {"channel": "chrome"}
        browser = p.chromium.launch(**kwargs)
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri(), wait_until="load")
        page.evaluate("document.fonts.ready")
        # The running header and footer are the stylesheet's @page margin boxes.
        page.pdf(path=str(pdf_path), format="A4", print_background=True, prefer_css_page_size=True,
                 display_header_footer=False, tagged=True, outline=True)
        browser.close()


def _fitz():
    try:
        import pymupdf as fitz  # noqa: F401
    except ImportError:
        try:
            import fitz  # noqa: F401
        except ImportError:
            return None
    return fitz


def fill_contents(html_text: str, pdf_path: Path) -> str | None:
    """Chrome does not implement target-counter(), so the contents' page
    numbers come from the first print's outline (its headings). None without
    pymupdf."""
    fitz = _fitz()
    if fitz is None:
        return None
    doc = fitz.open(str(pdf_path))
    toc = doc.get_toc()
    doc.close()
    pages = {}
    for sid, title in re.findall(r'<h1 id="h-([^"]+)"[^>]*>(.*?)</h1>', html_text, flags=re.S):
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", "", title)).split())
        for _, t, pg in toc:
            if " ".join(t.split()) == text and sid not in pages:
                pages[sid] = pg
    return re.sub(r'<span class="toc__page" data-toc="([^"]+)"></span>',
                  lambda m: f'<span class="toc__page" data-toc="{m.group(1)}">{pages.get(m.group(1), "")}</span>', html_text)


def page_problems(pdf_path: Path) -> list[str]:
    """Pages, other than the cover and the last, whose content ends above 40%
    of the page, and pages that hold only notes, sources or footnotes. Empty
    without pymupdf."""
    fitz = _fitz()
    if fitz is None:
        return []
    doc = fitz.open(str(pdf_path))
    out = []
    for i, page in enumerate(doc):
        if i == 0 or i == doc.page_count - 1:
            continue
        h = page.rect.height
        top, bottom = 20 * 72 / 25.4, h - 18 * 72 / 25.4
        ys, sizes, graphic = [], [], False
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    y0, y1 = span["bbox"][1], span["bbox"][3]
                    if span["text"].strip().upper() == "PROVISIONAL" or not span["text"].strip():
                        continue
                    if y0 > top and y1 < bottom:
                        ys.append(y1)
                        sizes.append(span["size"])
            if block.get("type") == 1 and top < block["bbox"][1] < bottom:
                ys.append(block["bbox"][3])
                graphic = True
        for d in page.get_drawings():
            r = d["rect"]
            if top < r.y0 and r.y1 < bottom and r.height > 2:
                ys.append(r.y1)
                graphic = True
        end = max(ys) if ys else 0
        if end < 0.4 * h:
            out.append(f"page {i + 1}: content ends at {end / h:.0%} of the page")
        if sizes and max(sizes) <= 7.6 and not graphic:
            out.append(f"page {i + 1}: only notes, sources or footnotes")
    doc.close()
    return out


def to_pdf(html_path: Path, pdf_path: Path, chrome: str | None) -> list[str]:
    html_text = html_path.read_text()
    _print(html_text, html_path, pdf_path, chrome)
    filled = fill_contents(html_text, pdf_path)
    if filled is None:
        print("pymupdf is not installed: the contents print without page numbers and the page check is skipped")
        return []
    _print(filled, html_path, pdf_path, chrome)
    return page_problems(pdf_path)


# --- Check --------------------------------------------------------------


def _matches(r, where):
    for k, v in where.items():
        if isinstance(v, list):
            if str(r.get(k)) not in {str(x) for x in v}:
                return False
        elif isinstance(v, str) and v.startswith("!"):
            if r.get(k) == v[1:]:
                return False
        elif str(r.get(k)) != str(v):
            return False
    return True


def _values(rows, col):
    if "-" in col:
        a, b = col.split("-")
        return [float(r[a]) - float(r[b]) for r in rows]
    return [float(r[col]) for r in rows if r.get(col, "") != ""]


def check(figures_path: Path, data: Path) -> int:
    """Recompute every traced figure from its file and compare the text.
    Kinds: a single value (value, x100, neg), a sum over rows (sum), a share
    of one set of rows in another, as a percentage (share: ``of`` names the
    denominator rows), and a row count (count)."""
    items = json.loads(figures_path.read_text())["figures"]
    cache = {}
    bad = 0
    for item in items:
        path = data / item["file"]
        if path not in cache:
            cache[path] = read_csv(path)
        where = item["where"]
        rows = [r for r in cache[path] if _matches(r, where)]
        kind = item["transform"]
        if kind == "count":
            if where.get("tier") == "!withheld":
                rows = [r for r in rows if r.get("value", "") != ""]
            value = float(len(rows))
        elif kind == "share":
            den_rows = [r for r in cache[path] if _matches(r, item.get("of") or {})]
            den = sum(_values(den_rows, item["column"]))
            if not den_rows or den == 0:
                print(f"NO DENOMINATOR: {item}")
                bad += 1
                continue
            value = 100 * sum(_values(rows, item["column"])) / den
        else:
            xs = _values(rows, item["column"])
            years = where.get("year") if isinstance(where.get("year"), list) else None
            if not xs or (kind != "sum" and len(xs) != 1) or (years is not None and len(xs) != len(years)):
                print(f"NO UNIQUE ROW: {item}")
                bad += 1
                continue
            value = TRANSFORMS[kind](xs)
        text = FORMATS[item["format"]](value)
        if text != item["text"]:
            print(f"MISMATCH: printed {item['text']!r}, data give {text!r}: {item['file']} {where} {item['column']}")
            bad += 1
    print(f"{len(items)} figures checked, {bad} problems")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="write report.html, figures.json and (with --pdf) report.pdf")
    b.add_argument("--data", type=Path, default=REPO / "public" / "data")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--year", type=int, default=DEFAULT_YEAR, help="first year of the fiscal year to report (default 2027: 2027-28)")
    b.add_argument("--title", default=None, help="replace the whole cover title")
    b.add_argument("--pdf", action="store_true", help="print report.pdf with Chrome (needs playwright; pymupdf for contents page numbers and the page check)")
    b.add_argument("--chrome", default=None, help="a Chrome or Chromium executable (default: the installed Google Chrome)")
    c = sub.add_parser("check", help="recompute every figure in figures.json from the data")
    c.add_argument("figures", type=Path)
    c.add_argument("--data", type=Path, default=REPO / "public" / "data")
    args = ap.parse_args(argv)
    if args.cmd == "check":
        return check(args.figures, args.data)
    pub = Publication(args.data)
    report = Report(pub, args.year, args.title)
    html_text = report.build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.html").write_text(html_text)
    (args.out / "figures.json").write_text(
        json.dumps(
            {
                "manifest_revision": pub.manifest.get("revision"),
                "manifest_sha256": sha256(pub.manifest_path),
                "year": args.year,
                "provisional": pub.provisional,
                "artifacts": {
                    e.key: {"artifact": e.entry.get("artifact"), "artifact_sha256": e.entry.get("artifact_sha256"), "outputs_sha256": e.entry.get("outputs_sha256")}
                    for e in [*pub.measures.values(), *([pub.combined] if pub.combined is not None and pub.combined.combined else [])]
                },
                "figures": report.t.items,
            },
            indent=1,
            ensure_ascii=False,
        )
    )
    print(f"wrote {args.out / 'report.html'} and figures.json ({len(report.t.items)} figures)")
    if args.pdf:
        problems = to_pdf(args.out / "report.html", args.out / "report.pdf", args.chrome)
        print(f"wrote {args.out / 'report.pdf'}")
        if problems:
            print("Page check failed:\n  " + "\n  ".join(problems))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
