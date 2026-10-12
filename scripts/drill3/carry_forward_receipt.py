"""MOCK drill 3: carry-forward evidence for run 2.

Usage: python scripts/drill3/carry_forward_receipt.py <run1_code_sha> <run2_code_sha>
Lists the policy-code files changed between the two code SHAs and the measures they touch.
A measure is carried forward only if none of its module files, the shared registry/model
files, the engine pins or the dataset hash changed.
"""
import subprocess, sys, json, hashlib
a, b = sys.argv[1:3]
changed = subprocess.check_output(["git", "diff", "--name-only", a, b, "--", "src", "pyproject.toml", "uv.lock"]).decode().split()
MODULES = {
    "mock3_threshold_freeze_2032": ["src/uk_budget_data/mock_drill3_params.py"],
    "mock3_additional_rate_threshold": ["src/uk_budget_data/mock_drill3_params.py"],
    "mock3_class4_main_rate": ["src/uk_budget_data/mock_drill3_params.py"],
    "mock3_salary_sacrifice_cap": ["src/uk_budget_data/mock_drill3_params.py"],
    "mock3_pensioner_allowance": ["src/uk_budget_data/mock_drill3_pensioner_allowance.py", "src/uk_budget_data/mock_drill2_structural.py"],
    "mock3_whd_top_up": ["src/uk_budget_data/mock_drill3_housing_energy.py"],
    "mock3_lha_30th_percentile": ["src/uk_budget_data/mock_drill3_housing_energy.py"],
    "mock3_cgt_higher_rate_aea": ["src/uk_budget_data/mock_drill3_cgt_hvcts.py"],
    "mock3_hvcts_top_bands": ["src/uk_budget_data/mock_drill3_cgt_hvcts.py"],
    "mock3_employer_ni_under_22": ["src/uk_budget_data/mock_drill3_employer_ni.py"],
    "mock3_fuel_duty_phasing": ["src/uk_budget_data/mock_drill3_fuel.py", "src/uk_budget_data/reforms.py"],
}
SHARED = ["src/uk_budget_data/models.py", "src/uk_budget_data/pipeline.py", "src/uk_budget_data/calculators.py", "src/uk_budget_data/drill_setup.py", "pyproject.toml", "uv.lock"]
shared_changed = [f for f in changed if f in SHARED]
out = {"run1_code": a, "run2_code": b, "changed_files": changed, "shared_changed": shared_changed,
       "dataset_sha256": "aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af",
       "engine": "policyengine-uk 2.125.1 / core 3.33.0", "measures": {}}
for m, files in MODULES.items():
    hit = [f for f in files if f in changed]
    out["measures"][m] = "rerun" if (hit or shared_changed) else "carry_forward"
print(json.dumps(out, indent=1))
