"""
cox_model_v2025.py  – **patched 2025-05-19**
========================================================
**Enhanced to handle both SEER and German datasets correctly**

This version improves handling of different datasets:
1. Better column mapping between SEER and German datasets
2. Proper group comparison for standalone German dataset
3. Enhanced detection of time/event columns

Example output
-------------------
{
  "summary": [...],
  "baseline": {...},
  "group_labels": {...},
  "pretty_table": {
    "Filter1": "age 40-50",
    "Filter2": "PR=1",
    "Filter3": "laterality=1",
    "Groups Compared": "SEER vs German",
    "coef": "-1.782",
    "HR": "0.168",
    "p": "2.18e-165"
  }
}
"""

import argparse
import json
import os
import sys
import re
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.exceptions import ConvergenceError
import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend
import matplotlib.pyplot as plt

# Force stdout to use UTF-8 encoding
sys.stdout.reconfigure(encoding="utf-8")

VARIANCE_EPS = 1e-5

# ---------------------------------------------------------------------------
# Dataset Recognition Patterns
# ---------------------------------------------------------------------------
SEER_PATTERN = re.compile(r"SEER|USA", re.IGNORECASE)
GERMAN_PATTERN = re.compile(r"German", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Canonical duration/event pairs (per-dataset detection)
# ---------------------------------------------------------------------------
TIME_EVENT_CANDIDATES = [
    # German dataset format
    ("rfstime", "status"),
    # SEER dataset format
    ("survival_months", "death_status"),
    ("survival_months_mod", "death_status_mod"),
]

# ---------------------------------------------------------------------------
# Column alias table  ➜  canonical name (expanded to handle both datasets)
# ---------------------------------------------------------------------------
COLUMN_ALIASES: Dict[str, str] = {
    # Age column mapping
    "age": "Age_at_diagnosis",
    "age_range": "Age_at_diagnosis",
    "Age_at_diagnosis": "Age_at_diagnosis",
    # Estrogen receptor mapping
    "er": "ER_Status_BC_Group",
    "ER_Status_BC_Group": "ER_Status_BC_Group",
    # Progesterone / hormone receptor mapping
    "pgr": "PR_Status_BC_Group",
    "PR_Status_BC_Group": "PR_Status_BC_Group",
    "hormon": "hormone_therapy",
    # Grade mapping (tumor grade)
    "grade": "grade",
    # Laterality mapping
    "laterality_group": "laterality_group",
    "laterality": "laterality_group",
}


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------
def py_scalar(x):
    return x.item() if isinstance(x, np.generic) else x


def canonicalise_columns(df: pd.DataFrame, dataset_type: str) -> pd.DataFrame:
    """Rename columns to canonical names based on dataset type"""
    rename_map = {}

    # Add specific handling based on dataset type
    if dataset_type == "german":
        # Handle German dataset column mapping
        if "er" in df.columns:
            rename_map["er"] = "ER_Status_BC_Group"
        if "pgr" in df.columns:
            rename_map["pgr"] = "PR_Status_BC_Group"
        if "hormon" in df.columns:
            rename_map["hormon"] = "hormone_therapy"
        if "age" in df.columns:
            rename_map["age"] = "Age_at_diagnosis"
        if "grade" in df.columns:
            rename_map["grade"] = "grade"
    elif dataset_type == "registry":
        # Handle Pakistani/Canadian registry datasets (same structure as German)
        if "er" in df.columns:
            rename_map["er"] = "ER_Status_BC_Group"
        if "pgr" in df.columns:
            rename_map["pgr"] = "PR_Status_BC_Group"
        if "hormon" in df.columns:
            rename_map["hormon"] = "hormone_therapy"
        if "age" in df.columns:
            rename_map["age"] = "Age_at_diagnosis"
        if "grade" in df.columns:
            rename_map["grade"] = "grade"
    else:
        # Use standard mapping for SEER or other datasets
        rename_map = {c: COLUMN_ALIASES[c] for c in df.columns if c in COLUMN_ALIASES}

    df2 = df.rename(columns=rename_map, inplace=False)

    # Dataset-specific conversions - Pakistani data uses days instead of months
    if dataset_type == "registry":
        # Convert time columns from days to months
        if "duration" in df2.columns:
            df2["duration"] = df2["duration"] / 30.44
            print(f"⚠️ Converted duration from days to months (÷30.44)", file=sys.stderr)
        if "rfstime" in df2.columns:
            df2["rfstime"] = df2["rfstime"] / 30.44
            print(f"⚠️ Converted rfstime from days to months (÷30.44)", file=sys.stderr)

    return df2.loc[:, ~df2.columns.duplicated()]


def parse_filters(spec: str) -> Dict[str, Tuple[str, float, float]]:
    filt: Dict[str, Tuple[str, float, float]] = {}
    if not spec:
        return filt
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        if "=" not in token:
            raise ValueError(f"Malformed filter token '{token}'.")
        key, val = token.split("=", 1)
        key, val = key.strip(), val.strip()
        key = COLUMN_ALIASES.get(key, key)
        if "-" in val:
            lo, hi = val.split("-", 1)
            filt[key] = ("range", float(lo), float(hi))
        else:
            try:
                # Try to convert value to float for numeric comparison
                val_float = float(val)
                filt[key] = ("eq", val_float, val_float)
            except ValueError:
                # If not numeric, keep as string
                filt[key] = ("eq", val, val)
    return filt


def _force_numeric(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return series
    return pd.to_numeric(series, errors="coerce")


def apply_filters(df: pd.DataFrame, filters):
    for col, (mode, lo, hi) in filters.items():
        if col not in df.columns:
            # Try to find the column by normalized name
            col_found = False
            for c in df.columns:
                if c.lower() == col.lower():
                    col = c
                    col_found = True
                    break
            if not col_found:
                print(
                    f"Warning: filter column '{col}' missing - ignored.",
                    file=sys.stderr,
                )
                continue

        if mode == "eq":
            if pd.api.types.is_numeric_dtype(df[col]):
                try:
                    lo_val = float(lo)
                    df = df[df[col] == lo_val]
                except ValueError:
                    df = df[df[col].astype(str) == lo]
            else:
                df = df[df[col].astype(str) == lo]
        else:
            col_series = _force_numeric(df[col])
            if col_series.isna().all():
                raise ValueError(f"Range filter on non-numeric column '{col}'.")
            df = df[(col_series >= lo) & (col_series <= hi)]
    return df


def determine_baselines(df: pd.DataFrame, covs: List[str]):
    base = {}
    for v in covs:
        if pd.api.types.is_numeric_dtype(df[v]) and df[v].nunique() > 10:
            base[v] = float(df[v].mean())
        else:
            base[v] = py_scalar(df[v].value_counts().idxmax())
    return base


def build_pretty_table(filters, group_labels, summ):
    def fmt_float(x, digits=3):
        return f"{x:.{digits}f}" if np.isfinite(x) else "nan"

    filter_items = list(filters.items())
    filt_vals = ["" for _ in range(3)]
    for i in range(min(3, len(filter_items))):
        k, (mode, lo, hi) = filter_items[i]
        val = f"{lo}-{hi}" if mode == "range" else str(lo)
        filt_vals[i] = f"{k}={val}"

    # Show all groups separated by ' vs '
    keys_sorted = sorted(group_labels.keys())
    all_groups = [group_labels[k] for k in keys_sorted]
    group_comp = " vs ".join(all_groups)

    # Find the Group row in the summary table
    group_row = None
    for _, row in summ.iterrows():
        if row["Variable"] == "Group (see group_labels)":
            group_row = row
            break

    if group_row is None:
        # Fallback if no group row found
        return {
            "Filter1": filt_vals[0],
            "Filter2": filt_vals[1],
            "Filter3": filt_vals[2],
            "Groups Compared": group_comp,
            "coef": "N/A",
            "HR": "N/A",
            "p": "N/A",
        }

    return {
        "Filter1": filt_vals[0],
        "Filter2": filt_vals[1],
        "Filter3": filt_vals[2],
        "Groups Compared": group_comp,
        "coef": fmt_float(group_row.coef),
        "HR": fmt_float(group_row["exp(coef)"]),
        "p": f"{group_row.p:.3g}" if np.isfinite(group_row.p) else "nan",
    }


def preprocess_dataset(df: pd.DataFrame, dataset_type: str) -> pd.DataFrame:
    """Apply dataset-specific preprocessing"""
    if dataset_type == "german" or dataset_type == "registry":
        # Ensure status is binary
        if "status" in df.columns:
            df["status"] = df["status"].astype(int)

        # Convert any string columns that should be numeric
        for col in ["grade", "pgr", "er", "hormon"]:
            if col in df.columns and not pd.api.types.is_numeric_dtype(df[col]):
                df[col] = pd.to_numeric(df[col], errors="coerce")

    elif dataset_type == "seer":
        # Make sure death_status is binary
        for col in ["death_status", "death_status_mod"]:
            if col in df.columns:
                df[col] = df[col].astype(int)

    return df


def detect_dataset_type(path: str) -> str:
    """Detect if dataset is German, SEER, or Pakistani/Canadian registry based on filename"""
    filename = os.path.basename(path).lower()
    if GERMAN_PATTERN.search(filename):
        return "german"
    elif SEER_PATTERN.search(filename):
        return "seer"
    elif "pakistan" in filename or "canadian" in filename:
        return "registry"
    # Default to unknown
    return "unknown"


def split_german_data_for_comparison(df: pd.DataFrame) -> pd.DataFrame:
    """Split German dataset into groups for comparison if running alone"""
    # If status column exists, we'll use it to create two groups
    if "status" in df.columns:
        # Create a copy to avoid modifying the original
        df_copy = df.copy()
        # Add group column based on status (0/1)
        df_copy["group"] = df_copy["status"]
        return df_copy

    # Fallback: try to create groups based on another variable
    # For example, split by median age
    if "age" in df.columns:
        df_copy = df.copy()
        median_age = df_copy["age"].median()
        df_copy["group"] = (df_copy["age"] > median_age).astype(int)
        return df_copy

    # If we can't find a good way to split, return original with random groups
    df_copy = df.copy()
    df_copy["group"] = np.random.binomial(1, 0.5, df.shape[0])
    return df_copy


def get_time_event_columns(
    df: pd.DataFrame, dataset_type: str
) -> Tuple[Optional[str], Optional[str]]:
    """Get appropriate time and event columns based on dataset type"""
    if dataset_type == "german":
        if {"rfstime", "status"} <= set(df.columns):
            return "rfstime", "status"
    elif dataset_type == "seer":
        if {"survival_months", "death_status"} <= set(df.columns):
            return "survival_months", "death_status"
        elif {"survival_months_mod", "death_status_mod"} <= set(df.columns):
            return "survival_months_mod", "death_status_mod"

    # Fall back to general detection
    for tcol, ecol in TIME_EVENT_CANDIDATES:
        if {tcol, ecol} <= set(df.columns):
            return tcol, ecol

    return None, None


def plot_cox_survival_curves(
    groups_for_plotting, group_labels, filters_str, output_path
):
    """
    Plot Kaplan-Meier survival curves for Cox model group comparison.
    Cox models hazard ratios, so we plot actual survival curves per group
    to visualize the differences that Cox quantifies.

    Args:
        groups_for_plotting: List of (time_data, event_data, group_label) tuples
        group_labels: Dict mapping group values to readable labels
        filters_str: Filter string to display in legend
        output_path: Path to save the PNG image
    """
    plt.figure(figsize=(12, 8))

    for time_data, event_data, label in groups_for_plotting:
        # Plot Kaplan-Meier curve for this group
        kmf = KaplanMeierFitter()
        kmf.fit(time_data, event_data, label=label)
        kmf.plot_survival_function(ci_show=False, linewidth=2.5)

    plt.title("Cox Model: Survival Curves by Group", fontsize=14, fontweight="bold")
    plt.xlabel("Time (months)", fontsize=12)
    plt.ylabel("Survival Probability", fontsize=12)

    legend_title = "Groups"
    if filters_str:
        legend_title += f"\nFilters: {filters_str}"

    plt.legend(title=legend_title, loc="best", fontsize=10)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(f"✅ Survival curves saved to {output_path}", file=sys.stderr, flush=True)
    plt.close()


def main():
    ap = argparse.ArgumentParser(
        description="Cox PH model with group-only table output"
    )
    ap.add_argument("--vars", required=True, help="Comma-separated covariates or 'all'")
    ap.add_argument(
        "--filters", default="", help="Up to 3 filters col=val or col=low-high"
    )
    ap.add_argument(
        "--group-by",
        type=str,
        default="race",
        help="Column to group by: race, meno, grade, er, pgr, age, nodes (default: race)",
    )
    ap.add_argument(
        "--output-image",
        type=str,
        default="",
        help="Path to save survival curve image (optional)",
    )
    ap.add_argument("--min-rows", type=int, default=20)
    ap.add_argument("datasets", nargs="*")
    args = ap.parse_args()

    if not args.datasets:
        ap.print_help(sys.stderr)
        print(
            '\nQuick start example:\n  python cox_model_v2025.py --vars all --filters "age_range=40-50" German.csv SEER.csv',
            file=sys.stderr,
        )
        sys.exit(1)

    filters = parse_filters(args.filters)
    if len(filters) > 3:
        print("Error: more than 3 filters supplied; limit is 3.", file=sys.stderr)
        sys.exit(1)

    frames, labels, dataset_types = [], [], []
    for path in args.datasets:
        label = os.path.splitext(os.path.basename(path))[0]
        labels.append(label)

        # Detect dataset type (german or seer)
        dataset_type = detect_dataset_type(path)
        dataset_types.append(dataset_type)

        try:
            df = pd.read_csv(path)
            # Apply dataset-specific preprocessing
            df = preprocess_dataset(df, dataset_type)
        except Exception as e:
            print(f"Cannot read {path}: {e}", file=sys.stderr)
            sys.exit(1)

        # Get appropriate time and event columns for this dataset
        time_col, event_col = get_time_event_columns(df, dataset_type)
        if time_col and event_col:
            df = df.rename(columns={time_col: "time", event_col: "event"})
        else:
            print(
                f"{path} lacks a recognised duration/event column pair.",
                file=sys.stderr,
            )
            sys.exit(1)

        # Canonicalize columns based on dataset type
        df = canonicalise_columns(df, dataset_type)

        # Apply filters
        try:
            df = apply_filters(df, filters)
        except Exception as e:
            print(f"Error applying filters to {path}: {e}", file=sys.stderr)
            sys.exit(1)

        frames.append(df)

    # Combine all datasets first
    combined = pd.concat(frames, ignore_index=True)

    # Determine grouping based on --group-by parameter
    if args.group_by == "race":
        if "race_group" in combined.columns and combined["race_group"].nunique() >= 2:
            combined["group"] = combined["race_group"]
            group_labels = {
                1: "Caucasian",
                2: "African-American",
                3: "Asian/Pacific Islander",
                4: "American Indian/Alaska Native",
                5: "Unknown",
            }

    elif args.group_by == "meno":
        if "meno" in combined.columns and combined["meno"].nunique() >= 2:
            combined["group"] = combined["meno"]
            group_labels = {0: "Pre-menopausal", 1: "Post-menopausal"}
        elif (
            "menopausal_status" in combined.columns
            and combined["menopausal_status"].nunique() >= 2
        ):
            combined["group"] = combined["menopausal_status"]
            group_labels = {0: "Pre-menopausal", 1: "Post-menopausal"}

    elif args.group_by == "grade":
        if "grade" in combined.columns:
            combined["group"] = (combined["grade"] >= 3).astype(int)
            group_labels = {0: "Low-Moderate Grade", 1: "High Grade"}

    elif args.group_by == "er":
        er_col = None
        if "ER_Status_BC_Group" in combined.columns:
            er_col = "ER_Status_BC_Group"
        elif "er" in combined.columns:
            er_col = "er"

        if er_col:
            # Drop NaN values before checking encoding
            unique_vals = combined[er_col].dropna().unique()

            if len(unique_vals) >= 2:
                if set(unique_vals).issubset({1, 2}):
                    # SEER encoding: 1=negative, 2=positive
                    combined["group"] = combined[er_col]
                    group_labels = {1: "ER-negative", 2: "ER-positive"}
                else:
                    # German/Pakistani encoding or mixed values: 0=negative, 1=positive
                    combined["group"] = (combined[er_col] > 0).astype(int)
                    group_labels = {0: "ER-negative", 1: "ER-positive"}
            else:
                print(
                    f"⚠️ Warning: {er_col} has only {len(unique_vals)} unique value(s) after dropping NaN, cannot create groups",
                    file=sys.stderr,
                )

    elif args.group_by == "pgr":
        pgr_col = None
        if "PR_Status_BC_Group" in combined.columns:
            pgr_col = "PR_Status_BC_Group"
        elif "pgr" in combined.columns:
            pgr_col = "pgr"

        if pgr_col:
            # Drop NaN values before checking encoding
            unique_vals = combined[pgr_col].dropna().unique()

            if len(unique_vals) >= 2:
                if set(unique_vals).issubset({1, 2}):
                    # SEER encoding: 1=negative, 2=positive
                    combined["group"] = combined[pgr_col]
                    group_labels = {1: "PR-negative", 2: "PR-positive"}
                else:
                    # German/Pakistani encoding or mixed values: 0=negative, 1=positive
                    combined["group"] = (combined[pgr_col] > 0).astype(int)
                    group_labels = {0: "PR-negative", 1: "PR-positive"}
            else:
                print(
                    f"⚠️ Warning: {pgr_col} has only {len(unique_vals)} unique value(s) after dropping NaN, cannot create groups",
                    file=sys.stderr,
                )

    elif args.group_by == "age":
        age_col = (
            "Age_at_diagnosis"
            if "Age_at_diagnosis" in combined.columns
            else "age" if "age" in combined.columns else None
        )
        if age_col:
            combined["group"] = (combined[age_col] >= 50).astype(int)
            group_labels = {0: "Age <50", 1: "Age ≥50"}

    elif args.group_by == "nodes":
        if "nodes" in combined.columns:
            unique_node_values = combined["nodes"].unique()

            # Check if we have both 0 and >0 values
            if 0 in unique_node_values:
                # Standard binary: 0 vs >0
                combined["group"] = (combined["nodes"] > 0).astype(int)
                group_labels = {0: "No nodes", 1: "Nodes involved"}
            else:
                # No zeros - split at median instead
                median_nodes = combined["nodes"].median()
                combined["group"] = (combined["nodes"] > median_nodes).astype(int)
                group_labels = {
                    0: f"≤{int(median_nodes)} nodes",
                    1: f">{int(median_nodes)} nodes",
                }
                print(
                    f"ℹ️ No patients with 0 nodes, splitting at median ({median_nodes})",
                    file=sys.stderr,
                )

    if "group" not in combined.columns:
        print(
            f"Error: Cannot group by '{args.group_by}' - column not found or insufficient groups",
            file=sys.stderr,
        )
        sys.exit(1)

    if combined.shape[0] < args.min_rows:
        print(
            f"Only {combined.shape[0]} rows after filtering - abort.", file=sys.stderr
        )
        sys.exit(1)

    # ---------------- covariate selection ---------
    if args.vars.lower() == "all":
        # First get common columns across all datasets
        common_cols = set(combined.columns)
        for f in frames:
            common_cols &= set(f.columns)

        # THEN exclude time, event, group, AND the grouping column
        auto_exclude = {"time", "event", "group", "pid"}

        # Add the original grouping column to exclusions based on group_by parameter
        if args.group_by == "pgr":
            auto_exclude.update({"pgr", "PR_Status_BC_Group"})
            print(
                f"🔍 Excluding PR columns to prevent multicollinearity", file=sys.stderr
            )
            print(f"🔍 auto_exclude set: {auto_exclude}", file=sys.stderr)
            print(
                f"🔍 Is PR_Status_BC_Group in common_cols? {'PR_Status_BC_Group' in common_cols}",
                file=sys.stderr,
            )
            print(
                f"🔍 Is PR_Status_BC_Group in auto_exclude? {'PR_Status_BC_Group' in auto_exclude}",
                file=sys.stderr,
            )
            # REMOVE THIS LINE: covs = [c for c in common_cols if c not in auto_exclude]
        elif args.group_by == "er":
            auto_exclude.update({"er", "ER_Status_BC_Group"})
            print(
                f"🔍 Excluding ER columns to prevent multicollinearity", file=sys.stderr
            )
        elif args.group_by == "race":
            auto_exclude.add("race_group")
        elif args.group_by == "meno":
            auto_exclude.update({"meno", "menopausal_status"})
        elif args.group_by == "grade":
            auto_exclude.add("grade")
        elif args.group_by == "age":
            auto_exclude.update({"age", "Age_at_diagnosis"})
        elif args.group_by == "nodes":
            auto_exclude.add("nodes")

        # Apply exclusions to common columns (KEEP THIS LINE)
        covs = [c for c in common_cols if c not in auto_exclude]

        print(f"🔍 Covariates selected: {covs}", file=sys.stderr)
        print(
            f"🔍 Excluded columns: {auto_exclude & set(combined.columns)}",
            file=sys.stderr,
        )
    else:
        # Manual variable selection - map aliases and filter
        requested = [
            COLUMN_ALIASES.get(v.strip(), v.strip())
            for v in args.vars.split(",")
            if v.strip()
        ]
        
        # Exclude the grouping column to prevent multicollinearity
        grouping_exclusions = set()
        if args.group_by == "pgr":
            grouping_exclusions = {"pgr", "PR_Status_BC_Group"}
        elif args.group_by == "er":
            grouping_exclusions = {"er", "ER_Status_BC_Group"}
        elif args.group_by == "race":
            grouping_exclusions = {"race_group"}
        elif args.group_by == "meno":
            grouping_exclusions = {"meno", "menopausal_status"}
        elif args.group_by == "grade":
            grouping_exclusions = {"grade"}
        elif args.group_by == "age":
            grouping_exclusions = {"age", "Age_at_diagnosis"}
        elif args.group_by == "nodes":
            grouping_exclusions = {"nodes"}
        
        # Filter out grouping columns
        covs = [c for c in requested if c in combined.columns and c not in grouping_exclusions]
        
        print(f"🔍 Manual vars - Requested: {requested}", file=sys.stderr)
        print(f"🔍 Manual vars - Excluded: {grouping_exclusions}", file=sys.stderr)
        print(f"🔍 Manual vars - Final covs: {covs}", file=sys.stderr)

    if not covs:
        print("No covariates available across all datasets.", file=sys.stderr)
        sys.exit(1)

    covs += ["group"]

    # Check for low variance covariates
    low_variance = []
    for c in covs:
        if c not in combined.columns:
            low_variance.append(c)
            continue

        if combined[c].nunique() <= 1:
            low_variance.append(c)
            continue

        if pd.api.types.is_numeric_dtype(combined[c]):
            var = combined[c].var()
            if pd.isna(var) or var < VARIANCE_EPS:
                low_variance.append(c)

    if low_variance:
        print(
            f"Warning: dropping low variance covariates {low_variance}", file=sys.stderr
        )
        covs = [c for c in covs if c not in low_variance]

    if "group" not in covs:
        print("Group became constant - abort.", file=sys.stderr)
        sys.exit(1)

    # Drop rows with NaN in relevant columns
    model_df = combined[["time", "event"] + covs].dropna()
    if model_df.shape[0] < args.min_rows:
        print(f"Only {model_df.shape[0]} usable rows - abort.", file=sys.stderr)
        sys.exit(1)

    # Determine baselines for all covariates
    baselines = {
        k: py_scalar(v) for k, v in determine_baselines(model_df, covs).items()
    }

    # ---------------- Debug: Print what columns we're actually using --------------
    print(f"🔍 DEBUG: Covariates being used in Cox model: {covs}", file=sys.stderr)
    print(f"🔍 DEBUG: model_df columns: {list(model_df.columns)}", file=sys.stderr)
    print(f"🔍 DEBUG: model_df shape: {model_df.shape}", file=sys.stderr)
    print(f"🔍 DEBUG: group_by parameter: {args.group_by}", file=sys.stderr)

    # ---------------- fit Cox model --------------
    try:
        cph = CoxPHFitter()
        cph.fit(model_df, duration_col="time", event_col="event")
    except ConvergenceError:
        # If standard fitting fails, try with penalizer
        try:
            cph = CoxPHFitter(penalizer=0.5)  # Increased for better numerical stability
            cph.fit(model_df, duration_col="time", event_col="event")
        except Exception as e:
            print(f"Error fitting Cox model: {e}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error fitting Cox model: {e}", file=sys.stderr)
        sys.exit(1)

    # Format the results
    summ = cph.summary.reset_index().rename(columns={"covariate": "Variable"})[
        ["Variable", "coef", "exp(coef)", "p"]
    ]
    summ["Variable"] = summ["Variable"].replace({"group": "Group (see group_labels)"})

    # ---------------- Generate survival curves and group results ----------------
    image_path = None
    group_results = []

    # Get unique group values
    unique_groups = sorted(model_df["group"].dropna().unique())

    # Collect data for each group
    groups_for_plotting = []
    for group_val in unique_groups:
        mask = model_df["group"] == group_val
        time_data = model_df.loc[mask, "time"]
        event_data = model_df.loc[mask, "event"]
        label = group_labels.get(group_val, f"Group_{group_val}")

        # Calculate group statistics
        n_samples = int(mask.sum())
        n_events = int(event_data.sum())

        # Extract C-index for this group from Cox model
        # Note: Cox doesn't calculate per-group C-index, so we'll use overall or N/A
        group_results.append(
            {
                "group": label,
                "n_samples": n_samples,
                "n_events": n_events,
                "c_index": None,  # Cox provides hazard ratios, not per-group C-index
            }
        )

        groups_for_plotting.append((time_data, event_data, label))

    # Generate plot if requested
    if args.output_image and len(groups_for_plotting) >= 1:
        image_path = args.output_image
        plot_cox_survival_curves(
            groups_for_plotting, group_labels, args.filters, image_path
        )

    # ---------------- Build combined output ----------------
    output_json = {
        "model": "Cox Proportional Hazards",
        "group_by": args.group_by,
        "groups_compared": [group_labels.get(g, f"Group_{g}") for g in unique_groups],
        "group_results": group_results,
        "filters_applied": args.filters if args.filters else "None",
        "summary": summ.to_dict(orient="records"),
        "baseline": baselines,
        "group_labels": {int(k): v for k, v in group_labels.items()},
        "pretty_table": build_pretty_table(filters, group_labels, summ),
    }

    if image_path:
        output_json["image_path"] = image_path

    print(json.dumps(output_json, indent=2))


if __name__ == "__main__":
    main()
