"""verify_household_skips.py's check, fanned out on Modal instead of the
laptop: each (household, year) case in its own container, skips against the
full run. No survey data and no Hugging Face token (synthetic households).

An ephemeral app (``modal run``, never deployed): at most 12 containers, no
retries, nothing kept warm, a 15-minute limit per case.

    uv run --with modal modal run scripts/modal_verify_household_skips.py \
        --households 40 --years 2027,2028,2029,2030,2031
"""

import json
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]


def build_image() -> modal.Image:
    if not modal.is_local():
        return modal.Image.debian_slim()
    return (
        modal.Image.debian_slim(
            python_version=(ROOT / ".python-version").read_text().strip()
        )
        .uv_sync(str(ROOT), frozen=True)
        .env({"NUMEXPR_MAX_THREADS": "1", "OMP_NUM_THREADS": "1"})
        .workdir("/root")
        .add_local_dir(str(ROOT / "data_inputs"), "/root/data_inputs")
        .add_local_dir(
            str(ROOT / "src" / "uk_budget_data"),
            "/root/uk_budget_data",
            ignore=["**/__pycache__/**"],
        )
        .add_local_file(
            str(ROOT / "scripts" / "verify_household_skips.py"),
            "/root/verify_household_skips.py",
        )
    )


app = modal.App("uk-budget-household-skip-check", image=build_image())


@app.function(cpu=1.0, memory=2048, timeout=900, max_containers=12, retries=0)
def check(args: tuple) -> dict:
    import traceback

    from verify_household_skips import case

    index, kw, year = args
    try:
        year, skipped_ids, bad = case((dict(kw), year))
        return {"i": index, "year": year, "skipped": skipped_ids, "bad": bad}
    except Exception:
        return {"i": index, "year": year, "error": traceback.format_exc()[-1500:]}


@app.local_entrypoint()
def main(households: int = 40, years: str = "2027,2028,2029,2030,2031"):
    from verify_household_skips import gen

    year_list = [int(y) for y in years.split(",")]
    cases = [
        (i, kw, y) for i, kw in enumerate(gen(households)) for y in year_list
    ]
    started = time.perf_counter()
    results = list(check.map(cases, order_outputs=False))
    errors = [r for r in results if "error" in r]
    mismatches = [r for r in results if r.get("bad")]
    skipped = sum(len(r.get("skipped", [])) for r in results)
    summary = {
        "households": households,
        "years": year_list,
        "cases": len(cases),
        "per_policy_runs": 9 * len(cases),
        "skipped": skipped,
        "mismatches": len(mismatches),
        "mismatch_detail": mismatches[:20],
        "errors": len(errors),
        "error_detail": errors[:3],
        "seconds": round(time.perf_counter() - started),
    }
    print(json.dumps(summary, indent=1))
    Path("skip_check_result.json").write_text(json.dumps(summary, indent=1))
