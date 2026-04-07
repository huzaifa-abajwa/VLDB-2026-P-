"""

====================================================================
1. Adds **filter information to the legend** of the Kaplan Meier plot so the
   resulting PNG is self documenting.
2. Adds **handling for German datasets** to create menopausal status comparison
   when only the German cancer registry is selected.

Changes:
1. `` now accepts a `filters_str` argument and, if non empty,
   appenplot_km_curvesds a second line to the legend title: `Filters: …`.
2. The `main()` call to `plot_km_curves` passes `args.filters` straight through.
3. Added the ability to detect German datasets and split them into menopausal vs
   non-menopausal groups when only one dataset is provided.
"""

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Tuple

import matplotlib.pyplot as plt
import pandas as pd
from lifelines import KaplanMeierFitter

sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Dataset Recognition Patterns (similar to cox_model)
# ---------------------------------------------------------------------------
SEER_PATTERN = re.compile(r"SEER|USA", re.IGNORECASE)
GERMAN_PATTERN = re.compile(r"German", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Shared infrastructure (kept in sync with cox_model_v2025)
# ---------------------------------------------------------------------------

TIME_EVENT_CANDIDATES = [
    ("rfstime", "status"),
    ("survival_months", "death_status"),
    ("survival_months_mod", "death_status_mod"),
]

COLUMN_ALIASES: Dict[str, str] = {
    # age
    "age": "Age_at_diagnosis",
    "age_range": "Age_at_diagnosis",
    "Age_at_diagnosis": "Age_at_diagnosis",
    # oestrogen receptor
    "er": "ER_Status_BC_Group",
    "ER_Status_BC_Group": "ER_Status_BC_Group",
    # progesterone / hormone receptor
    "pgr": "PR_Status_BC_Group",
    "hormon": "PR_Status_BC_Group",
    "PR_Status_BC_Group": "PR_Status_BC_Group",
    # laterality
    "laterality_group": "laterality_group",
    "laterality": "laterality_group",
    # menopausal status
    "meno": "menopausal_status",
    "menopausal": "menopausal_status",
    "menopausal_status": "menopausal_status",
}

VARIANCE_EPS = 1e-5  # not strictly needed here but kept for parity

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def detect_dataset_type(path: str) -> str:
    """Detect if dataset is German, SEER, or registry based on filename"""
    filename = os.path.basename(path).lower()
    if GERMAN_PATTERN.search(filename):
        return "german"
    elif SEER_PATTERN.search(filename):
        return "seer"
    elif "pakistan" in filename or "canadian" in filename:
        return "registry"
    # Default to unknown
    return "unknown"


def split_german_data_by_menopausal_status(
    df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """
    Split German dataset into menopausal and non menopausal groups for comparison.
    Returns: (meno_group_df, non_meno_group_df, [label1, label2])
    """
    # First check if menopausal_status column exists directly
    for col_name in ["menopausal_status", "meno", "menopausal"]:
        if col_name in df.columns:
            # Try to identify values that indicate menopausal status
            # Common encodings: 1/0, 1/2, "yes"/"no", "pre"/"post", etc.
            unique_values = df[col_name].unique()
            print(
                f"Found menopausal status column '{col_name}' with values: {unique_values}",
                file=sys.stderr,
            )

            # Check for binary encoding
            if len(unique_values) == 2:
                # Sort values to try to ensure consistent assignment (1 > 0, 2 > 1, etc.)
                sorted_values = sorted(unique_values)

                # Create the groups
                meno_group = df[df[col_name] == sorted_values[1]].copy()
                non_meno_group = df[df[col_name] == sorted_values[0]].copy()

                # Ensure both groups have data
                if len(meno_group) > 0 and len(non_meno_group) > 0:
                    print(
                        f"Successfully split by menopausal status: {len(non_meno_group)} non menopausal, {len(meno_group)} menopausal",
                        file=sys.stderr,
                    )
                    return meno_group, non_meno_group, ["Menopausal", "Non menopausal"]

    # Try to infer menopausal status from age if available
    if "Age_at_diagnosis" in df.columns or "age" in df.columns:
        age_col = "Age_at_diagnosis" if "Age_at_diagnosis" in df.columns else "age"
        # Use age 50 as a common threshold for menopausal status
        meno_group = df[df[age_col] >= 50].copy()
        non_meno_group = df[df[age_col] < 50].copy()

        if len(meno_group) > 0 and len(non_meno_group) > 0:
            print(
                f"Inferred menopausal status from age: {len(non_meno_group)} under 50, {len(meno_group)} 50 and above",
                file=sys.stderr,
            )
            return (
                meno_group,
                non_meno_group,
                ["Age ≥ 50 (Likely menopausal)", "Age < 50 (Likely non menopausal)"],
            )

    # Fallback to event based split if we can't determine menopausal status
    print(
        "Couldn't determine menopausal status, falling back to event based split",
        file=sys.stderr,
    )

    # If status column exists (as event), use it to create two groups
    if "event" in df.columns:
        event_df = df[df["event"] == 1].copy()
        non_event_df = df[df["event"] == 0].copy()

        # Ensure both dataframes have some data
        if not event_df.empty and not non_event_df.empty:
            print(
                f"Falling back to event based split: {len(non_event_df)} non event cases, {len(event_df)} event cases",
                file=sys.stderr,
            )
            return event_df, non_event_df, ["Event group", "Non-event group"]

    # Final fallback split by median time
    print("All specific splits failed, trying median time split", file=sys.stderr)
    median_time = df["time"].median()
    group1 = df[df["time"] <= median_time].copy()
    group2 = df[df["time"] > median_time].copy()

    if not group1.empty and not group2.empty:
        print(
            f"Split by median time: {len(group1)} below median, {len(group2)} above median",
            file=sys.stderr,
        )
        return group1, group2, [f"Time ≤ {median_time}", f"Time > {median_time}"]

    print("Cannot split German dataset meaningfully", file=sys.stderr)
    return None, None, None


def canonicalise_columns(
    df: pd.DataFrame, dataset_type: str = "generic"
) -> pd.DataFrame:
    rename_map = {c: COLUMN_ALIASES[c] for c in df.columns if c in COLUMN_ALIASES}
    df2 = df.rename(columns=rename_map, inplace=False)
    df2 = df2.loc[:, ~df2.columns.duplicated()]

    # Dataset-specific conversions
    if dataset_type == "registry":  # Pakistani/Canadian datasets
        if "time" in df2.columns:
            # Convert from days to months (Pakistani data is in days)
            df2["time"] = df2["time"] / 30.44
            print(f"⚠️ Converted time from days to months (÷30.44)", file=sys.stderr)

    return df2


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
            filt[key] = ("eq", val, val)
    if len(filt) > 3:
        raise ValueError("At most three filters are allowed.")
    return filt


def _force_numeric(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return series
    return pd.to_numeric(series, errors="coerce")


def apply_filters(df: pd.DataFrame, filters):
    for col, (mode, lo, hi) in filters.items():
        if col not in df.columns:
            print(f"Warning: filter column '{col}' missing ignored.", file=sys.stderr)
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
                raise ValueError(f"Range filter on non numeric column '{col}'.")
            df = df[(col_series >= lo) & (col_series <= hi)]
    return df


# ---------------------------------------------------------------------------
# Plotting logic
# ---------------------------------------------------------------------------


def plot_km_curves(
    datasets: List[pd.DataFrame], labels: List[str], output: str, filters_str: str
):
    plt.figure(figsize=(10, 6))
    kmf = KaplanMeierFitter()

    print(f"Plotting {len(datasets)} datasets with labels: {labels}", file=sys.stderr)
    for i, (data, label) in enumerate(zip(datasets, labels)):
        print(f"Dataset {i+1}: {len(data)} rows, label: {label}", file=sys.stderr)
        print(
            f"Event counts: {data['event'].value_counts().to_dict()}", file=sys.stderr
        )

        # Create a copy to avoid warning about view vs copy
        data_copy = data.copy()

        # Ensure event column is binary (0 or 1)
        if "event" in data_copy.columns:
            # If not binary, map to 0/1
            if set(data_copy["event"].unique()) != {0, 1}:
                print(
                    f"Warning: Non-binary event values detected: {data_copy['event'].unique()}",
                    file=sys.stderr,
                )
                # For KM curves, treat anything > 0 as an event
                data_copy["event"] = (data_copy["event"] > 0).astype(int)
                print(
                    f"Mapped to binary: {data_copy['event'].value_counts().to_dict()}",
                    file=sys.stderr,
                )

        kmf.fit(
            durations=data_copy["time"], event_observed=data_copy["event"], label=label
        )
        kmf.plot_survival_function(ci_show=False)

    title = "Kaplan Meier Survival Curves"
    plt.title(title)
    plt.xlabel("Time")
    plt.ylabel("Survival Probability")

    legend_title = "Cohorts"
    if filters_str:
        legend_title += f"\nFilters: {filters_str}"
    plt.legend(title=legend_title)

    plt.tight_layout()
    plt.savefig(output)
    print(f"Kaplan-Meier curves saved to {output}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="Enhanced Kaplan Meier plotter")
    ap.add_argument(
        "--filters", default="", help="Up to 3 filters col=val or col=low high"
    )
    ap.add_argument(
        "--group-by",
        type=str,
        default="race",
        help="Column to group by: race, meno, grade, er, pgr, age, nodes (default: race)",
    )
    ap.add_argument("datasets", nargs="+", help="One or two CSV files")
    ap.add_argument("output", help="Output PNG path")
    args = ap.parse_args()

    filters = parse_filters(args.filters)

    raw_frames = []
    dataset_types = []
    for path in args.datasets:
        try:
            df = pd.read_csv(path)
        except Exception as e:
            sys.exit(f"Cannot read {path}: {e}")

        # Detect dataset type
        dataset_type = detect_dataset_type(path)
        dataset_types.append(dataset_type)

        # time/event detection
        for tcol, ecol in TIME_EVENT_CANDIDATES:
            if {tcol, ecol} <= set(df.columns):
                df = df.rename(columns={tcol: "time", ecol: "event"})
                break
        else:
            sys.exit(f"{path} lacks a recognised duration/event column pair.")
        df = canonicalise_columns(df, dataset_type)
        df = apply_filters(df, filters)
        raw_frames.append(df)

    # Determine plotting strategy
    frames_to_plot: List[pd.DataFrame] = []
    labels: List[str] = []
    group_results = []  # NEW: Track group statistics

    # Combine multiple datasets if group-by is specified
    if len(raw_frames) > 1:
        # VALIDATION: Check if group column exists in ALL datasets before combining
        group_col_candidates = {
            "race": ["race_group"],
            "meno": ["meno", "menopausal_status", "menopausal"],
            "grade": ["grade"],
            "er": ["er", "ER_Status_BC_Group"],
            "pgr": ["pgr", "PR_Status_BC_Group"],
            "age": ["age", "Age_at_diagnosis", "age_at_diagnosis"],
            "nodes": ["nodes"],
        }

        required_cols = group_col_candidates.get(args.group_by, [])
        valid_frames = []

        for df, path in zip(raw_frames, args.datasets):
            dataset_name = os.path.basename(path)
            has_group_col = any(col in df.columns for col in required_cols)

            if has_group_col:
                valid_frames.append(df)
                print(
                    f"✅ {dataset_name}: Has column for --group-by={args.group_by}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"⚠️ {dataset_name}: Missing column for --group-by={args.group_by}, skipping",
                    file=sys.stderr,
                )

        if len(valid_frames) == 0:
            sys.exit(
                f"❌ Error: No datasets have columns for --group-by={args.group_by}"
            )

        print(
            f"🔗 Combining {len(valid_frames)} datasets for --group-by={args.group_by}",
            file=sys.stderr,
        )
        df = pd.concat(valid_frames, ignore_index=True)
        raw_frames = [df]  # Treat as single dataset

    # Determine plotting strategy based on --group-by parameter
    if len(raw_frames) == 1:
        df = raw_frames[0]
        print(f"Processing single dataset with {len(df)} rows", file=sys.stderr)

        group_col = None
        group_labels_dict = {}

        if args.group_by == "race":
            if "race_group" in df.columns and df["race_group"].nunique() >= 2:
                group_col = "race_group"
                group_labels_dict = {
                    1: "Caucasian",
                    2: "African-American",
                    3: "Asian/Pacific Islander",
                    4: "American Indian/Alaska Native",
                    5: "Unknown",
                }

        elif args.group_by == "meno":
            if "meno" in df.columns and df["meno"].nunique() >= 2:
                group_col = "meno"
                group_labels_dict = {0: "Pre-menopausal", 1: "Post-menopausal"}
            elif (
                "menopausal_status" in df.columns
                and df["menopausal_status"].nunique() >= 2
            ):
                group_col = "menopausal_status"
                group_labels_dict = {0: "Pre-menopausal", 1: "Post-menopausal"}

        elif args.group_by == "grade":
            if "grade" in df.columns and df["grade"].nunique() >= 2:
                df["grade_binary"] = (df["grade"] >= 3).astype(int)
                group_col = "grade_binary"
                group_labels_dict = {0: "Low-Moderate Grade", 1: "High Grade"}

        elif args.group_by == "er":
            er_col = (
                "ER_Status_BC_Group"
                if "ER_Status_BC_Group" in df.columns
                else "er" if "er" in df.columns else None
            )
            if er_col:
                unique_vals = df[er_col].unique()
                if set(unique_vals).issubset({1, 2}):
                    # SEER uses 1=negative, 2=positive
                    group_col = er_col
                    group_labels_dict = {1: "ER-negative", 2: "ER-positive"}
                else:
                    # German/Pakistani use 0/1
                    df["er_binary"] = (df[er_col] > 0).astype(int)
                    group_col = "er_binary"
                    group_labels_dict = {0: "ER-negative", 1: "ER-positive"}

        elif args.group_by == "pgr":
            pgr_col = (
                "PR_Status_BC_Group"
                if "PR_Status_BC_Group" in df.columns
                else "pgr" if "pgr" in df.columns else None
            )
            if pgr_col:
                unique_vals = df[pgr_col].unique()
                if set(unique_vals).issubset({1, 2}):
                    group_col = pgr_col
                    group_labels_dict = {1: "PR-negative", 2: "PR-positive"}
                else:
                    df["pgr_binary"] = (df[pgr_col] > 0).astype(int)
                    group_col = "pgr_binary"
                    group_labels_dict = {0: "PR-negative", 1: "PR-positive"}

        elif args.group_by == "age":
            age_col = (
                "Age_at_diagnosis"
                if "Age_at_diagnosis" in df.columns
                else "age" if "age" in df.columns else None
            )
            if age_col:
                df["age_group"] = (df[age_col] >= 50).astype(int)
                group_col = "age_group"
                group_labels_dict = {0: "Age <50", 1: "Age ≥50"}

        elif args.group_by == "nodes":
            if "nodes" in df.columns:
                unique_node_values = df["nodes"].unique()

                # Check if we have both 0 and >0 values
                if 0 in unique_node_values:
                    # Standard binary: 0 vs >0
                    df["nodes_group"] = (df["nodes"] > 0).astype(int)
                    group_col = "nodes_group"
                    group_labels_dict = {0: "No nodes", 1: "Nodes involved"}
                else:
                    # No zeros - split at median instead
                    median_nodes = df["nodes"].median()
                    df["nodes_group"] = (df["nodes"] > median_nodes).astype(int)
                    group_col = "nodes_group"
                    group_labels_dict = {
                        0: f"≤{int(median_nodes)} nodes",
                        1: f">{int(median_nodes)} nodes",
                    }
                    print(
                        f"ℹ️ No patients with 0 nodes, splitting at median ({median_nodes})",
                        file=sys.stderr,
                    )

        # Try to split based on detected group column
        if group_col and group_col in df.columns:
            groups = sorted(df[group_col].dropna().unique())  # Get ALL groups, sorted
            if len(groups) >= 2:
                frames_to_plot = [df[df[group_col] == g] for g in groups]
                labels = [group_labels_dict.get(g, f"Group {g}") for g in groups]
                print(
                    f"Successfully split by {args.group_by} into {len(groups)} groups: {[len(f) for f in frames_to_plot]}",
                    file=sys.stderr,
                )

                # NEW: Collect group statistics
                for g, frame, label in zip(groups, frames_to_plot, labels):
                    group_results.append(
                        {
                            "group": label,
                            "n_samples": len(frame),
                            "n_events": int(frame["event"].sum()),
                        }
                    )
            else:
                print(
                    f"Insufficient groups for --group-by={args.group_by}, using single curve",
                    file=sys.stderr,
                )
                frames_to_plot = [df]
                labels = [os.path.splitext(os.path.basename(args.datasets[0]))[0]]
        else:
            print(
                f"Could not find grouping column for --group-by={args.group_by}, using single curve",
                file=sys.stderr,
            )
            frames_to_plot = [df]
            labels = [os.path.splitext(os.path.basename(args.datasets[0]))[0]]

    else:  # Multiple datasets – compare registries (only when not grouped)
        for path, df in zip(args.datasets, raw_frames):
            frames_to_plot.append(df)
            labels.append(os.path.splitext(os.path.basename(path))[0])

    plot_km_curves(frames_to_plot, labels, args.output, args.filters)

    # NEW: Output JSON with group results
    output = {
        "model": "Kaplan-Meier",
        "group_by": args.group_by if group_results else None,
        "groups_compared": labels if group_results else None,
        "group_results": group_results if group_results else None,
        "filters_applied": args.filters if args.filters else "None",
        "image_path": args.output,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
