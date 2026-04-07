"""
generate_all_contracts.py  —  VLDB-2026
Runs contract_generator.py for all 14 XACML/terms pairs.

Place this file in the same directory as contract_generator.py:
    XACML/
        contract_generator.py
        generate_all_contracts.py
        XACML policies/   <-- xml files here
        Terms/            <-- json files here

Generated .sol files go to:
    blockchain/contracts/

Usage:
    python generate_all_contracts.py
"""

import subprocess
import sys
import os
import shutil
import re

# ─── Config ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
XACML_DIR  = os.path.join(SCRIPT_DIR, "XACML policies")
TERMS_DIR  = os.path.join(SCRIPT_DIR, "Terms")
OUTPUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "blockchain", "contracts"))
GENERATOR  = os.path.join(SCRIPT_DIR, "contract-generator.py")

FILES = [
    # Datasets
    "SEER_Cancer_Registry_of_USA",
    "German_Cancer_registry@2020",
    "National_Cancer_Registry_of_Pakistan",
    "UCI_diabetic_dataset",
    "Sylhet_Diabetes_Hospital_Bangladesh",
    "Pima_Indians_Diabetes_USA",
    "heart_failure_clinical_records_dataset",
    # Models
    "cox_model@2020",
    "kaplan_meier_model@2020",
    "xgboost_risk_model@2025",
    "random_survival_forest@2025",
    "mlp_cancer_classifier@2025",
    "lstm_readmission_model@2026",
    "google_Health_Cancer_Prediction_Model",
]

# ─── Run ──────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    passed = []
    failed = []

    print(f"{'='*65}")
    print(f"  Generating {len(FILES)} contracts")
    print(f"  XACML dir : {XACML_DIR}")
    print(f"  Terms dir : {TERMS_DIR}")
    print(f"  Output    : {OUTPUT_DIR}")
    print(f"{'='*65}\n")

    for name in FILES:
        xacml = os.path.join(XACML_DIR, f"{name}.xml")
        terms = os.path.join(TERMS_DIR,  f"{name}.json")

        missing = []
        if not os.path.exists(xacml): missing.append(xacml)
        if not os.path.exists(terms): missing.append(terms)
        if missing:
            print(f"  ❌  {name}")
            for m in missing:
                print(f"       Missing: {m}")
            failed.append(name)
            continue

        result = subprocess.run(
            [sys.executable, GENERATOR, xacml, terms],
            capture_output=True,
            text=True,
            cwd=SCRIPT_DIR,   # always run from SCRIPT_DIR so .sol lands there
        )

        if result.returncode == 0:
            sol_name = f"smart-contract-{re.sub(r'[^a-zA-Z0-9_]', '_', name)}.sol"
            src = os.path.join(SCRIPT_DIR, sol_name)   # absolute path to generated file
            dst = os.path.join(OUTPUT_DIR, sol_name)

            if os.path.exists(src):
                shutil.move(src, dst)
                print(f"  ✅  {name}")
                print(f"       → {dst}")
                passed.append(name)
            else:
                print(f"  ❌  {name} — .sol not found at {src}")
                print(f"       generator output: {result.stdout.strip()}")
                failed.append(name)
        else:
            print(f"  ❌  {name}")
            print(f"       {result.stderr.strip() or result.stdout.strip()}")
            failed.append(name)

    print(f"\n{'='*65}")
    print(f"  {len(passed)}/{len(FILES)} contracts generated successfully")
    if failed:
        print(f"\n  Failed:")
        for f in failed:
            print(f"    • {f}")
    print(f"{'='*65}")


if __name__ == "__main__":
    main()