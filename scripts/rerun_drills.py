"""Rerun the four mock-Budget drills on the latest engine and compare.

MOCK DATA. Each drill (PRs #4, #7, #9, #52) registered its mock measures
(ids prefixed ``mock*_``) and committed its drill-day flat national CSVs in
``public/data``. This script:

1. ``setup``: makes a detached git worktree of each drill's final scoring
   commit, applies the minimal fixes the drill needs to run on the latest
   policyengine (listed in ``DRILLS[...]["fixes"]``), then
   ``uv lock --upgrade-package policyengine && uv sync``.
2. ``run``: regenerates the flat national tables (budgetary_impact,
   distributional_impact, winners_losers, metrics) for each drill's
   ``mock*_`` measures and years, one drill at a time, on the certified
   Microcosm national file. Geography is skipped. Before each drill it
   waits until swap is under the limit and no other ``uk-budget-data
   generate`` is running. Each run is timed with ``/usr/bin/time -l``
   (peak RSS) and logged.
3. ``compare``: reads the drill-day CSVs and filled national sheets straight
   from git (``git show <sha>:<path>``), reads the rerun CSVs, and writes
   ``comparison.csv`` plus per-drill summaries.

It never reads any sealed folder or answer key: drill-day figures come only
from the committed flat CSVs and the filled national scoring sheets.

Usage (from the repository root)::

    export HUGGING_FACE_TOKEN=$(cat ~/.cache/huggingface/token)
    export RERUN_DATASET=/path/to/microcosm_uk_2024_25.h5   # sha256 810ba980...
    uv run python scripts/rerun_drills.py setup --work-dir /tmp/drill-rerun
    uv run python scripts/rerun_drills.py run --work-dir /tmp/drill-rerun
    uv run python scripts/rerun_drills.py compare --work-dir /tmp/drill-rerun \
        --out docs/drill-reruns/2026-10-24
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

PINNED_SHA256 = (
    "810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece"
)
PINNED_RELEASE = "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71"
TARGET = {
    "policyengine": "6.10.2",
    "policyengine-uk": "2.132.6",
    "policyengine-core": "3.33.3",
}
SWAP_LIMIT_GB = 30.0
POLL_SECONDS = 180
# Only a real Python generate process counts: a shell or pgrep loop whose own
# command line merely mentions "uk-budget-data generate" must not match.
OTHER_JOB_PATTERN = r"python[0-9.]*\s+\S*bin/uk-budget-data generate"

# Pins for drills 2 and 3: they pin exact engine versions in pyproject.toml
# and check them (and the dataset hash) at runtime in drill_setup.py, so
# `uv lock --upgrade-package policyengine` alone cannot move them.
_PIN_FIXES = [
    ("pyproject.toml", r'"policyengine==6\.2\.\d+"', '"policyengine==6.10.2"'),
    (
        "pyproject.toml",
        r'"policyengine-uk==2\.\d+\.\d+"',
        '"policyengine-uk==2.132.6"',
    ),
    (
        "pyproject.toml",
        r'"policyengine-core==3\.\d+\.\d+"',
        '"policyengine-core==3.33.3"',
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r'^MODEL_VERSION = ".*"$',
        'MODEL_VERSION = "2.132.6"',
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r'^CORE_VERSION = ".*"$',
        'CORE_VERSION = "3.33.3"',
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r'^DATASET_BUILD_MODEL_VERSION = ".*"$',
        'DATASET_BUILD_MODEL_VERSION = "2.132.6"',
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r"aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af",
        PINNED_SHA256,
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r'^DATASET_REVISION = ".*"$',
        f'DATASET_REVISION = "{PINNED_RELEASE}"',
    ),
    (
        "src/uk_budget_data/drill_setup.py",
        r'^DATASET_RELEASE = ".*"$',
        f'DATASET_RELEASE = "{PINNED_RELEASE}"',
    ),
]

DRILLS = {
    "d1": {
        "drill": 1,
        "pr": 4,
        "sha": "1b2d8bd9216ded58707dee660bf95234824c0471",
        "data_sha": "3b0eab7",
        "years": [2026, 2027, 2028, 2029, 2030],
        "prefix": "mock_",
        "runner": "generate",
        "drill_day_engine": "policyengine 6.0.0 / policyengine-uk 2.90.2 / core 3.32.5",
        "drill_day_dataset": "policyengine 6.0.0 bundle default (certified enhanced FRS); no --dataset was passed",
        "fixes": [],
        "sheet": None,
    },
    "d2": {
        "drill": 2,
        "pr": 7,
        "sha": "e05274b",
        "data_sha": "e05274b",
        "years": [2026, 2027, 2028, 2029, 2030],
        "prefix": "mock2_",
        "runner": "generate",
        "drill_day_engine": "policyengine 6.2.1 / policyengine-uk 2.120.0 / core 3.32.17",
        "drill_day_dataset": "Microcosm national aa31bdf6 (microcosm-uk-2024-25-national-20261002T230158Z-5c6b3f68)",
        "fixes": _PIN_FIXES,
        "sheet": {
            "path": "data_inputs/mock_drill2/MOCK-drill2-reconciliation.csv",
            "key": "measure_no",
            "unit": 1.0,
            "static": "costing_static_bn",
            "post": "table41_post_behavioural_bn",
            "team": "our_static_bn",
            "map": {
                "1": "mock2_fuel_duty_hold",
                "2": "mock2_electricity_vat_zero",
                "3": "mock2_energy_price_payment",
                "4": "mock2_state_pension_personal_allowance",
                "5": "mock2_employer_ni_threshold",
                "6": "mock2_cgt_rates",
                "7": "mock2_hvcts_band",
                "8": "mock2_state_pension_uprating",
            },
        },
    },
    "d3": {
        "drill": 3,
        "pr": 9,
        "sha": "8aef1c1",
        "data_sha": "8aef1c1",
        "years": [2026, 2027, 2028, 2029, 2030, 2031],
        "prefix": "mock3_",
        "runner": "generate",
        "drill_day_engine": "policyengine 6.2.7 / policyengine-uk 2.125.1 / core 3.33.0",
        "drill_day_dataset": "Microcosm national aa31bdf6 (microcosm-uk-2024-25-national-20261002T230158Z-5c6b3f68)",
        "fixes": _PIN_FIXES,
        "sheet": {
            "path": "data_inputs/mock_drill3/MOCK-drill3-national-scoring-run2.csv",
            "key": "measure_no",
            "unit": 1e-3,
            "static": "costing_static_m",
            "post": "table41_post_m",
            "team": "team_figure_m",
            "map": {
                "1": "mock3_threshold_freeze_2032",
                "2": "mock3_pensioner_allowance",
                "3": "mock3_whd_top_up",
                "4": "mock3_cgt_higher_rate_aea",
                "5": "mock3_employer_ni_under_22",
                "6": "mock3_hvcts_top_bands",
                "7": "mock3_additional_rate_threshold",
                "8": "mock3_lha_30th_percentile",
                "9": "mock3_fuel_duty_phasing",
                "10": "mock3_class4_main_rate",
                "20": "mock3_salary_sacrifice_cap",
            },
        },
    },
    "d4": {
        "drill": 4,
        "pr": 52,
        "sha": "ab79af1",
        "data_sha": "ab79af1",
        "years": [2026, 2027, 2028, 2029, 2030, 2031],
        "prefix": "mock4_",
        "runner": "drill4",
        "drill_day_engine": "policyengine 6.7.6 / policyengine-uk 2.130.1 / core 3.33.0",
        "drill_day_dataset": f"Microcosm national 810ba980 ({PINNED_RELEASE})",
        "fixes": [],
        "sheet": {
            "path": "data_inputs/mock_drill4/filled/MOCK-drill4-national-scoring.csv",
            "key": "line_no",
            "unit": 1e-3,
            "static": "costing_static_m",
            "post": "table41_post_m",
            "team": "team_figure_m",
            "map": {
                "1": "mock4_threshold_freeze_2032",
                "3": "mock4_state_pension_topup_allowance",
                "4": "mock4_whd_topup",
                "5": "mock4_fuel_duty",
                "7": "mock4_savings_starting_band",
                "8": "mock4_cgt_higher_rate",
                "11": "mock4_lha_reset",
                "12": "mock4_employer_ni_under23",
                "14": "mock4_uc_child_element",
                "17": "mock4_cb_early_years_addition",
                "18": "mock4_fuel_vat_cut",
                "21": "mock4_carers_allowance_limit",
            },
        },
    },
}

# Measures whose rerun figure is not a valid score on the new engine. The
# drills 1-3 fuel measures set the duty rate with month-dated ranges
# ("2027-01-01.2027-01-31": rate); on policyengine-uk 2.132.6 these leave the
# baseline and reform rates identical (see
# docs/drill-reruns/2026-10-24/probe_monthly_fuel_duty.py), so only the
# pump-VAT modifier is scored. Drill 4 uses open-ended dated steps, which
# still apply.
RERUN_INVALID = {
    "mock_fuel_duty_freeze": "duty change dropped by engine (month-dated ranges); VAT modifier only",
    "mock2_fuel_duty_hold": "duty change dropped by engine (month-dated ranges); VAT modifier only",
    "mock3_fuel_duty_phasing": "duty change dropped by engine (month-dated ranges); VAT modifier only",
}

TABLES = [
    "budgetary_impact",
    "distributional_impact",
    "winners_losers",
    "metrics",
]


def sh(cmd, cwd=None, **kw):
    print("+", " ".join(map(str, cmd)), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=True, **kw)


def git_show_csv(sha: str, path: str, skiprows: int = 0):
    import pandas as pd

    text = subprocess.run(
        ["git", "show", f"{sha}:{path}"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return pd.read_csv(io.StringIO(text), skiprows=skiprows)


def sha256(path: Path) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


# ---------------------------------------------------------------- setup


def cmd_setup(args) -> None:
    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    sh(["git", "fetch", "origin", "--quiet"], cwd=REPO)
    for key in args.drills:
        cfg = DRILLS[key]
        wt = work / key
        if not wt.exists():
            sh(
                ["git", "worktree", "add", "--detach", str(wt), cfg["sha"]],
                cwd=REPO,
            )
        for rel, pattern, repl in cfg["fixes"]:
            target = wt / rel
            text = target.read_text()
            new = re.sub(pattern, repl, text, flags=re.M)
            target.write_text(new)
        sh(["uv", "lock", "--upgrade-package", "policyengine"], cwd=wt)
        sh(["uv", "sync"], cwd=wt)
        out = subprocess.run(
            [
                str(wt / ".venv/bin/python"),
                "-c",
                "from importlib.metadata import version as v;"
                "import json;print(json.dumps({p: v(p) for p in "
                "('policyengine','policyengine-uk','policyengine-core')}))",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        installed = json.loads(out)
        if installed != TARGET:
            sys.exit(f"{key}: installed {installed}, expected {TARGET}")
        print(f"{key}: {installed}")


# ------------------------------------------------------------------ run


def swap_used_gb() -> float:
    out = subprocess.run(
        ["sysctl", "vm.swapusage"], capture_output=True, text=True
    ).stdout
    m = re.search(r"used = ([\d.]+)M", out)
    return float(m.group(1)) / 1024 if m else 0.0


def _own_tree() -> set[str]:
    """This process, its ancestors and its descendants."""
    out = subprocess.run(
        ["ps", "-axo", "pid=,ppid="], capture_output=True, text=True
    ).stdout
    parent = {}
    for line in out.splitlines():
        pid, ppid = line.split()
        parent[pid] = ppid
    me = str(os.getpid())
    tree = {me}
    p = me
    while p in parent and parent[p] not in tree and parent[p] != "0":
        p = parent[p]
        tree.add(p)
    changed = True
    while changed:
        changed = False
        for pid, ppid in parent.items():
            if ppid in tree and pid not in tree:
                tree.add(pid)
                changed = True
    return tree


def other_jobs() -> list[str]:
    out = subprocess.run(
        ["ps", "-axo", "pid=,command="], capture_output=True, text=True
    ).stdout
    own = _own_tree()
    jobs = []
    for line in out.splitlines():
        pid, _, command = line.strip().partition(" ")
        if pid in own:
            continue
        if re.search(OTHER_JOB_PATTERN, command):
            jobs.append(line.strip()[:160])
    return jobs


def wait_for_capacity(wait_for_jobs: bool) -> None:
    """Start only when swap is under the limit.

    Other generate processes are reported; they block the start only with
    ``--wait-for-jobs``. A run already going is never interrupted.
    """
    while True:
        swap = swap_used_gb()
        jobs = other_jobs()
        if swap < SWAP_LIMIT_GB and not (wait_for_jobs and jobs):
            print(
                f"capacity OK: swap {swap:.1f} GB; other generates: {len(jobs)}",
                flush=True,
            )
            return
        print(
            f"{datetime.now():%H:%M:%S} waiting: swap {swap:.1f} GB; "
            f"other jobs: {jobs or 'none'}",
            flush=True,
        )
        time.sleep(POLL_SECONDS)


def drill_reform_ids(key: str) -> list[str]:
    cfg = DRILLS[key]
    df = git_show_csv(cfg["data_sha"], "public/data/budgetary_impact.csv")
    ids = sorted(
        {r for r in df["reform_id"] if str(r).startswith(cfg["prefix"])}
    )
    return ids


def cmd_run(args) -> None:
    work = Path(args.work_dir)
    dataset = Path(os.environ.get("RERUN_DATASET", "")).expanduser()
    if not dataset.is_file():
        sys.exit("set RERUN_DATASET to the pinned Microcosm national file")
    actual = sha256(dataset)
    if actual != PINNED_SHA256:
        sys.exit(
            f"refused: {dataset} sha256 {actual}, expected {PINNED_SHA256}"
        )
    if not os.environ.get("HUGGING_FACE_TOKEN"):
        sys.exit("set HUGGING_FACE_TOKEN")
    log_path = work / "runs.json"
    runs = json.loads(log_path.read_text()) if log_path.exists() else {}
    for key in args.drills:
        cfg = DRILLS[key]
        wt = work / key
        out_dir = work / "out" / key
        out_dir.mkdir(parents=True, exist_ok=True)
        ids = drill_reform_ids(key)
        years = [str(y) for y in cfg["years"]]
        common = [
            "--output-dir",
            str(out_dir),
            "--reforms",
            *ids,
            "--years",
            *years,
            "--skip-input-check",
        ]
        env = dict(os.environ)
        if cfg["runner"] == "drill4":
            env["DRILL4_DATASET"] = str(dataset)
            cmd = ["bash", "scripts/drill4_generate.sh", *common]
        else:
            cmd = [
                "uv",
                "run",
                "--no-sync",
                "uk-budget-data",
                "generate",
                *common,
                "--dataset",
                str(dataset),
            ]
        wait_for_capacity(args.wait_for_jobs)
        logfile = work / f"{key}.log"
        started = datetime.now(timezone.utc)
        t0 = time.monotonic()
        with open(logfile, "w") as log:
            proc = subprocess.run(
                ["/usr/bin/time", "-l", *cmd],
                cwd=wt,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        elapsed = time.monotonic() - t0
        text = logfile.read_text(errors="replace")
        m = re.search(r"(\d+)\s+maximum resident set size", text)
        peak = int(m.group(1)) / 1024**3 if m else None
        runs[key] = {
            "drill": cfg["drill"],
            "code_sha": cfg["sha"],
            "reform_ids": ids,
            "years": cfg["years"],
            "command": " ".join(cmd),
            "started_utc": started.isoformat(timespec="seconds"),
            "wall_seconds": round(elapsed, 1),
            "peak_rss_gb": round(peak, 2) if peak else None,
            "exit_code": proc.returncode,
            "dataset": str(dataset),
            "dataset_sha256": actual,
        }
        log_path.write_text(json.dumps(runs, indent=2))
        print(
            f"{key}: exit {proc.returncode}, {elapsed/60:.1f} min, peak RSS {peak} GB",
            flush=True,
        )


# -------------------------------------------------------------- compare


def _pct(new, old):
    if old is None or new is None:
        return None
    if abs(old) < 1e-9:
        return 0.0 if abs(new) < 1e-9 else None
    return (new - old) / abs(old) * 100


def _sheet(key: str):
    import pandas as pd

    cfg = DRILLS[key]["sheet"]
    if cfg is None:
        return {}
    df = git_show_csv(DRILLS[key]["sha"], cfg["path"], skiprows=1)
    out = {}
    for _, row in df.iterrows():
        rid = cfg["map"].get(str(row[cfg["key"]]).strip())
        if rid is None:
            continue
        fy = str(row["fiscal_year"]).strip()
        year = int(fy[:4])

        def val(col):
            v = pd.to_numeric(row.get(col), errors="coerce")
            return None if pd.isna(v) else float(v) * cfg["unit"]

        out[(rid, year)] = {
            "fiscal_year": fy,
            "official_static_bn": val(cfg["static"]),
            "official_post_bn": val(cfg["post"]),
            "sheet_team_bn": val(cfg["team"]),
        }
    return out


def _tables(read):
    b = read("budgetary_impact")
    w = read("winners_losers")
    m = read("metrics")
    w["decile"] = w["decile"].astype(str)
    return b, w, m


def cmd_compare(args) -> None:
    import pandas as pd

    work = Path(args.work_dir)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for key in args.drills:
        cfg = DRILLS[key]
        old_b, old_w, old_m = _tables(
            lambda t: git_show_csv(cfg["data_sha"], f"public/data/{t}.csv")
        )
        new_b, new_w, new_m = _tables(
            lambda t: pd.read_csv(work / "out" / key / f"{t}.csv")
        )
        sheet = _sheet(key)
        ids = drill_reform_ids(key)

        def pick(df, rid, year, col, decile=None):
            sel = (df["reform_id"] == rid) & (df["year"] == year)
            if decile is not None:
                sel &= df["decile"] == decile
            v = df.loc[sel, col]
            return None if v.empty else float(v.iloc[0])

        for rid in ids:
            names = old_b.loc[old_b["reform_id"] == rid, "reform_name"]
            for year in cfg["years"]:
                old_rev = pick(old_b, rid, year, "value")
                new_rev = pick(new_b, rid, year, "value")
                row = {
                    "drill": cfg["drill"],
                    "measure_id": rid,
                    "measure_name": names.iloc[0] if len(names) else "",
                    "rerun_note": RERUN_INVALID.get(rid, ""),
                    "year": year,
                    "revenue_bn_drill_day": old_rev,
                    "revenue_bn_rerun": new_rev,
                    "revenue_bn_diff": (
                        None
                        if old_rev is None or new_rev is None
                        else new_rev - old_rev
                    ),
                    # Signed: positive = the rerun raises more (or costs less).
                    "revenue_pct_diff": _pct(new_rev, old_rev),
                    # Size of the measure: negative = the rerun scores it smaller.
                    "magnitude_pct_diff": (
                        None
                        if old_rev is None or new_rev is None
                        else _pct(abs(new_rev), abs(old_rev))
                    ),
                }
                for d in ("1", "5", "10"):
                    row[f"d{d}_avg_change_drill_day"] = pick(
                        old_w, rid, year, "avg_change", d
                    )
                    row[f"d{d}_avg_change_rerun"] = pick(
                        new_w, rid, year, "avg_change", d
                    )
                row["people_affected_pct_drill_day"] = pick(
                    old_m, rid, year, "people_affected"
                )
                row["people_affected_pct_rerun"] = pick(
                    new_m, rid, year, "people_affected"
                )
                s = sheet.get((rid, year), {})
                row["fiscal_year_in_sheet"] = s.get("fiscal_year")
                row["official_static_bn"] = s.get("official_static_bn")
                row["official_post_behavioural_bn"] = s.get("official_post_bn")
                row["sheet_team_figure_bn"] = s.get("sheet_team_bn")
                off = s.get("official_static_bn")
                if (
                    off is not None
                    and old_rev is not None
                    and new_rev is not None
                    and abs(off) > 1e-9
                ):
                    gap_old = abs(old_rev - off)
                    gap_new = abs(new_rev - off)
                    row["vs_official_static"] = (
                        "unchanged"
                        if abs(gap_new - gap_old) < 0.0005
                        else "closer" if gap_new < gap_old else "further"
                    )
                else:
                    row["vs_official_static"] = None
                rows.append(row)
    df = pd.DataFrame(rows)
    df.to_csv(out / "comparison.csv", index=False, float_format="%.6g")

    # Per-drill summary: median absolute % difference over cells where the
    # drill-day revenue is material (|value| >= £0.01bn).
    summary = []
    for drill, g in df.groupby("drill"):
        mat_all = g[g["revenue_bn_drill_day"].abs() >= 0.01]
        mat = mat_all[mat_all["rerun_note"] == ""]
        top = mat.reindex(
            mat["revenue_bn_diff"].abs().sort_values(ascending=False).index
        ).head(3)
        summary.append(
            {
                "drill": drill,
                "cells": len(g),
                "material_cells": len(mat_all),
                "invalid_cells_excluded": len(mat_all) - len(mat),
                "median_abs_pct_diff": (
                    float(mat["magnitude_pct_diff"].abs().median())
                    if len(mat)
                    else None
                ),
                "max_abs_pct_diff": (
                    float(mat["magnitude_pct_diff"].abs().max())
                    if len(mat)
                    else None
                ),
                "largest_movers": "; ".join(
                    f"{r.measure_id} {r.year}: {r.revenue_bn_drill_day:+.3f} -> {r.revenue_bn_rerun:+.3f}bn"
                    for r in top.itertuples()
                ),
                "closer_to_official": int(
                    (
                        (g["vs_official_static"] == "closer")
                        & (g["rerun_note"] == "")
                    ).sum()
                ),
                "further_from_official": int(
                    (
                        (g["vs_official_static"] == "further")
                        & (g["rerun_note"] == "")
                    ).sum()
                ),
            }
        )
    pd.DataFrame(summary).to_csv(
        out / "summary.csv", index=False, float_format="%.4g"
    )
    print(pd.DataFrame(summary).to_string())


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("setup", "run", "compare"):
        sp = sub.add_parser(name)
        sp.add_argument("--work-dir", required=True)
        sp.add_argument(
            "--drills", nargs="+", default=list(DRILLS), choices=list(DRILLS)
        )
        if name == "run":
            sp.add_argument(
                "--wait-for-jobs",
                action="store_true",
                help="also wait until no other generate is running",
            )
        if name == "compare":
            sp.add_argument("--out", default="docs/drill-reruns/2026-10-24")
    args = p.parse_args()
    {"setup": cmd_setup, "run": cmd_run, "compare": cmd_compare}[args.cmd](
        args
    )


if __name__ == "__main__":
    main()
