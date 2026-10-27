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
GAIN, GAIN_TEXT = "#319795", "#0F766E"
LOSS, LOSS_TEXT = "#D97706", "#B45309"
INK, TEXT, MUTED, GRID, AXIS = "#1F2937", "#374151", "#4B5563", "#E5E7EB", "#9CA3AF"
NEUTRAL, HIGHLIGHT, ZERO = "#9CA3AF", "#285E61", "#374151"
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
# One function per kind of figure; ``check`` uses the same ones, so a figure
# is traced by its value, its source and the format that printed it.

MINUS = "−"


def _signed(value: float, body: str, plus: bool) -> str:
    if float(re.sub(r"[^0-9.]", "", body) or 0) == 0:
        return body
    if value < 0:
        return MINUS + body
    return ("+" + body) if plus else body


FORMATS = {
    # £bn with two decimals, as the dashboard's tables (formatBillions)
    "bn2": lambda v: _signed(v, f"£{abs(v):,.2f}bn", False),
    "bn2_plain": lambda v: _signed(v, f"{abs(v):,.2f}", False),
    # £bn in words, as the dashboard's revenue sentence
    "bn_words": lambda v: (
        f"£{abs(v):.1f} billion" if abs(v) >= 0.95 else f"£{round(abs(v) * 1000):,} million"
    ),
    "gbp": lambda v: _signed(v, f"£{abs(v):,.0f}", True),
    "gbp_plain": lambda v: f"£{abs(v):,.0f}",
    "pct2": lambda v: _signed(v, f"{abs(v):.2f}%", True),
    "pct1_plain": lambda v: f"{abs(v):.1f}%",
    "pct0_plain": lambda v: f"{abs(v):.0f}%",
    "pp2": lambda v: _signed(v, f"{abs(v):.2f}pp", True),
    "pp3": lambda v: _signed(v, f"{abs(v):.3f}pp", True),
    "count": lambda v: f"{v:,.0f}",
}

TRANSFORMS = {
    "value": lambda xs: xs[0],
    "x100": lambda xs: xs[0] * 100,
    "sum": lambda xs: sum(xs),
    "neg": lambda xs: -xs[0],
}


class Trace:
    """Every printed figure, with where it came from."""

    def __init__(self, data: Path):
        self.data = data
        self.items: list[dict] = []

    def fig(self, value, fmt, file, column, where, transform="value", section=""):
        text = FORMATS[fmt](value)
        self.items.append(
            {
                "section": section,
                "text": text,
                "value": value,
                "format": fmt,
                "file": str(file.relative_to(self.data)) if isinstance(file, Path) else file,
                "column": column,
                "where": where,
                "transform": transform,
            }
        )
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


def setup_matplotlib():
    import matplotlib

    matplotlib.use("svg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["Inter", "DejaVu Sans"],
            "font.size": 9,
            "axes.edgecolor": AXIS,
            "axes.labelcolor": MUTED,
            "axes.titlesize": 9,
            "axes.titlecolor": INK,
            "axes.titlelocation": "left",
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "xtick.labelsize": 8.5,
            "ytick.labelsize": 8.5,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.unicode_minus": True,
        }
    )
    return plt


def svg_of(plt, fig) -> str:
    buffer = io.StringIO()
    fig.savefig(buffer, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    text = buffer.getvalue()
    text = text[text.index("<svg"):]
    text = re.sub(r"font-family:[^;\"']*", "font-family: Inter, sans-serif", text)
    text = re.sub(r'font-family="[^"]*"', 'font-family="Inter, sans-serif"', text)
    text = re.sub(r'(<svg[^>]*?) width="[^"]*" height="[^"]*"', r'\1 width="100%" aria-hidden="true"', text, count=1)
    return text


def png_of(plt, fig, dpi=200) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight", transparent=False, facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def tone(v, invert=False):
    """Gain tone for a gain to households (or a cost to the Treasury)."""
    if abs(v) < 1e-12:
        return NEUTRAL
    good = v > 0
    if invert:
        good = not good
    return GAIN if good else LOSS


def label_bars(ax, bars, labels, values, horizontal=False, size=7.8):
    for bar, text, v in zip(bars, labels, values):
        if horizontal:
            ax.annotate(
                text,
                (bar.get_width(), bar.get_y() + bar.get_height() / 2),
                xytext=(4 if v >= 0 else -4, 0),
                textcoords="offset points",
                ha="left" if v >= 0 else "right",
                va="center",
                fontsize=size,
                color=INK,
            )
        else:
            ax.annotate(
                text,
                (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                xytext=(0, 3 if v >= 0 else -3),
                textcoords="offset points",
                ha="center",
                va="bottom" if v >= 0 else "top",
                fontsize=size,
                color=INK,
            )


def pad_limits(values, lo_pad=0.22, hi_pad=0.22):
    lo, hi = min(0.0, min(values)), max(0.0, max(values))
    span = (hi - lo) or 1.0
    return lo - (span * lo_pad if lo < 0 else 0), hi + (span * hi_pad if hi > 0 else 0)


def minus_ticks(ax, axis="y", fmt="{:g}"):
    from matplotlib.ticker import FuncFormatter

    f = FuncFormatter(lambda t, _: fmt.format(t).replace("-", MINUS))
    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(f)


def style_axes(ax, grid_axis="y"):
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


# --- The report ---------------------------------------------------------


class Report:
    def __init__(self, pub: Publication, year: int, title: str):
        self.pub = pub
        self.year = year
        # Headings keep their spaces (report.css), so a title typed with runs of spaces is normalised here.
        self.title = " ".join(title.split())
        self.t = Trace(pub.data)
        self.plt = setup_matplotlib()
        self.contract = json.loads(CONTRACT.read_text()) if CONTRACT.exists() else {}
        c = pub.combined
        if c is not None and year not in c.years:
            raise SystemExit(f"The combined run has no supported figures for {fy(year)}")
        self.years = sorted(
            set(c.years) if c is not None else set().union(*(set(e.years) for e in pub.measures.values()))
        )
        self.order = self._order()
        # One measure: its own run stands for "the measures together" (as the
        # dashboard's combinedEntryFor does), so name it, and leave out the
        # "each measure on its own" blocks, which would repeat its figures.
        self.single = c is not None and not c.combined
        self.together = c.name if self.single else "The measures together"

    # Measures in the dashboard's order: raise revenue, then cost revenue,
    # each by size over the published years.
    def _order(self):
        totals = {}
        for k, e in self.pub.measures.items():
            totals[k] = sum(float(r["value"]) for r in e.table("budgetary_impact") if int(r["year"]) in e.years)
        raise_ = sorted((k for k in totals if totals[k] > 0), key=lambda k: -totals[k])
        cost = sorted((k for k in totals if totals[k] <= 0), key=lambda k: totals[k])
        return raise_ + cost

    def name(self, key):
        return self.pub.measures[key].name

    # ---- figures with a trace
    def budget(self, e: Entry, year: int, fmt: str, section: str):
        r = e.row("budgetary_impact", year=year)
        if r is None or year not in e.years:
            return None, "n/a"
        v = float(r["value"])
        return v, self.t.fig(v, fmt, e.path("budgetary_impact"), "value", {"reform_id": e.key, "year": year}, section=section)

    def cell(self, e, table, column, match, fmt, section, transform="value"):
        r = e.row(table, **match)
        if r is None or r.get(column, "") == "":
            return None, "n/a"
        raw = float(r[column])
        v = TRANSFORMS[transform]([raw])
        return v, self.t.fig(v, fmt, e.path(table), column, {"reform_id": e.key, **match}, transform, section)

    # ---- sections
    def cover(self):
        pub, m = self.pub, self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        versions = " · ".join(
            f"{ident[k]['name']} {ident[k]['version']}" for k in ("wrapper", "model") if k in ident
        )
        n = len(pub.measures)
        updated_text = long_date(m.get("updated_at", ""))
        status = (
            f'<p class="status-banner" role="note">{esc(pub.provisional_label)}</p>' if pub.provisional else ""
        )
        budget_date = (m.get("budget") or {}).get("date", "")
        return f"""
<section class="cover" aria-label="Cover">
  {self.logo()}
  {status}
  <h1>{esc(self.title)}</h1>
  <p class="sub">How {count_words(n)} measure{'s' if n != 1 else ''} would change the public finances, household incomes, poverty and inequality, modelled with PolicyEngine UK. Figures for {fy(self.year)} unless stated.</p>
  <dl class="cover-meta">
    <div><dt>Budget</dt><dd>{esc(long_date(budget_date))}</dd></div>
    <div><dt>Publication</dt><dd>Revision {esc(m.get('revision', ''))}, {esc(updated_text)}</dd></div>
    <div><dt>Model</dt><dd>{esc(versions)}</dd></div>
  </dl>
</section>"""

    def logo(self):
        path = REPO / "public" / "assets" / "logos" / "policyengine-teal.png"
        if path.exists():
            data = base64.b64encode(path.read_bytes()).decode()
            return f'<img class="logo" src="data:image/png;base64,{data}" alt="PolicyEngine">'
        return '<p class="logo-text">PolicyEngine</p>'

    def summary(self):
        c, y, S = self.pub.combined, self.year, "summary"
        if c is None:
            return f"""
<section class="page" id="summary"><h2>Summary</h2>
{self.no_combined()}
{self.contents()}
</section>"""
        rev = float(c.row("budgetary_impact", year=y)["value"])
        rev_words = self.t.fig(rev, "bn_words", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": y}, section=S)
        hh, hh_text = self.cell(c, "winners_losers", "avg_change", {"year": y, "decile": "all"}, "gbp", S)
        better, better_text = self.cell(c, "age_impact", "pct_better_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
        worse, worse_text = self.cell(c, "age_impact", "pct_worse_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
        pov, pov_text = self.cell(c, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": y}, "pp2", S)
        lo, lo_text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": "1st"}, "pct2", S)
        hi, hi_text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": "10th"}, "pct2", S)
        tiles = f"""
<div class="tiles">
  <div class="tile"><div class="v">{rev_words}</div><div class="l">{'Cost to the government' if rev < 0 else 'Raised for the government'}, {fy(y)}</div></div>
  <div class="tile"><div class="v">{hh_text}</div><div class="l">Average change in household net income, £ a year, {fy(y)}</div></div>
  <div class="tile"><div class="v">{better_text} <span class="vs">better off</span><br>{worse_text} <span class="vs">worse off</span></div><div class="l">People in households whose net income rises or falls, {fy(y)}</div></div>
  <div class="tile"><div class="v">{pov_text}</div><div class="l">Change in absolute poverty before housing costs, percentage points, {fy(y)}{' (less than 0.005 points either way)' if pov_text.lstrip('+' + MINUS).startswith('0.00') else ''}</div></div>
</div>"""
        sentences = [
            f"As a share of net income, the lowest-income tenth of households {self._share_verb(lo, lo_text)} and the highest-income tenth {self._share_verb(hi, hi_text)}.",
        ]
        return f"""
<section class="page" id="summary">
  <h2>Summary</h2>
  {tiles}
  <ul class="findings">{''.join(f'<li>{s}</li>' for s in sentences)}</ul>
  {self.contents()}
</section>"""

    @staticmethod
    def _share_verb(v, text):
        if v is None:
            return "has no published figure"
        if text.lstrip("+" + MINUS).startswith("0.00"):
            return "sees almost no change"
        return f"{'gains' if v > 0 else 'loses'} {text.lstrip('+' + MINUS)}"

    def contents(self):
        items = [
            ("revenue", "Public finances"),
            ("deciles", "Households by income decile"),
            ("winners", "Better and worse off"),
            ("poverty", "Poverty and inequality"),
            ("age", "By age"),
            ("areas", "Regions and constituencies"),
            ("households", "Example households"),
            ("measures", "The measures"),
            ("method", "Method, data and caveats"),
        ]
        rows = "".join(f'<li><a href="#{a}">{i}. {esc(t)}</a></li>' for i, (a, t) in enumerate(items, 1))
        return f'<nav aria-label="Contents"><h3>Contents</h3><ol class="toc">{rows}</ol></nav>'

    def no_combined(self):
        if getattr(self, "_no_combined_shown", False):
            return '<div class="notice" role="note"><p>No combined run is published for exactly these measures (see the summary), so this section shows each measure on its own only.</p></div>'
        self._no_combined_shown = True
        ids = ", ".join(self.name(k) for k in self.order)
        return (
            '<div class="notice" role="note"><p><b>No combined run is published for exactly these measures.</b> '
            f"Figures for the measures together are left out rather than added up from each measure on its own ({esc(ids)}).</p></div>"
        )

    def unavailable(self, text):
        return f'<div class="notice" role="note"><p>{text}</p></div>'

    def revenue(self):
        pub, c, S = self.pub, self.pub.combined, "revenue"
        plt = self.plt
        parts = [
            '<section class="page" id="revenue"><p class="kicker">Section 1</p><h2>Public finances</h2>',
            "<p>The change in government revenue each year, as PolicyEngine costs the measures: static, with no behavioural response. Below zero the measures cost the government; above zero they raise revenue.</p>",
            '<p class="key"><span class="sw" style="background:%s"></span>Raises revenue (households pay more)<span class="sw" style="background:%s"></span>Costs revenue (households pay less or receive more)</p>'
            % (LOSS, GAIN),
        ]
        if c is not None:
            vals, labels, years = [], [], []
            for y in self.years:
                v, text = self.budget(c, y, "bn2", S)
                if v is None:
                    continue
                vals.append(v)
                labels.append(text)
                years.append(y)
            fig, ax = plt.subplots(figsize=(6.8, 2.5))
            bars = ax.bar([fy(y) for y in years], vals, color=[tone(v, invert=True) for v in vals], width=0.56)
            ax.axhline(0, color=ZERO, linewidth=0.8)
            label_bars(ax, bars, labels, vals)
            ax.set_ylim(*pad_limits(vals))
            ax.set_ylabel("£bn a year")
            minus_ticks(ax)
            style_axes(ax)
            alt = "; ".join(f"{fy(y)}: {t}" for y, t in zip(years, labels))
            parts.append(self.figure(svg_of(plt, fig), f"{self.together}: change in government revenue by year, £bn", alt, "The measure's own run against current law." if self.single else "Combined run of all the measures in this report, including how they interact."))
        else:
            parts.append(self.no_combined())

        # Each measure in the report year, and over the whole period
        y = self.year
        keys = [] if self.single else [
            k for k in self.order
            if self.pub.measures[k].row("budgetary_impact", year=y) is not None and y in self.pub.measures[k].years
        ]
        vals, labels = [], []
        for k in keys:
            v, text = self.budget(pub.measures[k], y, "bn2", S)
            vals.append(v)
            labels.append(text)
        if keys:
            fig, ax = plt.subplots(figsize=(6.8, 0.42 * len(keys) + 0.8))
            names = [self.name(k) for k in keys][::-1]
            bars = ax.barh(names, vals[::-1], color=[tone(v, invert=True) for v in vals[::-1]], height=0.6)
            ax.axvline(0, color=ZERO, linewidth=0.8)
            label_bars(ax, bars, labels[::-1], vals[::-1], horizontal=True)
            ax.set_xlim(*pad_limits(vals, 0.35, 0.3))
            ax.set_xlabel(f"Change in government revenue, £bn, {fy(y)}")
            ax.tick_params(axis="y", length=0, labelsize=8.5, labelcolor=INK)
            minus_ticks(ax, "x")
            style_axes(ax, "x")
            alt = "; ".join(f"{self.name(k)}: {t}" for k, t in zip(keys, labels))
            parts.append(self.figure(svg_of(plt, fig), f"Each measure on its own, {fy(y)}", alt, "Each measure run on its own against current law. The measures' own effects need not add up to the combined run's, which includes how they interact."))

        # Table: every year, and the period total
        head = "".join(f'<th scope="col" class="num">{fy(y)}</th>' for y in self.years)
        rows = []
        for k in self.order:
            e = pub.measures[k]
            cells = []
            vs = []
            for yy in self.years:
                v, text = self.budget(e, yy, "bn2_plain", S + "-table")
                cells.append(f'<td class="num {self._cls(v)}">{text}</td>')
                if v is not None:
                    vs.append(v)
            if len(vs) == len(self.years):
                total = sum(vs)
                ttext = self.t.fig(total, "bn2_plain", e.path("budgetary_impact"), "value", {"reform_id": e.key, "year": self.years}, "sum", S + "-table")
            else:
                # A total over fewer years than the column says would mislead
                total, ttext = None, "n/a"
            rows.append(f'<tr><th scope="row">{esc(e.name)}</th>{"".join(cells)}<td class="num total-col {self._cls(total)}">{ttext}</td></tr>')
        if c is not None and not self.single:
            cells, vs = [], []
            for yy in self.years:
                v, text = self.budget(c, yy, "bn2_plain", S + "-table")
                cells.append(f'<td class="num">{text}</td>')
                if v is not None:
                    vs.append(v)
            total = sum(vs)
            ttext = self.t.fig(total, "bn2_plain", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": self.years}, "sum", S + "-table")
            rows.append(f'<tr class="total"><th scope="row">All measures together</th>{"".join(cells)}<td class="num total-col">{ttext}</td></tr>')
        parts.append(
            f"""<div class="keep"><table><caption>Change in government revenue by measure and year, £bn</caption>
<thead><tr><th scope="col">Measure</th>{head}<th scope="col" class="num">Total</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<p class="note">Negative values cost revenue. Total: {fy(self.years[0])} to {fy(self.years[-1])}, shown only when every year has a figure. n/a: no supported figure.</p></div>"""
        )
        parts.append("</section>")
        return "\n".join(parts)

    @staticmethod
    def _cls(v):
        if v is None or abs(v) < 0.005:
            return ""
        return "costs" if v < 0 else "raises"

    def figure(self, chart, title, alt, caption, img=False):
        body = f'<img src="{chart}" alt="{esc(alt)}">' if img else f'<div role="img" aria-label="{esc(title)}. {esc(alt)}">{chart}</div>'
        return f'<figure><figcaption class="ftitle">{esc(title)}</figcaption>{body}<p class="caption">{esc(caption)}</p></figure>'

    def deciles(self):
        c, y, S, plt = self.pub.combined, self.year, "deciles", self.plt
        parts = [
            f'<section class="page" id="deciles"><p class="kicker">Section 2</p><h2>Households by income decile</h2>',
            f"<p>The change in household net income in {fy(y)}, with households ranked into ten equal groups (deciles) by their equivalised net income before the measures.</p>",
        ]
        if c is None:
            parts.append(self.no_combined())
        else:
            abs_vals, abs_labels, rel_vals, rel_labels = [], [], [], []
            for d, rd in zip(DECILES, REL_DECILES):
                v, text = self.cell(c, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S)
                abs_vals.append(v or 0.0)
                abs_labels.append(text)
                v, text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": rd}, "pct2", S)
                rel_vals.append(v or 0.0)
                rel_labels.append(text)
            fig, (a1, a2) = plt.subplots(2, 1, figsize=(6.8, 4.5))
            for ax, vals, labels, title in (
                (a1, abs_vals, abs_labels, "£ a year"),
                (a2, rel_vals, rel_labels, "% of net income"),
            ):
                bars = ax.bar(DECILES, vals, color=[tone(v) for v in vals], width=0.62)
                ax.axhline(0, color=ZERO, linewidth=0.8)
                label_bars(ax, bars, labels, vals, size=7.4)
                ax.set_ylim(*pad_limits(vals, 0.3, 0.3))
                ax.set_title(title)
                minus_ticks(ax)
                style_axes(ax)
            a2.set_xlabel("Income decile (1 = lowest-income tenth, 10 = highest-income tenth)")
            fig.tight_layout(h_pad=1.4)
            alt = "; ".join(f"decile {d}: {a}, {r}" for d, a, r in zip(DECILES, abs_labels, rel_labels))
            parts.append(
                '<p class="key"><span class="sw" style="background:%s"></span>Gain<span class="sw" style="background:%s"></span>Loss</p>' % (GAIN, LOSS)
            )
            parts.append(self.figure(svg_of(plt, fig), f"{self.together}: average change in household net income by income decile, {fy(y)}", alt, "Average over all households in each decile, including those with no change."))

        # Each measure by decile (one measure: the chart above is its own)
        if self.single:
            parts.append("</section>")
            return "\n".join(parts)
        head = "".join(f'<th scope="col" class="num">{d}</th>' for d in DECILES)
        rows = []
        for k in self.order:
            e = self.pub.measures[k]
            cells = []
            for d in DECILES:
                v, text = self.cell(e, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S + "-table")
                cells.append(f'<td class="num {self._tone_cls(v)}">{text}</td>')
            rows.append(f'<tr><th scope="row">{esc(e.name)}</th>{"".join(cells)}</tr>')
        parts.append(
            f"""<div class="keep"><table class="compact"><caption>Each measure on its own: average change in household net income by income decile, £ a year, {fy(y)}</caption>
<thead><tr><th scope="col">Measure</th>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>
<p class="note">Decile 1 is the lowest-income tenth of households, 10 the highest. £0: no change on average, or less than 50p.</p></div></section>"""
        )
        return "\n".join(parts)

    @staticmethod
    def _tone_cls(v):
        if v is None or abs(v) < 0.5:
            return ""
        return "gain" if v > 0 else "loss"

    def winners(self):
        y, S, plt = self.year, "winners", self.plt
        entries = ([self.pub.combined] if self.pub.combined is not None and self.pub.combined.combined else []) + [
            self.pub.measures[k] for k in self.order
        ]
        names, better, same, worse, lb, ls, lw = [], [], [], [], [], [], []
        for e in entries:
            b, bt = self.cell(e, "age_impact", "pct_better_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            u, ut = self.cell(e, "age_impact", "pct_unchanged", {"year": y, "age_band": "all"}, "pct1_plain", S)
            w, wt = self.cell(e, "age_impact", "pct_worse_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            if b is None:
                continue
            names.append("All measures together" if e.combined else e.name)
            better.append(b)
            same.append(u)
            worse.append(w)
            lb.append(bt)
            ls.append(ut)
            lw.append(wt)
        parts = [
            f'<section class="page" id="winners"><p class="kicker">Section 3</p><h2>Better and worse off</h2>',
            f"<p>The share of people living in households whose net income rises, does not change, or falls in {fy(y)}. Changes of any size count, so a household gaining £1 a year is better off.</p>",
        ]
        if names:
            n = len(names)
            fig, ax = plt.subplots(figsize=(6.8, 0.36 * n + 0.9))
            ys = list(range(n))[::-1]
            ax.barh(ys, better, color=GAIN, height=0.62, label="Better off")
            ax.barh(ys, same, left=better, color="#E5E7EB", height=0.62, label="No change")
            ax.barh(ys, worse, left=[b + s for b, s in zip(better, same)], color=LOSS, height=0.62, label="Worse off")
            ax.set_yticks(ys, names)
            ax.tick_params(axis="y", length=0, labelsize=8.3, labelcolor=INK)
            ax.set_xlim(0, 100)
            ax.set_xlabel("% of people")
            ax.legend(frameon=False, fontsize=8, ncol=3, loc="lower left", bbox_to_anchor=(0, 1.0))
            style_axes(ax, "x")
            alt = "; ".join(f"{nm}: {b} better off, {s} no change, {w} worse off" for nm, b, s, w in zip(names, lb, ls, lw))
            parts.append(self.figure(svg_of(plt, fig), f"People better off, unchanged and worse off, {fy(y)}", alt, ("People counted by the household they live in." if self.single else "People counted by the household they live in. Each measure on its own; the first bar is the measures together.") + " The values are in the table below."))
            rows = "".join(
                f'<tr><th scope="row">{esc(nm)}</th><td class="num">{b}</td><td class="num">{s}</td><td class="num">{w}</td></tr>'
                for nm, b, s, w in zip(names, lb, ls, lw)
            )
            parts.append(
                f"""<table class="keep"><caption>People better off, unchanged and worse off, % of people, {fy(y)}</caption>
<thead><tr><th scope="col">Measure</th><th scope="col" class="num">Better off</th><th scope="col" class="num">No change</th><th scope="col" class="num">Worse off</th></tr></thead><tbody>{rows}</tbody></table>"""
            )
        else:
            parts.append(self.unavailable("No published figures for this year."))
        parts.append("</section>")
        return "\n".join(parts)

    def poverty(self):
        c, y, S, plt = self.pub.combined, self.year, "poverty", self.plt
        parts = [
            f'<section class="page" id="poverty"><p class="kicker">Section 4</p><h2>Poverty and inequality</h2>',
            "<p>Absolute poverty: below 60% of the 2024-25 median income, held fixed in real terms. Relative poverty: below 60% of the median in the same year, so the line moves with the measures. Children are counted as in DWP's statistics. Before (BHC) and after (AHC) housing costs.</p>",
        ]
        if c is None:
            parts.append(self.no_combined())
        else:
            # Chart: absolute BHC, all people and children, by year
            years, a_vals, a_labels, k_vals, k_labels = [], [], [], [], []
            for yy in self.years:
                v, t = self.cell(c, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": yy}, "pp2", S)
                kv, kt = self.cell(c, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": yy}, "pp2", S)
                if v is None:
                    continue
                years.append(yy)
                a_vals.append(v)
                a_labels.append(t)
                k_vals.append(kv or 0.0)
                k_labels.append(kt)
            fig, ax = plt.subplots(figsize=(6.8, 2.2))
            xs = list(range(len(years)))
            w = 0.38
            b1 = ax.bar([x - w / 2 for x in xs], a_vals, width=w, color=HIGHLIGHT, label="All people")
            b2 = ax.bar([x + w / 2 for x in xs], k_vals, width=w, color="#81E6D9", label="Children")
            ax.axhline(0, color=ZERO, linewidth=0.8)
            ax.set_xticks(xs, [fy(yy) for yy in years])
            ax.set_ylim(*pad_limits(a_vals + k_vals, 0.35, 0.35))
            ax.set_ylabel("Percentage points")
            ax.legend(frameon=False, fontsize=8, ncol=2, loc="lower left", bbox_to_anchor=(0, 1.0))
            minus_ticks(ax)
            style_axes(ax)
            alt = "; ".join(f"{fy(yy)}: all people {a}, children {k}" for yy, a, k in zip(years, a_labels, k_labels))
            parts.append(self.figure(svg_of(plt, fig), f"{self.together}: change in absolute poverty before housing costs, by year", alt, "Below zero, fewer people in poverty. The values are in the table below."))
            head = "".join(f'<th scope="col" class="num">{fy(yy)}</th>' for yy in years)
            parts.append(
                f"""<table class="keep compact"><caption>{self.together}: change in absolute poverty before housing costs by year, percentage points</caption>
<thead><tr><th scope="col">People</th>{head}</tr></thead><tbody>
<tr><th scope="row">All people</th>{''.join(f'<td class="num">{t}</td>' for t in a_labels)}</tr>
<tr><th scope="row">Children</th>{''.join(f'<td class="num">{t}</td>' for t in k_labels)}</tr></tbody></table>"""
            )

            # Table: report year, the four measures, all and children
            rows = []
            for key, label in (("abs_ahc", "Absolute, after housing costs"), ("rel_bhc", "Relative, before housing costs"), ("rel_ahc", "Relative, after housing costs")):
                _, a = self.cell(c, "poverty_inequality", f"poverty_{key}_change_pp", {"year": y}, "pp2", S + "-table")
                _, ap = self.cell(c, "poverty_inequality", f"poverty_{key}_change_pct", {"year": y}, "pct2", S + "-table")
                _, k = self.cell(c, "poverty_inequality", f"child_poverty_{key}_change_pp", {"year": y}, "pp2", S + "-table")
                _, kp = self.cell(c, "poverty_inequality", f"child_poverty_{key}_change_pct", {"year": y}, "pct2", S + "-table")
                rows.append(f'<tr><th scope="row">{label}</th><td class="num">{a}</td><td class="num">{ap}</td><td class="num">{k}</td><td class="num">{kp}</td></tr>')
            parts.append(
                f"""<table class="keep"><caption>{self.together}: change in other measures of poverty, {fy(y)}</caption>
<thead><tr><th scope="col">Poverty measure</th><th scope="col" class="num">All people, pp</th><th scope="col" class="num">All people, % of rate</th><th scope="col" class="num">Children, pp</th><th scope="col" class="num">Children, % of rate</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"""
            )
            _, g = self.cell(c, "metrics", "gini_change", {"year": y}, "pct2", S + "-table", "x100")
            _, t10 = self.cell(c, "poverty_inequality", "top_10_share_change_pp", {"year": y}, "pp2", S + "-table")
            _, p9010 = self.cell(c, "poverty_inequality", "p90_p10_change", {"year": y}, "pct2", S + "-table", "x100")
            parts.append(
                f"""<table class="keep"><caption>{self.together}: change in inequality, {fy(y)}</caption>
<thead><tr><th scope="col">Inequality measure</th><th scope="col" class="num">Change</th></tr></thead><tbody>
<tr><th scope="row">Gini index, relative change</th><td class="num">{g}</td></tr>
<tr><th scope="row">Share of income of the top 10%, percentage points</th><td class="num">{t10}</td></tr>
<tr><th scope="row">90/10 ratio, relative change</th><td class="num">{p9010}</td></tr></tbody></table>
<p class="note">Equivalised household net income, each household weighted by the people in it. A relative change is a share of the baseline value: a Gini of 0.300 falling to 0.297 is a 1.00% fall.</p>"""
            )
        # Each measure, report year (one measure: the tables above are its own)
        if self.single:
            parts.append("</section>")
            return "\n".join(parts)
        rows = []
        for k in self.order:
            e = self.pub.measures[k]
            _, a = self.cell(e, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": y}, "pp2", S + "-measures")
            _, kk = self.cell(e, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": y}, "pp2", S + "-measures")
            _, r = self.cell(e, "poverty_inequality", "poverty_rel_ahc_change_pp", {"year": y}, "pp2", S + "-measures")
            _, g = self.cell(e, "metrics", "gini_change", {"year": y}, "pct2", S + "-measures", "x100")
            rows.append(f'<tr><th scope="row">{esc(e.name)}</th><td class="num">{a}</td><td class="num">{kk}</td><td class="num">{r}</td><td class="num">{g}</td></tr>')
        parts.append(
            f"""<table class="keep"><caption>Each measure on its own: poverty and inequality, {fy(y)}</caption>
<thead><tr><th scope="col">Measure</th><th scope="col" class="num">Absolute BHC, pp</th><th scope="col" class="num">Children, absolute BHC, pp</th><th scope="col" class="num">Relative AHC, pp</th><th scope="col" class="num">Gini, relative change</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
</section>"""
        )
        return "\n".join(parts)

    def age(self):
        c, y, S, plt = self.pub.combined, self.year, "age", self.plt
        parts = [
            f'<section class="page" id="age"><p class="kicker">Section 5</p><h2>By age</h2>',
            f"<p>The change in the net income of the households people live in, by the person's age, in {fy(y)}. Household income is shared by everyone in the household.</p>",
        ]
        if c is None:
            parts.append(self.no_combined())
            parts.append("</section>")
            return "\n".join(parts)
        mv, ml, rows = [], [], []
        for band, label in AGE_BANDS:
            v, t = self.cell(c, "age_impact", "mean_change", {"year": y, "age_band": band}, "gbp", S)
            mv.append(v or 0.0)
            ml.append(t)
            _, b = self.cell(c, "age_impact", "pct_better_off", {"year": y, "age_band": band}, "pct1_plain", S)
            _, u = self.cell(c, "age_impact", "pct_unchanged", {"year": y, "age_band": band}, "pct1_plain", S)
            _, w = self.cell(c, "age_impact", "pct_worse_off", {"year": y, "age_band": band}, "pct1_plain", S)
            rows.append(f'<tr><th scope="row">{esc(label)}</th><td class="num">{b}</td><td class="num">{u}</td><td class="num">{w}</td></tr>')
        labels = [label for _, label in AGE_BANDS]
        fig, ax = plt.subplots(figsize=(6.8, 2.3))
        bars = ax.bar(labels, mv, color=[tone(v) for v in mv], width=0.6)
        ax.axhline(0, color=ZERO, linewidth=0.8)
        label_bars(ax, bars, ml, mv)
        ax.set_ylim(*pad_limits(mv, 0.3, 0.25))
        ax.set_ylabel("£ a year")
        minus_ticks(ax)
        style_axes(ax)
        alt = "; ".join(f"{lab}: {m}" for lab, m in zip(labels, ml))
        parts.append(self.figure(svg_of(plt, fig), f"{self.together}: average change in household net income by age, {fy(y)}", alt, "Per person, by the person's age. \"65 and over\" is an age band, not the same group as people over State Pension age."))
        parts.append(
            f"""<table class="keep"><caption>{self.together}: people better off, unchanged and worse off by age, % of people, {fy(y)}</caption>
<thead><tr><th scope="col">Age</th><th scope="col" class="num">Better off</th><th scope="col" class="num">No change</th><th scope="col" class="num">Worse off</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
</section>"""
        )
        return "\n".join(parts)

    def areas(self):
        y, S, plt = self.year, "areas", self.plt
        parts = ['<section class="page" id="areas"><p class="kicker">Section 6</p><h2>Regions and constituencies</h2>']
        con = self.pub.flat("constituency.csv")
        reg = self.pub.flat("regional.csv")
        if con is None and reg is None:
            parts.append(
                self.unavailable(
                    "<b>Results by region and constituency are not yet published in this release.</b> "
                    "They will be added to this report once they are."
                )
            )
            parts.append("</section>")
            return "\n".join(parts)
        if reg is not None:
            parts.append(self._regions(reg))
        if con is not None:
            parts.append(self._constituencies(con))
        parts.append("</section>")
        return "\n".join(parts)

    def _area_key(self, rows):
        """The run to map: the combined run if published by area, else none."""
        keys = {r["reform"] for r in rows}
        c = self.pub.combined
        if c is not None and c.key in keys:
            return c.key, "All measures together"
        return None, None

    def _regions(self, path):
        y, S = self.year, "areas"
        rows = [r for r in read_csv(path) if str(r.get("year")) == str(y) and r.get("outcome") == "average_change"]
        key, label = self._area_key(rows)
        keys = [key] if key else [k for k in self.order if any(r["reform"] == k for r in rows)]
        head = "".join(f'<th scope="col" class="num">{esc(self.name(k) if k in self.pub.measures else label)}</th>' for k in keys)
        regions = sorted({(r["area_code"], r["area_name"]) for r in rows}, key=lambda a: a[1])
        body = []
        for code, name in regions:
            cells = []
            for k in keys:
                r = next((r for r in rows if r["reform"] == k and r["area_code"] == code), None)
                if r is None or r.get("value", "") == "" or r.get("tier") == "withheld":
                    cells.append('<td class="num">withheld</td>')
                    continue
                v = float(r["value"])
                cells.append(f'<td class="num">{self.t.fig(v, "gbp", path, "value", {"reform": k, "year": y, "area_code": code, "outcome": "average_change"}, section=S)}</td>')
            body.append(f'<tr><th scope="row">{esc(name)}</th>{"".join(cells)}</tr>')
        return f"""<table class="keep compact"><caption>Average change in household net income by region, £ a year, {fy(y)}</caption>
<thead><tr><th scope="col">Region</th>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"""

    def _constituencies(self, path):
        y, S, plt = self.year, "areas", self.plt
        rows = [r for r in read_csv(path) if str(r.get("year")) == str(y) and r.get("outcome") == "relative_change"]
        key, label = self._area_key(rows)
        if key is None:
            # The two measures whose effect varies most from seat to seat
            spread = {}
            for k in self.order:
                vs = [float(r["value"]) for r in rows if r["reform"] == k and r.get("value", "") != ""]
                if len(vs) > 10:
                    spread[k] = max(vs) - min(vs)
            keys = sorted(spread, key=lambda k: -spread[k])[:2]
        else:
            keys = [key]
        if not keys:
            return self.unavailable("No constituency figures for this year.")
        geo_path = REPO / "public" / "data" / "uk_constituencies_2024.geojson"
        if not geo_path.exists():
            geo_path = self.pub.data / "uk_constituencies_2024.geojson"
        geo = json.loads(geo_path.read_text())
        from matplotlib.collections import PatchCollection
        from matplotlib.colors import BoundaryNorm, ListedColormap
        from matplotlib.patches import Polygon as MplPolygon

        out = []
        fig, axes = plt.subplots(1, len(keys), figsize=(3.4 * len(keys), 4.6), squeeze=False)
        notes = []
        for ax, k in zip(axes[0], keys):
            seats = {r["area_code"]: r for r in rows if r["reform"] == k}
            shown = {c: float(r["value"]) * 100 for c, r in seats.items() if r.get("value", "") != "" and r.get("tier") != "withheld"}
            lo, hi = min(shown.values()), max(shown.values())
            diverging = lo < 0 < hi
            if diverging:
                m = max(abs(lo), abs(hi))
                edges = [-m, -m * 0.6, -m * 0.2, m * 0.2, m * 0.6, m * 1.0001]
                colours = ["#B45309", "#FBBF24", "#F3F4F6", "#81E6D9", "#0F766E"]
            else:
                a, b = (lo, hi) if hi > 0 else (lo, hi)
                edges = [a + (b - a) * i / 5 for i in range(5)] + [b + abs(b - a) * 1e-4 + 1e-12]
                colours = ["#E6FFFA", "#B2F5EA", "#81E6D9", "#319795", "#285E61"] if hi > 0 else ["#B45309", "#D97706", "#FBBF24", "#FDE68A", "#FEF3C7"]
            norm = BoundaryNorm(edges, len(colours))
            patches, faces = [], []
            for feature in geo["features"]:
                code = feature["properties"]["GSScode"]
                g = feature["geometry"]
                rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
                face = "#FFFFFF" if code not in shown else colours[min(int(norm(shown[code])), len(colours) - 1)]
                for ring in rings:
                    patches.append(MplPolygon(ring[::3] if len(ring) > 60 else ring, closed=True))
                    faces.append(face)
            ax.add_collection(PatchCollection(patches, facecolor=faces, edgecolor="#9CA3AF", linewidth=0.08))
            ax.autoscale_view()
            ax.set_aspect("equal")
            ax.axis("off")
            title = label if k == key else self.name(k)
            ax.set_title(f"{title}\n% of household net income", fontsize=8.2)
            cbar = fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=ListedColormap(colours)), ax=ax, orientation="horizontal", fraction=0.035, pad=0.02)
            cbar.ax.tick_params(labelsize=7)
            cbar.ax.xaxis.set_major_formatter(__import__("matplotlib.ticker", fromlist=["FuncFormatter"]).FuncFormatter(lambda v, _: f"{v:.2f}".replace("-", MINUS)))
            cbar.outline.set_visible(False)
            withheld = len(seats) - len(shown)
            notes.append(
                f"{esc(title)}: {self.t.fig(len(shown), 'count', path, 'value', {'reform': k, 'year': y, 'outcome': 'relative_change', 'tier': '!withheld'}, 'count', S)} seats shown, "
                f"{self.t.fig(withheld, 'count', path, 'value', {'reform': k, 'year': y, 'outcome': 'relative_change', 'tier': 'withheld'}, 'count', S)} withheld"
            )
        fig.tight_layout(w_pad=1.0)
        png = png_of(plt, fig, dpi=170)
        out.append(
            self.figure(
                png,
                f"Average change in household net income by Westminster constituency (2024 boundaries), % of net income, {fy(y)}",
                "Map of constituencies. " + "; ".join(re.sub("<[^>]+>", "", n) for n in notes) + ".",
                "White: withheld, where the estimate is too uncertain or could disclose survey records. " + "; ".join(re.sub("<[^>]+>", "", n) for n in notes) + ". Every measure is published by constituency on the dashboard.",
                img=True,
            )
        )
        return "\n".join(out)

    def households(self):
        c, y, S, plt = self.pub.combined, self.year, "households", self.plt
        head = f'<section class="page" id="households"><p class="kicker">Section 7</p><h2>Example households</h2>'
        if c is None:
            return "\n".join([head, self.no_combined(), "</section>"])
        defs = {h["id"]: h for h in self.contract.get("income_curve_households", [])}
        rows = [r for r in c.table("income_curve") if str(r["year"]) == str(y)]
        ids = [h for h in defs if any(r["household"] == h for r in rows)] or sorted({r["household"] for r in rows})
        if not ids:
            return "\n".join([head, self.unavailable("No example households are published for this year."), "</section>"])
        n = len(ids)
        who = esc(self.together) + " changes" if self.single else "the measures together change"
        parts = [
            head,
            f"<p>How {who} the net income of {count_words(n)} example household{'s' if n != 1 else ''} in {fy(y)}, "
            "at different incomes. Each is one household, not an average; real households differ in rent, spending and circumstances.</p>",
        ]
        cols = 3 if n > 4 else n
        nrows = (n + cols - 1) // cols
        fig, axes = plt.subplots(nrows, cols, figsize=(6.9, 2.05 * nrows), squeeze=False)
        shares = (0.2, 0.4, 0.8)
        table_rows = []
        for i, h in enumerate(ids):
            ax = axes[i // cols][i % cols]
            hr = sorted((r for r in rows if r["household"] == h), key=lambda r: float(r["income"]))
            xs = [float(r["income"]) / 1000 for r in hr]
            ch = [float(r["reform_net_income"]) - float(r["baseline_net_income"]) for r in hr]
            ax.plot(xs, ch, color=HIGHLIGHT, linewidth=1.5)
            ax.axhline(0, color=ZERO, linewidth=0.7)
            ax.fill_between(xs, ch, 0, where=[v >= 0 for v in ch], color=GAIN, alpha=0.18, linewidth=0)
            ax.fill_between(xs, ch, 0, where=[v < 0 for v in ch], color=LOSS, alpha=0.25, linewidth=0)
            d = defs.get(h, {})
            ax.set_title(d.get("label", h), fontsize=8.2)
            ax.set_xlabel(f"{d.get('x_label', 'Income')}, £k", fontsize=7.2)
            ax.tick_params(labelsize=7)
            lo, hi = min(ch + [0]), max(ch + [0])
            span = (hi - lo) or 10
            ax.set_ylim(lo - span * 0.15, hi + span * 0.15)
            minus_ticks(ax)
            style_axes(ax)
            cells = []
            top = float(d.get("x_max") or max(float(r["income"]) for r in hr))
            for share in shares:
                p = top * share
                r = min(hr, key=lambda r: abs(float(r["income"]) - p))
                if abs(float(r["income"]) - p) > 1:
                    cells.append('<td class="num">n/a</td>')
                    continue
                v = float(r["reform_net_income"]) - float(r["baseline_net_income"])
                text = self.t.fig(v, "gbp", c.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
                cells.append(f'<td class="num {self._tone_cls(v)}">{text}<div class="at">at £{float(r["income"]):,.0f}</div></td>')
            table_rows.append(f'<tr><th scope="row">{esc(d.get("label", h))}<div class="def">{esc(self._definition(d))}</div></th>{"".join(cells)}</tr>')
        for j in range(n, nrows * cols):
            axes[j // cols][j % cols].axis("off")
        fig.supylabel("Change in net income, £ a year", fontsize=7.6, color=MUTED)
        fig.tight_layout(h_pad=1.2, w_pad=1.0)
        parts.append(self.figure(svg_of(plt, fig), f"{self.together}: change in net income by income, {count_words(n)} example household{'s' if n != 1 else ''}, {fy(y)}", "Line charts of the change in each household's net income as its income varies; the table below gives the values at three incomes.", "The horizontal axis is the income named under each chart, before tax; each chart has its own scale."))
        head = "".join(f'<th scope="col" class="num">{lab}</th>' for lab in ("Lower income", "Middle income", "Higher income"))
        parts.append(
            f"""<table class="keep households"><caption>{self.together}: change in net income at three incomes, £ a year, {fy(y)}</caption>
<thead><tr><th scope="col">Household</th>{head}</tr></thead><tbody>{''.join(table_rows)}</tbody></table></section>"""
        )
        return "\n".join(parts)

    @staticmethod
    def _definition(d):
        """The household as defined, without clauses about measures the dashboard can select."""
        clauses = [cl for cl in d.get("definition", "").split("; ") if "when selected" not in cl]
        text = "; ".join(clauses).strip()
        return text if text.endswith(".") else text + "."

    def measures_section(self):
        rows = []
        for k in self.order:
            e = self.pub.measures[k]
            status = "Provisional" if e.status == "provisional" else "Approved"
            extra = ""
            if e.unsupported:
                extra = f' <span class="muted">No figures for {", ".join(fy(y) for y in e.unsupported)}.</span>'
            rec = (e.entry.get("reconciliation") or {}).get("summary_status")
            rec_text = {"pass": "Matches the Treasury costing within tolerance", "awaiting_source": "Treasury costing not yet published"}.get(rec, (rec or "").replace("_", " ").capitalize())
            rows.append(
                f'<tr><th scope="row">{esc(e.name)}</th><td>{esc(e.description)}{extra}</td><td>{status}{"<br><span class=muted>" + esc(rec_text) + "</span>" if rec_text else ""}</td></tr>'
            )
        not_shown = ""
        if self.pub.not_shown:
            items = "".join(
                f"<li><b>{esc(e.get('name') or k)}</b>: {esc(e.get('reason') or NOT_SHOWN_REASONS.get(e['status'], e['status']))}</li>"
                for k, e in self.pub.not_shown
            )
            not_shown = f"<h3>Measures in the release but not shown</h3><ul>{items}</ul>"
        return f"""<section class="page" id="measures"><p class="kicker">Section 8</p><h2>The measures</h2>
<p>Each measure as modelled, in the order used throughout: those that raise revenue first, then those that cost it, each by size.</p>
<table><caption>The measures in this report</caption><thead><tr><th scope="col">Measure</th><th scope="col">What it does, as modelled</th><th scope="col">Status</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
{not_shown}</section>"""

    def method(self):
        m = self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        data = ident.get("data") or {}
        basis = m.get("basis") or {}
        fc, cal = basis.get("forecast") or {}, basis.get("calibration") or {}
        versions = ", ".join(f"{ident[k]['name']} {ident[k]['version']}" for k in ("wrapper", "model", "core") if k in ident)
        status_note = (
            f'<p class="status-inline" role="note">{esc(self.pub.provisional_label)}</p>' if self.pub.provisional else ""
        )
        forecast = (
            "The economic assumptions are the model's pre-Budget ones; they have not yet been rebased on the Budget's OBR forecast."
            if fc.get("status") == "pre_budget"
            else f"Economic assumptions: {esc(fc.get('source', ''))} ({esc(fc.get('vintage', ''))})."
        )
        prov = []
        entries = [self.pub.measures[k] for k in self.order] + ([self.pub.combined] if self.pub.combined is not None and self.pub.combined.combined else [])
        for e in entries:
            prov.append(
                f'<tr><th scope="row">{esc("All measures together" if e.combined else e.name)}</th><td>{esc(e.status)}</td><td class="mono">{esc(e.entry.get("artifact_sha256", "")[:16])}</td><td class="mono">{esc(e.entry.get("receipt_sha256", "")[:16])}</td></tr>'
            )
        commit = ""
        try:
            commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
            dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--untracked-files=no", "--", "report/", "src/utils/publication/contract.json"], capture_output=True, text=True, check=True).stdout.strip()
            if commit and dirty:
                commit += " with uncommitted changes"
        except Exception:
            pass
        return f"""<section class="page" id="method"><p class="kicker">Section 9</p><h2>Method, data and caveats</h2>
{status_note}
<h3>Model and data</h3>
<p>PolicyEngine UK, a microsimulation model of the UK tax and benefit system ({esc(versions)}), on the {esc(data.get('dataset', ''))} dataset (build {esc(data.get('build_id', ''))}). {self._runs_sentence()}, for {fy(self.years[0])} to {fy(self.years[-1])}. {forecast}</p>
<h3>What the figures leave out</h3>
<ul>
<li><b>Static costings.</b> People do not change what they earn, spend, save or claim in response to the measures, so the figures are not the OBR's post-behavioural costings.</li>
<li><b>Measures on their own and together.</b> Each measure's figures are against current law; the combined run includes how the measures interact, so its figures need not equal the sum of the measures'.</li>
<li><b>Survey data.</b> Incomes and spending come from household survey data calibrated to official totals; estimates for small groups and small areas are uncertain, and cells with too few survey households are withheld.</li>
</ul>
<h3>Provenance</h3>
<p>Publication manifest revision {esc(m.get('revision', ''))}, updated {esc(long_date(m.get('updated_at', '')))}. Each artifact's files were checked against its receipt when this report was built. The first 16 characters of each digest:</p>
<table class="compact keep"><caption>Artifacts behind this report</caption><thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Artifact</th><th scope="col">Receipt</th></tr></thead><tbody>{''.join(prov)}</tbody></table>
<p class="note">Built by <code>report/build_report.py</code>{' at ' + esc(commit) if commit else ''} from <code>manifest.json</code> and the artifacts it names. Every figure in this report, with the file, row and column it came from, is in the accompanying <code>figures.json</code>. The dashboard: policyengine.org/uk/autumn-budget-2026.</p>
</section>"""

    def _runs_sentence(self):
        if self.single:
            return "The measure is simulated against current law"
        if self.pub.combined is None:
            return "Each measure is simulated on its own against current law; no combined run covers exactly these measures"
        return "Each measure is simulated on its own against current law, and all of them together in one combined run"

    def build(self) -> str:
        body = [
            self.cover(),
            self.summary(),
            self.revenue(),
            self.deciles(),
            self.winners(),
            self.poverty(),
            self.age(),
            self.areas(),
            self.households(),
            self.measures_section(),
            self.method(),
        ]
        body = [keep_lead(part) for part in body]
        watermark = '<div class="watermark" aria-hidden="true">Provisional</div>' if self.pub.provisional else ""
        css = (HERE / "report.css").read_text()
        fonts = "".join(
            f"@font-face{{font-family:Inter;font-style:normal;font-weight:{w};src:url(data:font/woff2;base64,"
            f"{base64.b64encode((HERE / 'fonts' / f'inter-latin-{w}-normal.woff2').read_bytes()).decode()}) format('woff2');}}"
            for w in (400, 600, 700)
        )
        return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>{esc(self.title)}</title>
<meta name="author" content="PolicyEngine">
<meta name="description" content="{esc(self.title)}: figures for {fy(self.year)} from publication manifest revision {esc(self.pub.manifest.get('revision', ''))}">
<style>{fonts}
{css}</style></head><body>
{watermark}
{''.join(body)}
</body></html>"""


def keep_lead(section: str) -> str:
    """Keep a section's heading and introduction on the page of its first figure,
    table or notice (Chrome does not honour break-after: avoid on headings)."""
    if 'id="summary"' in section:
        return section
    match = re.search(r'<p class="kicker">.*?(</figure>|</table>|</p></div>)', section, flags=re.S)
    if not match or "</section>" in match.group(0):
        return section
    return section[: match.start()] + '<div class="keep">' + match.group(0) + "</div>" + section[match.end():]


def footer(pub: Publication, title: str) -> str:
    status = f" · {esc(pub.provisional_label)}" if pub.provisional else ""
    return (
        '<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:7pt;color:#4B5563;width:100%;'
        'padding:0 16mm;display:flex;justify-content:space-between">'
        f"<span>PolicyEngine · {esc(title)}{status}</span>"
        '<span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
    )


def to_pdf(html_path: Path, pdf_path: Path, footer_html: str, chrome: str | None):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        kwargs = {"executable_path": chrome} if chrome else {"channel": "chrome"}
        browser = p.chromium.launch(**kwargs)
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri(), wait_until="load")
        page.evaluate("document.fonts.ready")
        page.pdf(
            path=str(pdf_path),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            display_header_footer=True,
            header_template="<span></span>",
            footer_template=footer_html,
            tagged=True,
            outline=True,
        )
        browser.close()


# --- Check --------------------------------------------------------------


def check(figures_path: Path, data: Path) -> int:
    """Recompute every traced figure from its file and compare the text."""
    items = json.loads(figures_path.read_text())["figures"]
    cache = {}
    bad = 0
    for item in items:
        path = data / item["file"]
        if path not in cache:
            cache[path] = read_csv(path)
        where = item["where"]

        def matches(r):
            for k, v in where.items():
                if k == "year" and isinstance(v, list):
                    if int(r["year"]) not in v:
                        return False
                elif isinstance(v, str) and v.startswith("!"):
                    if r.get(k) == v[1:]:
                        return False
                elif str(r.get(k)) != str(v):
                    return False
            return True

        rows = [r for r in cache[path] if matches(r)]
        if item["transform"] == "count":
            if item["where"].get("tier") == "!withheld":
                rows = [r for r in rows if r.get("value", "") != ""]
            value = float(len(rows))
        else:
            col = item["column"]
            if "-" in col:
                a, b = col.split("-")
                xs = [float(r[a]) - float(r[b]) for r in rows]
            else:
                xs = [float(r[col]) for r in rows]
            years = where.get("year") if isinstance(where.get("year"), list) else None
            if not xs or (item["transform"] != "sum" and len(xs) != 1) or (years is not None and len(xs) != len(years)):
                print(f"NO UNIQUE ROW: {item}")
                bad += 1
                continue
            value = TRANSFORMS[item["transform"]](xs)
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
    b.add_argument("--title", default="Autumn Budget 2026: the measures modelled")
    b.add_argument("--pdf", action="store_true", help="print report.pdf with Chrome (needs playwright)")
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
                "figures": report.t.items,
            },
            indent=1,
            ensure_ascii=False,
        )
    )
    print(f"wrote {args.out / 'report.html'} and figures.json ({len(report.t.items)} figures)")
    if args.pdf:
        to_pdf(args.out / "report.html", args.out / "report.pdf", footer(pub, args.title), args.chrome)
        print(f"wrote {args.out / 'report.pdf'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
