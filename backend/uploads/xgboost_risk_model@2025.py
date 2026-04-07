"""
XGBoost Risk Stratification Model - Enhanced with Predicted Survival Curves
Version: 2.0
Description: XGBoost-based risk stratification with group comparison AND predicted survival curve visualization
"""

import argparse
import json
import sys
import time as timer

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt

# Force unbuffered stderr so timing logs appear immediately
sys.stderr.reconfigure(line_buffering=True)
import xgboost as xgb
from lifelines import KaplanMeierFitter
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

# Survival analysis imports
from sksurv.ensemble import GradientBoostingSurvivalAnalysis
from sksurv.nonparametric import kaplan_meier_estimator
from sksurv.util import Surv

# Column name aliases for consistency
COLUMN_ALIASES = {
    "age": "age_at_diagnosis",
    "age_range": "age_at_diagnosis",
    "grade": "grade",
    "status": "status",
    "rfstime": "survival_months",
    "survival_months": "survival_months",
    "time": "survival_months",
}


def canonicalise_columns(df, dataset_type="generic"):
    """Standardize column names based on dataset type"""
    df.columns = [c.strip().lower() for c in df.columns]

    # Map common aliases
    for alias, canonical in COLUMN_ALIASES.items():
        if alias in df.columns and canonical.lower() not in df.columns:
            df.rename(columns={alias: canonical.lower()}, inplace=True)

    # Dataset-specific conversions
    if dataset_type == "registry":  # Pakistani/Canadian datasets
        if "survival_months" in df.columns:
            # Convert from days to months (Pakistani data is in days)
            df["survival_months"] = df["survival_months"] / 30.44
            print(
                f"⚠️ Converted survival_months from days to months (÷30.44)",
                file=sys.stderr,
                flush=True,
            )

    return df


def apply_filters(df, filter_string):
    """Apply filters from filter string (e.g., 'age_range=40-50,grade=1-2,PR_Status_BC_Group=1')"""
    if not filter_string or filter_string.strip() == "":
        return df

    filters = filter_string.split(",")
    for filt in filters:
        filt = filt.strip()
        if not filt:
            continue

        if "=" not in filt:
            continue

        key, value = filt.split("=", 1)
        key = key.strip()
        key_lower = key.lower()
        value = value.strip()

        if key_lower in COLUMN_ALIASES:
            target_col = COLUMN_ALIASES[key_lower]
        elif key_lower in [k.lower() for k in COLUMN_ALIASES.keys()]:
            target_col = next(
                v for k, v in COLUMN_ALIASES.items() if k.lower() == key_lower
            )
        else:
            target_col = key

        # Handle age_range filter
        if "age" in key_lower and "-" in value:
            try:
                low, high = map(int, value.split("-"))
                # Use target_col instead of searching
                age_col = (
                    target_col.lower()
                    if target_col in df.columns
                    else next((c for c in df.columns if "age" in c.lower()), None)
                )
                if age_col:
                    df = df[(df[age_col] >= low) & (df[age_col] <= high)]
                    print(
                        f"Applied age filter {low}-{high}: {len(df)} rows remain",
                        file=sys.stderr,
                        flush=True,
                    )
            except Exception as e:
                print(
                    f"Warning: Failed to apply age filter: {e}",
                    file=sys.stderr,
                    flush=True,
                )

        # Handle grade filter
        elif "grade" in key_lower:
            grade_col = next((c for c in df.columns if "grade" in c.lower()), None)
            if grade_col:
                if "-" in value:
                    try:
                        low, high = map(int, value.split("-"))
                        df = df[(df[grade_col] >= low) & (df[grade_col] <= high)]
                        print(
                            f"Applied grade range filter {low}-{high}: {len(df)} rows remain",
                            file=sys.stderr,
                            flush=True,
                        )
                    except Exception as e:
                        print(
                            f"Warning: Failed to apply grade range filter: {e}",
                            file=sys.stderr,
                            flush=True,
                        )
                else:
                    try:
                        df = df[df[grade_col] == int(value)]
                        print(
                            f"Applied grade={value} filter: {len(df)} rows remain",
                            file=sys.stderr,
                            flush=True,
                        )
                    except Exception as e:
                        print(
                            f"Warning: Failed to apply grade filter: {e}",
                            file=sys.stderr,
                            flush=True,
                        )

        # Handle generic column filters (e.g., PR_Status_BC_Group=1, ER_Status_BC_Group=1)
        else:
            # Look for exact column name match (case-insensitive)
            matching_col = next((c for c in df.columns if c.lower() == key_lower), None)

            if matching_col:
                # Try numeric comparison first
                try:
                    numeric_value = float(value)
                    df = df[df[matching_col] == numeric_value]
                    print(
                        f"Applied {matching_col}={value} filter: {len(df)} rows remain",
                        file=sys.stderr,
                        flush=True,
                    )
                except ValueError:
                    # If not numeric, try string comparison
                    df = df[df[matching_col].astype(str) == value]
                    print(
                        f"Applied {matching_col}={value} filter: {len(df)} rows remain",
                        file=sys.stderr,
                        flush=True,
                    )
            else:
                print(
                    f"Warning: Column '{key}' not found in dataset. Available columns: {list(df.columns)}",
                    file=sys.stderr,
                    flush=True,
                )

    print(
        f"Final dataset after all filters: {len(df)} rows", file=sys.stderr, flush=True
    )
    return df


def detect_dataset_type(filename):
    """Detect dataset type from filename"""
    filename_lower = filename.lower()
    if "sylhet" in filename_lower or "bangladesh" in filename_lower:
        return "sylhet"
    elif "pima" in filename_lower:
        return "pima"
    elif "diabetic" in filename_lower or "readmission" in filename_lower:
        return "diabetic"
    elif "seer" in filename_lower or "usa" in filename_lower:
        return "seer"
    elif "german" in filename_lower:
        return "german"
    elif "pakistan" in filename_lower or "canadian" in filename_lower:
        return "registry"
    else:
        return "generic"
    
def extract_race_from_filename(filename):
    """Extract race label from race-split dataset filename"""
    fname = filename.lower()
    if "africanamerican" in fname:
        return "African American"
    elif "caucasian" in fname:
        return "Caucasian"
    elif "hispanic" in fname:
        return "Hispanic"
    elif "asian" in fname:
        return "Asian"
    return None


def prepare_features(df, target_col="status"):
    """Prepare features for XGBoost training"""
    # Standardize column names
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    # Identify target column - try multiple alternatives
    TARGET_CANDIDATES = [
        "status",
        "death_status",
        "death_status_mod",
        "event",
        "diagnosis",
        "outcome",
    ]

    if target_col.lower() not in df.columns:
        # Try common alternatives
        for alt in TARGET_CANDIDATES:
            if alt in df.columns:
                target_col = alt
                print(f"Using target column: {target_col}", file=sys.stderr, flush=True)
                break

    if target_col not in df.columns:
        print(
            f"Error: Target column '{target_col}' not found in dataset", file=sys.stderr
        )
        sys.exit(1)

    # Separate features and target
    y = df[target_col]
    X = df.drop(columns=[target_col])

    # Handle categorical variables
    categorical_cols = X.select_dtypes(include=["object", "category"]).columns
    for col in categorical_cols:
        X[col] = pd.Categorical(X[col]).codes

    # Handle missing values
    X = X.fillna(X.median())

    # Remove zero-variance columns
    variances = X.var()
    zero_var_cols = variances[variances == 0].index
    if len(zero_var_cols) > 0:
        print(
            f"Removing {len(zero_var_cols)} zero-variance columns: {list(zero_var_cols)}",
            file=sys.stderr,
            flush=True,
        )
        X = X.drop(columns=zero_var_cols)

    return X, y


def plot_survival_curves(groups_data, group_labels, filters_str, output_path):
    """
    Plot predicted XGBoost survival curves overlaid with actual Kaplan-Meier curves

    Args:
        groups_data: List of tuples (X_group, y_surv_group, model, group_label)
        group_labels: Dictionary mapping group values to labels
        filters_str: Filter string for legend
        output_path: Path to save PNG
    """
    plt.figure(figsize=(12, 7))

    colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"]

    for idx, (X_group, y_surv_group, model, group_label) in enumerate(groups_data):
        color = colors[idx % len(colors)]

        # Plot actual Kaplan-Meier curve
        time, event = y_surv_group["time"], y_surv_group["event"]
        kmf = KaplanMeierFitter()
        kmf.fit(durations=time, event_observed=event, label=f"{group_label} (Actual)")
        kmf.plot_survival_function(
            ax=plt.gca(), ci_show=False, color=color, linestyle="-", linewidth=2
        )

        # Plot predicted XGBoost survival curve
        try:
            # Get survival function for each sample
            surv_funcs = model.predict_survival_function(X_group)

            # Average survival function across all samples in group
            time_points = np.linspace(time.min(), time.max(), 100)
            avg_survival = np.zeros(len(time_points))

            for surv_func in surv_funcs:
                # Interpolate survival function at time points
                surv_at_times = [surv_func(t) for t in time_points]
                avg_survival += np.array(surv_at_times)

            avg_survival /= len(surv_funcs)

            # Plot predicted curve
            plt.plot(
                time_points,
                avg_survival,
                label=f"{group_label} (Predicted)",
                color=color,
                linestyle="--",
                linewidth=2,
                alpha=0.8,
            )
        except Exception as e:
            print(
                f"⚠️ Could not plot predicted curve for {group_label}: {e}",
                file=sys.stderr,
                flush=True,
            )

    plt.title(
        "XGBoost Predicted vs Actual Survival Curves", fontsize=14, fontweight="bold"
    )
    plt.xlabel("Time (months)", fontsize=12)
    plt.ylabel("Survival Probability", fontsize=12)

    legend_title = "Groups"
    if filters_str:
        legend_title += f"\nFilters: {filters_str}"

    plt.legend(title=legend_title, loc="best", fontsize=10)
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(
        f"✅ Predicted survival curves saved to {output_path}",
        file=sys.stderr,
        flush=True,
    )
    plt.close()


# ===========================================================================
# DIABETES CLASSIFICATION MODE (3-class readmission prediction)
# ===========================================================================


def preprocess_diabetic_flat(df):
    """
    Preprocess diabetic_data.csv into flat tabular format (one row per patient).
    Uses last encounter per patient, same features as LSTM model.
    """
    from sklearn.preprocessing import StandardScaler

    print(" Preprocessing diabetic data (flat mode)...", file=sys.stderr, flush=True)

    # Map readmitted to numeric: NO=0, >30=1, <30=2
    readmit_map = {"NO": 0, ">30": 1, "<30": 2}
    df["readmitted_class"] = df["readmitted"].map(readmit_map)
    df = df.dropna(subset=["readmitted_class"])
    df["readmitted_class"] = df["readmitted_class"].astype(int)

    # Select same features as LSTM
    feature_cols = [
        "time_in_hospital",
        "num_lab_procedures",
        "num_procedures",
        "num_medications",
        "number_outpatient",
        "number_emergency",
        "number_inpatient",
        "number_diagnoses",
    ]

    # Add A1C if available
    if "A1Cresult" in df.columns:
        a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
        df["a1c_numeric"] = df["A1Cresult"].map(a1c_map).fillna(0)
        feature_cols.append("a1c_numeric")

    df[feature_cols] = df[feature_cols].fillna(0)

    # Take last encounter per patient
    df_flat = df.sort_values("encounter_id").groupby("patient_nbr").last().reset_index()
    print(
        f"✅ Flattened to {len(df_flat)} patients (last encounter per patient)",
        file=sys.stderr,
        flush=True,
    )

    # Scale features
    scaler = StandardScaler()
    df_flat[feature_cols] = scaler.fit_transform(df_flat[feature_cols].astype(float))

    # Label distribution
    print(f" Label distribution:", file=sys.stderr, flush=True)
    for val, name in {0: "NO", 1: ">30", 2: "<30"}.items():
        count = (df_flat["readmitted_class"] == val).sum()
        print(
            f"   {name}: {count} ({count / len(df_flat) * 100:.1f}%)",
            file=sys.stderr,
            flush=True,
        )

    X = df_flat[feature_cols].values
    y = df_flat["readmitted_class"].values

    return X, y, df_flat, feature_cols


def plot_classification_results(
    groups_for_plotting, group_labels, filters_str, output_path, group_by=""
):
    """Plot bar chart of per-group accuracy (matches LSTM plot style)"""
    fig, ax1 = plt.subplots(1, 1, figsize=(10, 7))

    group_names = []
    accuracies = []

    for predictions, true_labels, label in groups_for_plotting:
        group_names.append(label)
        pred_classes = (
            np.argmax(predictions, axis=1)
            if len(predictions.shape) > 1
            else predictions
        )
        acc = np.mean(pred_classes == true_labels)
        accuracies.append(acc)

    x = np.arange(len(group_names))
    width = 0.5
    bars1 = ax1.bar(x, accuracies, width, label="Accuracy", color="#2196F3", alpha=0.85)

    for bar in bars1:
        height = bar.get_height()
        ax1.text(
            bar.get_x() + bar.get_width() / 2.0,
            height + 0.01,
            f"{height:.3f}",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    title_map = {
        "readmit_time": "XGBoost Readmission Classification Accuracy by Outcome Class",
        "a1c_control": "XGBoost Readmission Classification Accuracy by A1C Control Level",
        "age_diabetes": "XGBoost Readmission Classification Accuracy by Age Group",
        "race_diabetes": "XGBoost Readmission Classification Accuracy by Race",
    }
    ax1.set_title(
        title_map.get(group_by, "XGBoost Readmission Classification Accuracy"),
        fontsize=13,
        fontweight="bold",
    )
    ax1.set_xlabel(
        "Readmission Class" if group_by == "readmit_time" else "Group", fontsize=11
    )
    ax1.set_ylabel("Accuracy", fontsize=11)
    ax1.set_ylim([0, 1.1])
    ax1.set_xticks(x)
    ax1.set_xticklabels(group_names, fontsize=10)
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3, axis="y")

    filter_text = (
        f"Filters: {filters_str}" if filters_str and filters_str.strip() else ""
    )
    fig.suptitle(
        f"XGBoost Hospital Readmission Prediction — Diabetes Dataset\n{filter_text}",
        fontsize=14,
        fontweight="bold",
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(
        f"✅ Classification plot saved to {output_path}",
        file=sys.stderr,
        flush=True,
    )
    plt.close()
    
def plot_readmission_probability(race_probabilities, subgroup_key, output_path):
    """
    Plot paper-style readmission probability graph.
    Multiple lines (one per race) on the same plot.

    Args:
        race_probabilities: dict of {race_label: {subgroup_val: {"mean_prob": float, "ci_low": float, "ci_high": float, "n": int}}}
        subgroup_key: str - what the x-axis represents (e.g., "HbA1c Level", "Primary Diagnosis")
        output_path: str - path to save PNG
    """
    fig, ax = plt.subplots(figsize=(12, 7))
    colors = {"African American": "#1f77b4", "Caucasian": "#ff7f0e", "Hispanic": "#2ca02c", "Asian": "#d62728"}
    markers = {"African American": "o", "Caucasian": "s", "Hispanic": "^", "Asian": "D"}

    # Build unified x-axis from ALL races
    all_subgroups = set()
    for subgroup_data in race_probabilities.values():
        if subgroup_data:
            all_subgroups.update(subgroup_data.keys())
    x_labels = sorted(all_subgroups, key=lambda k: str(k))
    x_pos_map = {label: i for i, label in enumerate(x_labels)}

    for race_label, subgroup_data in race_probabilities.items():
        if not subgroup_data:
            continue
        race_labels = [k for k in x_labels if k in subgroup_data]
        race_x = [x_pos_map[k] for k in race_labels]
        means = [subgroup_data[k]["mean_prob"] for k in race_labels]
        ci_lows = [subgroup_data[k]["ci_low"] for k in race_labels]
        ci_highs = [subgroup_data[k]["ci_high"] for k in race_labels]
        ns = [subgroup_data[k]["n"] for k in race_labels]

        yerr_low = [m - cl for m, cl in zip(means, ci_lows)]
        yerr_high = [ch - m for m, ch in zip(means, ci_highs)]

        color = colors.get(race_label, "#333333")
        marker = markers.get(race_label, "o")

        total_n = sum(ns)
        ax.errorbar(
            race_x, means, yerr=[yerr_low, yerr_high],
            label=f"{race_label} (n={total_n})",
            color=color, marker=marker, markersize=8,
            linewidth=2, capsize=4, capthick=1.5,
        )

    ax.set_xticks(np.arange(len(x_labels)))
    ax.set_xticklabels([str(l) for l in x_labels], fontsize=10, rotation=30, ha="right")
    ax.set_xlabel(subgroup_key, fontsize=12)
    ax.set_ylabel("Predicted Probability of Readmission (<30 days)", fontsize=12)
    ax.set_title(f"Readmission Probability by {subgroup_key} Across Races", fontsize=14, fontweight="bold")
    ax.legend(title="Race", fontsize=10, title_fontsize=11)
    ax.grid(True, alpha=0.3)
    ax.set_ylim(bottom=0)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(f"✅ Probability plot saved to {output_path}", file=sys.stderr, flush=True)
    plt.close()


def compute_subgroup_probabilities(df_flat, y_pred_proba, subgroup_col, subgroup_labels=None):
    """
    Compute mean predicted P(readmission <30 days) per subgroup with 95% CI.

    Args:
        df_flat: DataFrame with subgroup columns
        y_pred_proba: numpy array of shape (n_samples, 3) — class probabilities
        subgroup_col: column name in df_flat to group by
        subgroup_labels: optional dict mapping values to display labels
    Returns:
        dict of {subgroup_label: {"mean_prob": float, "ci_low": float, "ci_high": float, "n": int}}
    """
    from scipy import stats

    results = {}
    if subgroup_col not in df_flat.columns:
        return results

    # P(<30 day readmission) is column index 2
    p_readmit = y_pred_proba[:, 2]

    for val in sorted(df_flat[subgroup_col].dropna().unique()):
        mask = df_flat[subgroup_col].values == val
        probs = p_readmit[mask]
        if len(probs) < 5:
            continue
        mean_p = float(np.mean(probs))
        se = float(stats.sem(probs))
        ci_low = max(0, mean_p - 1.96 * se)
        ci_high = min(1, mean_p + 1.96 * se)
        label = subgroup_labels.get(val, str(val)) if subgroup_labels else str(val)
        results[label] = {"mean_prob": mean_p, "ci_low": ci_low, "ci_high": ci_high, "n": len(probs)}

    return results


# ===========================================================================
# SYLHET (BANGLADESH) BINARY CLASSIFICATION MODE
# ===========================================================================


def preprocess_sylhet(df):
    """
    Preprocess Sylhet Diabetes Hospital Bangladesh dataset.
    Binary classification: Positive/Negative diabetes diagnosis.
    Features: Age (numeric) + Gender + 14 binary symptom columns.
    """
    from sklearn.preprocessing import StandardScaler

    print("🇧🇩 Preprocessing Sylhet Bangladesh dataset...", file=sys.stderr, flush=True)

    df.columns = [c.strip() for c in df.columns]

    # Encode target: Positive=1, Negative=0
    target_map = {"Positive": 1, "Negative": 0}
    df["label"] = df["class"].map(target_map)
    df = df.dropna(subset=["label"])
    df["label"] = df["label"].astype(int)

    # Encode Gender: Male=1, Female=0
    df["Gender"] = df["Gender"].map({"Male": 1, "Female": 0})

    # Encode all Yes/No symptom columns
    yes_no_cols = [
        "Polyuria",
        "Polydipsia",
        "sudden weight loss",
        "weakness",
        "Polyphagia",
        "Genital thrush",
        "visual blurring",
        "Itching",
        "Irritability",
        "delayed healing",
        "partial paresis",
        "muscle stiffness",
        "Alopecia",
        "Obesity",
    ]
    for col in yes_no_cols:
        if col in df.columns:
            df[col] = df[col].map({"Yes": 1, "No": 0}).fillna(0).astype(int)

    feature_cols = ["Age", "Gender"] + yes_no_cols
    # Keep only columns that exist
    feature_cols = [c for c in feature_cols if c in df.columns]

    df[feature_cols] = df[feature_cols].fillna(0)

    # Scale Age only (everything else is already 0/1)
    scaler = StandardScaler()
    df["Age"] = scaler.fit_transform(df[["Age"]].astype(float))

    print(
        f"✅ Sylhet preprocessed: {len(df)} patients, {len(feature_cols)} features",
        file=sys.stderr,
        flush=True,
    )
    print(f"   Label distribution:", file=sys.stderr, flush=True)
    for val, name in {1: "Positive", 0: "Negative"}.items():
        count = (df["label"] == val).sum()
        print(
            f"   {name}: {count} ({count / len(df) * 100:.1f}%)",
            file=sys.stderr,
            flush=True,
        )

    X = df[feature_cols].values
    y = df["label"].values

    return X, y, df, feature_cols


def plot_sylhet_classification_results(
    groups_for_plotting, group_labels, filters_str, output_path, group_by=""
):
    """Plot bar chart of per-group accuracy for Sylhet binary classification"""
    fig, ax1 = plt.subplots(1, 1, figsize=(10, 7))

    group_names = []
    accuracies = []

    for predictions, true_labels, label in groups_for_plotting:
        group_names.append(label)
        pred_classes = (
            np.argmax(predictions, axis=1)
            if len(predictions.shape) > 1
            else predictions
        )
        acc = np.mean(pred_classes == true_labels)
        accuracies.append(acc)

    x = np.arange(len(group_names))
    width = 0.5
    bars1 = ax1.bar(x, accuracies, width, label="Accuracy", color="#4CAF50", alpha=0.85)

    for bar in bars1:
        height = bar.get_height()
        ax1.text(
            bar.get_x() + bar.get_width() / 2.0,
            height + 0.01,
            f"{height:.3f}",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    title_map = {
        "gender_sylhet": "XGBoost Diabetes Prediction Accuracy by Gender",
        "age_sylhet": "XGBoost Diabetes Prediction Accuracy by Age Group",
        "obesity_sylhet": "XGBoost Diabetes Prediction Accuracy by Obesity Status",
        "age_cross": "XGBoost Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "XGBoost Diabetes Prediction Accuracy"),
        fontsize=13,
        fontweight="bold",
    )
    ax1.set_xlabel("Group", fontsize=11)
    ax1.set_ylabel("Accuracy", fontsize=11)
    ax1.set_ylim([0, 1.1])
    ax1.set_xticks(x)
    ax1.set_xticklabels(group_names, fontsize=10)
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3, axis="y")

    filter_text = (
        f"Filters: {filters_str}" if filters_str and filters_str.strip() else ""
    )
    fig.suptitle(
        f"XGBoost Diabetes Diagnosis — Sylhet Hospital (Bangladesh)\n{filter_text}",
        fontsize=14,
        fontweight="bold",
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(
        f"✅ Sylhet classification plot saved to {output_path}",
        file=sys.stderr,
        flush=True,
    )
    plt.close()


def run_sylhet_classification(args):
    """Run binary diabetes classification using XGBoost on Sylhet Bangladesh data"""
    start_time = timer.time()

    # Load dataset
    frames = []
    for dataset_path in args.datasets:
        dp = dataset_path.lower()
        if "sylhet" not in dp and "bangladesh" not in dp:
            print(f"⚠️ Skipping non-Sylhet dataset: {dataset_path}", file=sys.stderr)
            continue
        df = pd.read_csv(dataset_path)
        if args.filters:
            for part in args.filters.split(","):
                if "=" not in part:
                    continue
                key, val = part.split("=", 1)
                key, val = key.strip(), val.strip()
                if key in df.columns:
                    # Handle age range filter (e.g., Age=40-50)
                    if key.lower() == "age" and "-" in val:
                        try:
                            low, high = map(int, val.split("-"))
                            df = df[(df[key] >= low) & (df[key] <= high)]
                            print(
                                f"Applied age filter {low}-{high}: {len(df)} rows remain",
                                file=sys.stderr,
                                flush=True,
                            )
                        except Exception as e:
                            print(
                                f"Warning: Failed to apply age filter: {e}",
                                file=sys.stderr,
                                flush=True,
                            )
                    else:
                        try:
                            df = df[df[key] == float(val)]
                        except ValueError:
                            df = df[df[key] == val]
        frames.append(df)

    if not frames:
        print(
            json.dumps(
                {"error": "No Sylhet datasets found", "model": "XGBoost Diabetes"}
            )
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f"🇧🇩 Sylhet dataset: {len(combined)} patients", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_sylhet(combined)
    print(f"📐 Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)

    # Determine grouping
    group_col = None
    group_labels_dict = {}

    if args.group_by == "gender_sylhet":
        if "Gender" in df_flat.columns:
            group_col = "Gender"
            group_labels_dict = {1: "Male", 0: "Female"}

    elif args.group_by == "age_sylhet":
        if "Age" in df_flat.columns:
            # Age is already scaled, use original for binning
            # Re-read raw age for grouping
            raw_frames = []
            for dataset_path in args.datasets:
                dp = dataset_path.lower()
                if "sylhet" in dp or "bangladesh" in dp:
                    raw_frames.append(pd.read_csv(dataset_path))
            if raw_frames:
                raw_age = pd.concat(raw_frames, ignore_index=True)["Age"]
                # Align length after any filtering
                raw_age = raw_age.iloc[: len(df_flat)].reset_index(drop=True)
                df_flat["age_group"] = pd.cut(
                    raw_age,
                    bins=[0, 40, 55, 200],
                    labels=[0, 1, 2],
                    include_lowest=True,
                ).astype(float)
                group_col = "age_group"
                group_labels_dict = {0: "<40 years", 1: "40-55 years", 2: "≥55 years"}

    elif args.group_by == "obesity_sylhet":
        if "Obesity" in df_flat.columns:
            group_col = "Obesity"
            group_labels_dict = {1: "Obese", 0: "Not Obese"}

    elif args.group_by == "age_cross":
        if "Age" in df_flat.columns:
            raw_frames = []
            for dataset_path in args.datasets:
                dp = dataset_path.lower()
                if "sylhet" in dp or "bangladesh" in dp:
                    raw_frames.append(pd.read_csv(dataset_path))
            if raw_frames:
                raw_age = pd.concat(raw_frames, ignore_index=True)["Age"]
                raw_age = raw_age.iloc[: len(df_flat)].reset_index(drop=True)
                df_flat["age_group"] = pd.cut(
                    raw_age,
                    bins=[0, 35, 50, 200],
                    labels=[0, 1, 2],
                    include_lowest=True,
                ).astype(float)
                group_col = "age_group"
                group_labels_dict = {0: "<35 years", 1: "35-50 years", 2: ">50 years"}

    # If a group_by was requested but doesn't match sylhet options, do single run
    if args.group_by and args.group_by not in (
        "gender_sylhet",
        "age_sylhet",
        "obesity_sylhet",
        "age_cross",
        "none",
    ):
        print(
            f"⚠️ group_by={args.group_by} not applicable for Sylhet dataset, running single analysis",
            file=sys.stderr,
            flush=True,
        )

    if group_col and group_col in df_flat.columns:
        unique_groups = sorted(df_flat[group_col].dropna().unique())

        if len(unique_groups) >= 2:
            print(
                f"📊 Group comparison mode: {args.group_by}",
                file=sys.stderr,
                flush=True,
            )

            group_results = []
            groups_for_plotting = []

            for group_val in unique_groups:
                group_mask = df_flat[group_col] == group_val
                group_indices = df_flat[group_mask].index.tolist()

                if len(group_indices) < 5:
                    print(
                        f"⚠️ Skipping {group_labels_dict.get(group_val, f'Group_{group_val}')}: only {len(group_indices)} samples",
                        file=sys.stderr,
                    )
                    continue

                X_group = X[group_indices]
                y_group = labels[group_indices]

                X_train, X_test, y_train, y_test = train_test_split(
                    X_group, y_group, test_size=0.2, random_state=42, stratify=y_group
                )

                print(
                    f"🔬 Training XGBoost for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = xgb.XGBClassifier(
                    n_estimators=100,
                    max_depth=4,
                    learning_rate=0.1,
                    objective="binary:logistic",
                    eval_metric="logloss",
                    random_state=42,
                    use_label_encoder=False,
                    verbosity=0,
                )

                step_start = timer.time()
                model.fit(X_train, y_train)
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred_proba = model.predict_proba(X_test)[:, 1]
                y_pred_classes = model.predict(X_test)

                accuracy = np.mean(y_pred_classes == y_test)
                try:
                    auc = roc_auc_score(y_test, y_pred_proba)
                except Exception:
                    auc = None

                print(
                    f"✅ {group_labels_dict.get(group_val, f'Group_{group_val}')}: Accuracy={accuracy:.4f}"
                    + (f", AUC={auc:.4f}" if auc else ""),
                    file=sys.stderr,
                    flush=True,
                )

                group_results.append(
                    {
                        "group": group_labels_dict.get(group_val, f"Group_{group_val}"),
                        "n_samples": len(X_group),
                        "n_events": int(np.sum(y_group == 1)),
                        "accuracy": float(accuracy),
                        "auc": float(auc) if auc else None,
                    }
                )

                groups_for_plotting.append(
                    (
                        y_pred_classes,
                        y_test,
                        group_labels_dict.get(group_val, f"Group_{group_val}"),
                    )
                )

            image_path = None
            if len(groups_for_plotting) >= 1 and args.output_image:
                image_path = args.output_image
                plot_sylhet_classification_results(
                    groups_for_plotting,
                    group_labels_dict,
                    args.filters,
                    image_path,
                    group_by=args.group_by,
                )

            output = {
                "model": "XGBoost Diabetes Prediction (Group Comparison)",
                "n_features": X.shape[1],
                "group_by": args.group_by,
                "groups_compared": [
                    group_labels_dict.get(g, f"Group_{g}") for g in unique_groups
                ],
                "group_results": group_results,
                "filters_applied": args.filters if args.filters else "None",
            }
            if image_path:
                output["image_path"] = image_path

            print(json.dumps(output, indent=2))
            total_elapsed = timer.time() - start_time
            print(
                f"⏱️ Total execution time: {total_elapsed:.1f}s",
                file=sys.stderr,
                flush=True,
            )
            return

    # SINGLE (no grouping) — train on full dataset
    print("📊 Single analysis mode (no grouping)", file=sys.stderr, flush=True)

    X_train, X_test, y_train, y_test = train_test_split(
        X, labels, test_size=0.2, random_state=42, stratify=labels
    )

    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        use_label_encoder=False,
        verbosity=0,
    )

    step_start = timer.time()
    model.fit(X_train, y_train)
    print(
        f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True
    )

    y_pred_proba = model.predict_proba(X_test)[:, 1]
    y_pred_classes = model.predict(X_test)

    accuracy = np.mean(y_pred_classes == y_test)
    try:
        auc = roc_auc_score(y_test, y_pred_proba)
    except Exception:
        auc = None

    print(
        f"✅ Overall: Accuracy={accuracy:.4f}" + (f", AUC={auc:.4f}" if auc else ""),
        file=sys.stderr,
        flush=True,
    )

    output = {
        "model": "XGBoost Diabetes Prediction",
        "n_samples": len(X),
        "n_features": X.shape[1],
        "n_positive": int(np.sum(labels == 1)),
        "n_negative": int(np.sum(labels == 0)),
        "accuracy": float(accuracy),
        "auc": float(auc) if auc else None,
        "filters_applied": args.filters if args.filters else "None",
    }

    print(json.dumps(output, indent=2))
    total_elapsed = timer.time() - start_time
    print(f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True)


# ===========================================================================
# PIMA INDIANS (USA) BINARY CLASSIFICATION MODE
# ===========================================================================


def preprocess_pima(df):
    """
    Preprocess Pima Indians Diabetes USA dataset.
    Binary classification: 1=diabetic, 0=non-diabetic.
    Features: 8 clinical/lab measurements.
    """
    from sklearn.preprocessing import StandardScaler

    print(
        "🇺🇸 Preprocessing Pima Indians Diabetes USA dataset...",
        file=sys.stderr,
        flush=True,
    )

    df.columns = [c.strip() for c in df.columns]

    # Target column
    df["label"] = df["Outcome"].astype(int)

    # Handle known zero-value issues (0 = missing for Glucose, BP, SkinThickness, Insulin, BMI)
    zero_as_nan_cols = ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]
    for col in zero_as_nan_cols:
        if col in df.columns:
            df[col] = df[col].replace(0, np.nan)
            df[col] = df[col].fillna(df[col].median())

    feature_cols = [
        "Pregnancies",
        "Glucose",
        "BloodPressure",
        "SkinThickness",
        "Insulin",
        "BMI",
        "DiabetesPedigreeFunction",
        "Age",
    ]
    feature_cols = [c for c in feature_cols if c in df.columns]

    df[feature_cols] = df[feature_cols].fillna(0)

    # Scale all features
    scaler = StandardScaler()
    df[feature_cols] = scaler.fit_transform(df[feature_cols].astype(float))

    print(
        f"✅ Pima preprocessed: {len(df)} patients, {len(feature_cols)} features",
        file=sys.stderr,
        flush=True,
    )
    print(f"   Label distribution:", file=sys.stderr, flush=True)
    for val, name in {1: "Diabetic", 0: "Non-Diabetic"}.items():
        count = (df["label"] == val).sum()
        print(
            f"   {name}: {count} ({count / len(df) * 100:.1f}%)",
            file=sys.stderr,
            flush=True,
        )

    X = df[feature_cols].values
    y = df["label"].values

    return X, y, df, feature_cols


def plot_pima_classification_results(
    groups_for_plotting, group_labels, filters_str, output_path, group_by=""
):
    """Plot bar chart of per-group accuracy for Pima binary classification"""
    fig, ax1 = plt.subplots(1, 1, figsize=(10, 7))

    group_names = []
    accuracies = []

    for predictions, true_labels, label in groups_for_plotting:
        group_names.append(label)
        pred_classes = (
            np.argmax(predictions, axis=1)
            if len(predictions.shape) > 1
            else predictions
        )
        acc = np.mean(pred_classes == true_labels)
        accuracies.append(acc)

    x = np.arange(len(group_names))
    width = 0.5
    bars1 = ax1.bar(x, accuracies, width, label="Accuracy", color="#2196F3", alpha=0.85)

    for bar in bars1:
        height = bar.get_height()
        ax1.text(
            bar.get_x() + bar.get_width() / 2.0,
            height + 0.01,
            f"{height:.3f}",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    title_map = {
        "age_pima": "XGBoost Diabetes Prediction Accuracy by Age Group",
        "bmi_pima": "XGBoost Diabetes Prediction Accuracy by BMI Category",
        "glucose_pima": "XGBoost Diabetes Prediction Accuracy by Glucose Level",
        "age_cross": "XGBoost Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "XGBoost Diabetes Prediction Accuracy"),
        fontsize=13,
        fontweight="bold",
    )
    ax1.set_xlabel("Group", fontsize=11)
    ax1.set_ylabel("Accuracy", fontsize=11)
    ax1.set_ylim([0, 1.1])
    ax1.set_xticks(x)
    ax1.set_xticklabels(group_names, fontsize=10)
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3, axis="y")

    filter_text = (
        f"Filters: {filters_str}" if filters_str and filters_str.strip() else ""
    )
    fig.suptitle(
        f"XGBoost Diabetes Diagnosis — Pima Indians (USA)\n{filter_text}",
        fontsize=14,
        fontweight="bold",
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(
        f"✅ Pima classification plot saved to {output_path}",
        file=sys.stderr,
        flush=True,
    )
    plt.close()


def run_pima_classification(args):
    """Run binary diabetes classification using XGBoost on Pima Indians USA data"""
    start_time = timer.time()

    frames = []
    for dataset_path in args.datasets:
        dp = dataset_path.lower()
        if "pima" not in dp:
            print(f"⚠️ Skipping non-Pima dataset: {dataset_path}", file=sys.stderr)
            continue
        df = pd.read_csv(dataset_path)
        if args.filters:
            for part in args.filters.split(","):
                if "=" not in part:
                    continue
                key, val = part.split("=", 1)
                key, val = key.strip(), val.strip()
                if key in df.columns:
                    if key.lower() == "age" and "-" in val:
                        try:
                            low, high = map(int, val.split("-"))
                            df = df[(df[key] >= low) & (df[key] <= high)]
                            print(
                                f"Applied age filter {low}-{high}: {len(df)} rows remain",
                                file=sys.stderr,
                                flush=True,
                            )
                        except Exception as e:
                            print(
                                f"Warning: Failed to apply age filter: {e}",
                                file=sys.stderr,
                                flush=True,
                            )
                    else:
                        try:
                            df = df[df[key] == float(val)]
                        except ValueError:
                            df = df[df[key] == val]
        frames.append(df)

    if not frames:
        print(
            json.dumps({"error": "No Pima datasets found", "model": "XGBoost Diabetes"})
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f"🇺🇸 Pima dataset: {len(combined)} patients", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_pima(combined)
    print(f"📐 Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)

    # Determine grouping
    group_col = None
    group_labels_dict = {}

    if args.group_by == "age_pima":
        # Use raw age for binning (before scaling)
        raw_frames = []
        for dataset_path in args.datasets:
            if "pima" in dataset_path.lower():
                raw_frames.append(pd.read_csv(dataset_path))
        if raw_frames:
            raw_age = pd.concat(raw_frames, ignore_index=True)["Age"]
            raw_age = raw_age.iloc[: len(df_flat)].reset_index(drop=True)
            df_flat["age_group"] = pd.cut(
                raw_age, bins=[0, 30, 45, 200], labels=[0, 1, 2], include_lowest=True
            ).astype(float)
            group_col = "age_group"
            group_labels_dict = {0: "<30 years", 1: "30-45 years", 2: ">45 years"}

    elif args.group_by == "bmi_pima":
        raw_frames = []
        for dataset_path in args.datasets:
            if "pima" in dataset_path.lower():
                raw_frames.append(pd.read_csv(dataset_path))
        if raw_frames:
            raw_bmi = pd.concat(raw_frames, ignore_index=True)["BMI"]
            raw_bmi = raw_bmi.iloc[: len(df_flat)].reset_index(drop=True)
            df_flat["bmi_group"] = pd.cut(
                raw_bmi, bins=[0, 25, 30, 100], labels=[0, 1, 2], include_lowest=True
            ).astype(float)
            group_col = "bmi_group"
            group_labels_dict = {
                0: "Normal (<25)",
                1: "Overweight (25-30)",
                2: "Obese (>30)",
            }

    elif args.group_by == "glucose_pima":
        raw_frames = []
        for dataset_path in args.datasets:
            if "pima" in dataset_path.lower():
                raw_frames.append(pd.read_csv(dataset_path))
        if raw_frames:
            raw_glucose = pd.concat(raw_frames, ignore_index=True)["Glucose"]
            raw_glucose = raw_glucose.iloc[: len(df_flat)].reset_index(drop=True)
            df_flat["glucose_group"] = pd.cut(
                raw_glucose,
                bins=[0, 100, 140, 500],
                labels=[0, 1, 2],
                include_lowest=True,
            ).astype(float)
            group_col = "glucose_group"
            group_labels_dict = {
                0: "Normal (<100)",
                1: "Prediabetic (100-140)",
                2: "Diabetic (>140)",
            }

    elif args.group_by == "age_cross":
        raw_frames = []
        for dataset_path in args.datasets:
            if "pima" in dataset_path.lower():
                raw_frames.append(pd.read_csv(dataset_path))
        if raw_frames:
            raw_age = pd.concat(raw_frames, ignore_index=True)["Age"]
            raw_age = raw_age.iloc[: len(df_flat)].reset_index(drop=True)
            df_flat["age_group"] = pd.cut(
                raw_age, bins=[0, 35, 50, 200], labels=[0, 1, 2], include_lowest=True
            ).astype(float)
            group_col = "age_group"
            group_labels_dict = {0: "<35 years", 1: "35-50 years", 2: ">50 years"}

    # If group_by doesn't match pima options, do single run
    if args.group_by and args.group_by not in (
        "age_pima",
        "bmi_pima",
        "glucose_pima",
        "age_cross",
        "none",
    ):
        print(
            f"⚠️ group_by={args.group_by} not applicable for Pima dataset, running single analysis",
            file=sys.stderr,
            flush=True,
        )

    if group_col and group_col in df_flat.columns:
        unique_groups = sorted(df_flat[group_col].dropna().unique())

        if len(unique_groups) >= 2:
            print(
                f"📊 Group comparison mode: {args.group_by}",
                file=sys.stderr,
                flush=True,
            )

            group_results = []
            groups_for_plotting = []

            for group_val in unique_groups:
                group_mask = df_flat[group_col] == group_val
                group_indices = df_flat[group_mask].index.tolist()

                if len(group_indices) < 5:
                    print(
                        f"⚠️ Skipping {group_labels_dict.get(group_val, f'Group_{group_val}')}: only {len(group_indices)} samples",
                        file=sys.stderr,
                    )
                    continue

                X_group = X[group_indices]
                y_group = labels[group_indices]

                X_train, X_test, y_train, y_test = train_test_split(
                    X_group, y_group, test_size=0.2, random_state=42, stratify=y_group
                )

                print(
                    f"🔬 Training XGBoost for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = xgb.XGBClassifier(
                    n_estimators=100,
                    max_depth=4,
                    learning_rate=0.1,
                    objective="binary:logistic",
                    eval_metric="logloss",
                    random_state=42,
                    use_label_encoder=False,
                    verbosity=0,
                )

                step_start = timer.time()
                model.fit(X_train, y_train)
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred_proba = model.predict_proba(X_test)[:, 1]
                y_pred_classes = model.predict(X_test)

                accuracy = np.mean(y_pred_classes == y_test)
                try:
                    auc = roc_auc_score(y_test, y_pred_proba)
                except Exception:
                    auc = None

                print(
                    f"✅ {group_labels_dict.get(group_val, f'Group_{group_val}')}: Accuracy={accuracy:.4f}"
                    + (f", AUC={auc:.4f}" if auc else ""),
                    file=sys.stderr,
                    flush=True,
                )

                group_results.append(
                    {
                        "group": group_labels_dict.get(group_val, f"Group_{group_val}"),
                        "n_samples": len(X_group),
                        "n_events": int(np.sum(y_group == 1)),
                        "accuracy": float(accuracy),
                        "auc": float(auc) if auc else None,
                    }
                )

                groups_for_plotting.append(
                    (
                        y_pred_classes,
                        y_test,
                        group_labels_dict.get(group_val, f"Group_{group_val}"),
                    )
                )

            image_path = None
            if len(groups_for_plotting) >= 1 and args.output_image:
                image_path = args.output_image
                plot_pima_classification_results(
                    groups_for_plotting,
                    group_labels_dict,
                    args.filters,
                    image_path,
                    group_by=args.group_by,
                )

            output = {
                "model": "XGBoost Diabetes Prediction (Group Comparison)",
                "n_features": X.shape[1],
                "group_by": args.group_by,
                "groups_compared": [
                    group_labels_dict.get(g, f"Group_{g}") for g in unique_groups
                ],
                "group_results": group_results,
                "filters_applied": args.filters if args.filters else "None",
            }
            if image_path:
                output["image_path"] = image_path

            print(json.dumps(output, indent=2))
            total_elapsed = timer.time() - start_time
            print(
                f"⏱️ Total execution time: {total_elapsed:.1f}s",
                file=sys.stderr,
                flush=True,
            )
            return

    # SINGLE (no grouping)
    print("📊 Single analysis mode (no grouping)", file=sys.stderr, flush=True)

    X_train, X_test, y_train, y_test = train_test_split(
        X, labels, test_size=0.2, random_state=42, stratify=labels
    )

    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        use_label_encoder=False,
        verbosity=0,
    )

    step_start = timer.time()
    model.fit(X_train, y_train)
    print(
        f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True
    )

    y_pred_proba = model.predict_proba(X_test)[:, 1]
    y_pred_classes = model.predict(X_test)

    accuracy = np.mean(y_pred_classes == y_test)
    try:
        auc = roc_auc_score(y_test, y_pred_proba)
    except Exception:
        auc = None

    print(
        f"✅ Overall: Accuracy={accuracy:.4f}" + (f", AUC={auc:.4f}" if auc else ""),
        file=sys.stderr,
        flush=True,
    )

    output = {
        "model": "XGBoost Diabetes Prediction",
        "n_samples": len(X),
        "n_features": X.shape[1],
        "n_positive": int(np.sum(labels == 1)),
        "n_negative": int(np.sum(labels == 0)),
        "accuracy": float(accuracy),
        "auc": float(auc) if auc else None,
        "filters_applied": args.filters if args.filters else "None",
    }

    print(json.dumps(output, indent=2))
    total_elapsed = timer.time() - start_time
    print(f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True)


def run_diabetes_classification(args):
    """Run 3-class readmission classification using XGBoost on diabetic data"""
    from sklearn.utils.class_weight import compute_class_weight

    start_time = timer.time()

    # Load and combine diabetic datasets
    frames = []
    for dataset_path in args.datasets:
        if "diabetic" not in dataset_path.lower() and "readmission" not in dataset_path.lower():
            print(f"⚠️ Skipping non-diabetic dataset: {dataset_path}", file=sys.stderr)
            continue
        df = pd.read_csv(dataset_path)
        # Apply filters using the diabetic-compatible filter function
        if args.filters:
            for part in args.filters.split(","):
                if "=" not in part:
                    continue
                key, val = part.split("=", 1)
                key, val = key.strip(), val.strip()
                if key in df.columns:
                    # Handle age range filter (e.g., Age=40-50)
                    if key.lower() == "age" and "-" in val:
                        try:
                            low, high = map(int, val.split("-"))
                            df = df[(df[key] >= low) & (df[key] <= high)]
                            print(
                                f"Applied age filter {low}-{high}: {len(df)} rows remain",
                                file=sys.stderr,
                                flush=True,
                            )
                        except Exception as e:
                            print(
                                f"Warning: Failed to apply age filter: {e}",
                                file=sys.stderr,
                                flush=True,
                            )
                    else:
                        try:
                            df = df[df[key] == float(val)]
                        except ValueError:
                            df = df[df[key] == val]
        frames.append(df)

    if not frames:
        print(
            json.dumps(
                {"error": "No diabetic datasets found", "model": "XGBoost Readmission"}
            )
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f" Combined dataset: {len(combined)} encounters", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_diabetic_flat(combined)

    print(f" Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)
    
    # ===== CROSS-RACE PROBABILITY MODE =====
    # If multiple race-split datasets were passed, run probability comparison
    race_datasets = [(d, extract_race_from_filename(d)) for d in args.datasets
                     if extract_race_from_filename(d) is not None]

    if len(race_datasets) >= 2:
        print(f"🏥 Cross-race probability mode: {len(race_datasets)} race datasets detected",
              file=sys.stderr, flush=True)

        from sklearn.utils.class_weight import compute_class_weight
        from scipy import stats

        all_race_probs = {}  # {subgroup_key: {race: {subgroup_val: prob_data}}}
        race_metrics = []

        for dataset_path, race_label in race_datasets:
            print(f"\n{'='*60}", file=sys.stderr, flush=True)
            print(f"Processing {race_label}...", file=sys.stderr, flush=True)

            df_race = pd.read_csv(dataset_path)
            if args.filters:
                for part in args.filters.split(","):
                    if "=" not in part:
                        continue
                    key, val = part.split("=", 1)
                    key, val = key.strip(), val.strip()
                    if key in df_race.columns:
                        try:
                            df_race = df_race[df_race[key] == float(val)]
                        except ValueError:
                            df_race = df_race[df_race[key] == val]

            X_race, labels_race, df_flat_race, _ = preprocess_diabetic_flat(df_race)

            if len(X_race) < 20:
                print(f"⚠️ Skipping {race_label}: only {len(X_race)} samples", file=sys.stderr)
                continue

            X_train, X_test, y_train, y_test = train_test_split(
                X_race, labels_race, test_size=0.2, random_state=42, stratify=labels_race
            )

            # Compute class weights
            class_weights = compute_class_weight("balanced", classes=np.array([0, 1, 2]), y=y_train)
            sample_weights = np.array([class_weights[y] for y in y_train])

            model = xgb.XGBClassifier(
                n_estimators=100, max_depth=6, learning_rate=0.1,
                objective="multi:softprob", num_class=3, eval_metric="mlogloss",
                random_state=42, use_label_encoder=False, verbosity=0,
            )

            step_start = timer.time()
            model.fit(X_train, y_train, sample_weight=sample_weights)
            print(f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True)

            y_pred_proba = model.predict_proba(X_test)
            y_pred_classes = model.predict(X_test)
            accuracy = float(np.mean(y_pred_classes == y_test))

            try:
                auc_scores = [roc_auc_score((y_test == i).astype(int), y_pred_proba[:, i]) for i in range(3)]
                avg_auc = float(np.mean(auc_scores))
            except Exception:
                avg_auc = None

            print(f"✅ {race_label}: Accuracy={accuracy:.4f}" + (f", AUC={avg_auc:.4f}" if avg_auc else ""),
                  file=sys.stderr, flush=True)

            race_metrics.append({
                "race": race_label,
                "n_samples": len(X_race),
                "n_train": len(X_train),
                "n_test": len(X_test),
                "accuracy": accuracy,
                "auc": avg_auc,
            })

            # Build df_test for subgroup analysis (align with test indices)
            test_indices = y_test  # we need df_flat_race aligned to test set
            # Re-split df_flat_race the same way to get test portion
            _, df_test_race, _, _ = train_test_split(
                df_flat_race, labels_race, test_size=0.2, random_state=42, stratify=labels_race
            )
            df_test_race = df_test_race.reset_index(drop=True)

            # --- Subgroup: HbA1c ---
            if "A1Cresult" in df_test_race.columns:
                a1c_labels = {0: "No test", 1: "Normal", 2: ">7%", 3: ">8%"}
                a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
                df_test_race["a1c_group"] = df_test_race["A1Cresult"].map(a1c_map).fillna(0)
                probs = compute_subgroup_probabilities(df_test_race, y_pred_proba, "a1c_group", a1c_labels)
                all_race_probs.setdefault("HbA1c Level", {})[race_label] = probs

            # --- Subgroup: Primary Diagnosis ---
            if "diag_1" in df_test_race.columns:
                def classify_diagnosis(code):
                    try:
                        c = float(code)
                    except (ValueError, TypeError):
                        return "Other"
                    if 390 <= c <= 459 or c == 785:
                        return "Circulatory"
                    elif 250 <= c < 251:
                        return "Diabetes"
                    elif 460 <= c <= 519 or c == 786:
                        return "Respiratory"
                    elif 520 <= c <= 579 or c == 787:
                        return "Digestive"
                    elif 800 <= c <= 999:
                        return "Injury"
                    elif 710 <= c <= 739:
                        return "Musculoskeletal"
                    elif 580 <= c <= 629 or c == 788:
                        return "Genitourinary"
                    elif 140 <= c <= 239:
                        return "Neoplasms"
                    else:
                        return "Other"

                df_test_race["diag_group"] = df_test_race["diag_1"].apply(classify_diagnosis)
                diag_vals = sorted(df_test_race["diag_group"].unique())
                diag_labels = {v: v for v in diag_vals}
                probs = compute_subgroup_probabilities(df_test_race, y_pred_proba, "diag_group", diag_labels)
                all_race_probs.setdefault("Primary Diagnosis", {})[race_label] = probs

            # --- Subgroup: Age ---
            if "age" in df_test_race.columns:
                # age column is bracket string like "[50-60)"
                def age_bracket_to_group(bracket):
                    try:
                        low = int(bracket.strip("[()").split("-")[0])
                    except (ValueError, AttributeError):
                        return "Unknown"
                    if low < 30:
                        return "<30"
                    elif low < 50:
                        return "30-49"
                    elif low < 70:
                        return "50-69"
                    else:
                        return "≥70"

                df_test_race["age_group"] = df_test_race["age"].apply(age_bracket_to_group)
                age_vals = sorted(df_test_race["age_group"].unique())
                age_labels = {v: v for v in age_vals}
                probs = compute_subgroup_probabilities(df_test_race, y_pred_proba, "age_group", age_labels)
                all_race_probs.setdefault("Age Group", {})[race_label] = probs

        # Generate plots
        if args.output_image and all_race_probs:
            base_path = args.output_image.rsplit(".", 1)[0]
            image_paths = []
            for subgroup_key, race_data in all_race_probs.items():
                safe_key = subgroup_key.replace(" ", "_").lower()
                img_path = f"{base_path}_{safe_key}.png"
                plot_readmission_probability(race_data, subgroup_key, img_path)
                image_paths.append(img_path)

        output = {
            "model": "XGBoost Cross-Race Readmission Probability",
            "mode": "cross_race_probability",
            "n_races": len(race_metrics),
            "race_metrics": race_metrics,
            "subgroups_analyzed": list(all_race_probs.keys()),
            "probability_data": {
                sg: {race: {k: v["mean_prob"] for k, v in subgroups.items()}
                     for race, subgroups in race_data.items()}
                for sg, race_data in all_race_probs.items()
            },
            "filters_applied": args.filters if args.filters else "None",
        }

        if args.output_image and all_race_probs:
            output["image_paths"] = image_paths
            output["image_path"] = image_paths[0] if image_paths else None

        print(json.dumps(output, indent=2))
        total_elapsed = timer.time() - start_time
        print(f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True)
        return

    # Determine grouping
    group_col = None
    group_labels_dict = {}

    if args.group_by == "readmit_time":
        # Train single model, report per-class metrics
        print(
            f" Readmission timing mode: training single model, reporting per-class metrics",
            file=sys.stderr,
            flush=True,
        )

        X_train, X_test, y_train, y_test = train_test_split(
            X, labels, test_size=0.2, random_state=42, stratify=labels
        )

        # Compute class weights
        class_weights = compute_class_weight(
            "balanced", classes=np.array([0, 1, 2]), y=y_train
        )
        sample_weights = np.array([class_weights[y] for y in y_train])

        print(
            f"🔬 Training XGBoost: {len(X_train)} train, {len(X_test)} test",
            file=sys.stderr,
            flush=True,
        )

        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            objective="multi:softprob",
            num_class=3,
            eval_metric="mlogloss",
            random_state=42,
            use_label_encoder=False,
            verbosity=0,
        )

        step_start = timer.time()
        model.fit(X_train, y_train, sample_weight=sample_weights)
        print(
            f"⏱️ Training took {timer.time() - step_start:.1f}s",
            file=sys.stderr,
            flush=True,
        )

        y_pred_proba = model.predict_proba(X_test)
        y_pred_classes = model.predict(X_test)

        overall_accuracy = np.mean(y_pred_classes == y_test)

        class_names = {0: "NO readmission", 1: ">30 days", 2: "<30 days"}
        group_results = []

        for class_id, class_name in class_names.items():
            class_mask = y_test == class_id
            if class_mask.sum() == 0:
                continue
            class_acc = np.mean(y_pred_classes[class_mask] == class_id)
            try:
                class_auc = roc_auc_score(
                    (y_test == class_id).astype(int), y_pred_proba[:, class_id]
                )
            except Exception:
                class_auc = None

            group_results.append(
                {
                    "group": class_name,
                    "n_samples": int(class_mask.sum()),
                    "n_events": int(np.sum(labels == class_id)),
                    "accuracy": float(class_acc),
                    "auc": float(class_auc) if class_auc else None,
                }
            )
            print(
                (
                    f"✅ {class_name}: Accuracy={class_acc:.4f}, AUC={class_auc:.4f}"
                    if class_auc
                    else f"✅ {class_name}: Accuracy={class_acc:.4f}"
                ),
                file=sys.stderr,
                flush=True,
            )

        image_path = None
        if args.output_image:
            image_path = args.output_image
            groups_for_plotting = []
            for class_id, class_name in class_names.items():
                class_mask = y_test == class_id
                if class_mask.sum() > 0:
                    groups_for_plotting.append(
                        (y_pred_classes[class_mask], y_test[class_mask], class_name)
                    )
            if groups_for_plotting:
                plot_classification_results(
                    groups_for_plotting,
                    class_names,
                    args.filters,
                    image_path,
                    group_by=args.group_by,
                )

        output = {
            "model": "XGBoost Readmission Prediction (Group Comparison)",
            "n_features": X.shape[1],
            "group_by": args.group_by,
            "groups_compared": list(class_names.values()),
            "group_results": group_results,
            "overall_accuracy": float(overall_accuracy),
            "filters_applied": args.filters if args.filters else "None",
        }
        if image_path:
            output["image_path"] = image_path

        print(json.dumps(output, indent=2))
        total_elapsed = timer.time() - start_time
        print(
            f"⏱️ Total execution time: {total_elapsed:.1f}s",
            file=sys.stderr,
            flush=True,
        )
        return

    # GROUP COMPARISON MODE for other groupings
    elif args.group_by == "a1c_control":
        if "A1Cresult" in df_flat.columns:
            a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
            df_flat["a1c_group"] = df_flat["A1Cresult"].map(a1c_map).fillna(0)
            group_col = "a1c_group"
            group_labels_dict = {0: "No test", 1: "Normal", 2: ">7%", 3: ">8%"}

    elif args.group_by == "age_diabetes":
        if "age" in df_flat.columns:
            age_bins = [0, 50, 70, 150]
            age_labels_vals = [0, 1, 2]
            df_flat["age_group"] = pd.cut(
                df_flat["age"].str.extract(r"(\d+)", expand=False).astype(float),
                bins=age_bins,
                labels=age_labels_vals,
                include_lowest=True,
            )
            group_col = "age_group"
            group_labels_dict = {0: "<50 years", 1: "50-70 years", 2: "≥70 years"}

    elif args.group_by == "race_diabetes":
        if "race" in df_flat.columns:
            race_map = {
                "Caucasian": 0,
                "AfricanAmerican": 1,
                "Hispanic": 2,
                "Asian": 3,
                "Other": 4,
            }
            df_flat["race_group"] = df_flat["race"].map(race_map).fillna(4)
            group_col = "race_group"
            group_labels_dict = {
                0: "Caucasian",
                1: "African American",
                2: "Hispanic",
                3: "Asian",
                4: "Other",
            }

    if group_col and group_col in df_flat.columns:
        unique_groups = sorted(df_flat[group_col].dropna().unique())

        if len(unique_groups) >= 2:
            print(
                f" Group comparison mode: {args.group_by}",
                file=sys.stderr,
                flush=True,
            )

            group_results = []
            groups_for_plotting = []

            for group_val in unique_groups:
                group_mask = df_flat[group_col] == group_val
                group_indices = df_flat[group_mask].index.tolist()

                if len(group_indices) < 10:
                    print(
                        f"⚠️ Skipping {group_labels_dict.get(group_val, f'Group_{group_val}')}: only {len(group_indices)} samples",
                        file=sys.stderr,
                    )
                    continue

                X_group = X[group_indices]
                y_group = labels[group_indices]

                X_train, X_test, y_train, y_test = train_test_split(
                    X_group, y_group, test_size=0.2, random_state=42, stratify=y_group
                )

                print(
                    f"🔬 Training XGBoost for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = xgb.XGBClassifier(
                    n_estimators=100,
                    max_depth=6,
                    learning_rate=0.1,
                    objective="multi:softprob",
                    num_class=3,
                    eval_metric="mlogloss",
                    random_state=42,
                    use_label_encoder=False,
                    verbosity=0,
                )

                step_start = timer.time()
                model.fit(X_train, y_train)
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred_proba = model.predict_proba(X_test)
                y_pred_classes = model.predict(X_test)

                accuracy = np.mean(y_pred_classes == y_test)

                try:
                    auc_scores = []
                    for i in range(3):
                        auc = roc_auc_score(
                            (y_test == i).astype(int), y_pred_proba[:, i]
                        )
                        auc_scores.append(auc)
                    avg_auc = np.mean(auc_scores)
                except Exception:
                    avg_auc = None

                print(
                    f"✅ {group_labels_dict.get(group_val, f'Group_{group_val}')}: Accuracy = {accuracy:.4f}",
                    file=sys.stderr,
                    flush=True,
                )

                group_results.append(
                    {
                        "group": group_labels_dict.get(group_val, f"Group_{group_val}"),
                        "n_samples": len(X_group),
                        "n_events": int(np.sum(y_group == 2)),
                        "accuracy": float(accuracy),
                        "auc": float(avg_auc) if avg_auc else None,
                    }
                )

                groups_for_plotting.append(
                    (
                        y_pred_classes,
                        y_test,
                        group_labels_dict.get(group_val, f"Group_{group_val}"),
                    )
                )

            image_path = None
            if len(groups_for_plotting) >= 1 and args.output_image:
                image_path = args.output_image
                plot_classification_results(
                    groups_for_plotting,
                    group_labels_dict,
                    args.filters,
                    image_path,
                    group_by=args.group_by,
                )

            output = {
                "model": "XGBoost Readmission Prediction (Group Comparison)",
                "n_features": X.shape[1],
                "group_by": args.group_by,
                "groups_compared": [
                    group_labels_dict.get(g, f"Group_{g}") for g in unique_groups
                ],
                "group_results": group_results,
                "filters_applied": args.filters if args.filters else "None",
            }

            if image_path:
                output["image_path"] = image_path

            print(json.dumps(output, indent=2))

    total_elapsed = timer.time() - start_time
    print(
        f"⏱️ Total execution time: {total_elapsed:.1f}s",
        file=sys.stderr,
        flush=True,
    )


def main():
    start_time = timer.time()

    parser = argparse.ArgumentParser(
        description="XGBoost Survival Analysis with Group Comparison"
    )
    parser.add_argument(
        "--vars", type=str, default="all", help="Comma-separated variables or 'all'"
    )
    parser.add_argument(
        "--filters",
        type=str,
        default="",
        help="Filters (e.g., age_range=40-50,grade=2)",
    )
    parser.add_argument(
        "--group-by",
        type=str,
        default="race",
        help="Group by: race, meno, grade, er, pgr, age, nodes",
    )
    parser.add_argument(
        "--output-image",
        type=str,
        default="",
        help="Path to save survival curve image (optional)",
    )
    parser.add_argument("datasets", nargs="+", help="Dataset file paths")
    args = parser.parse_args()

    # Early branch: Pima Indians USA dataset
    if any("pima" in d.lower() for d in args.datasets):
        print(
            "🔀 Pima Indians USA dataset detected — switching to binary classification mode",
            file=sys.stderr,
            flush=True,
        )
        run_pima_classification(args)
        sys.exit(0)

    # Early branch: Sylhet Bangladesh dataset
    if any("sylhet" in d.lower() or "bangladesh" in d.lower() for d in args.datasets):
        print(
            "🔀 Sylhet Bangladesh dataset detected — switching to binary classification mode",
            file=sys.stderr,
            flush=True,
        )
        run_sylhet_classification(args)
        sys.exit(0)

    # Early branch: if any dataset is diabetic/readmission, run classification mode
    if any("diabetic" in d.lower() or "readmission" in d.lower() for d in args.datasets):
        print(
            "🔀 Diabetic dataset detected — switching to classification mode",
            file=sys.stderr,
            flush=True,
        )
        run_diabetes_classification(args)
        sys.exit(0)

    # Load and combine datasets
    frames = []
    for dataset_path in args.datasets:
        dataset_type = detect_dataset_type(dataset_path)
        df = pd.read_csv(dataset_path)
        df = canonicalise_columns(df, dataset_type)
        df = apply_filters(df, args.filters)
        frames.append(df)

    combined = pd.concat(frames, ignore_index=True)
    print(f"Combined dataset: {len(combined)} rows", file=sys.stderr, flush=True)

    # Prepare features
    TIME_EVENT_CANDIDATES = [
        ("rfstime", "status"),
        ("survival_months", "death_status"),
        ("survival_months", "status"),
        ("time", "event"),
    ]

    time_col, event_col = None, None
    for tcol, ecol in TIME_EVENT_CANDIDATES:
        if tcol in combined.columns and ecol in combined.columns:
            time_col, event_col = tcol, ecol
            break

    if not time_col or not event_col:
        print(f"Error: Could not find time/event columns", file=sys.stderr)
        sys.exit(1)

    # Prepare features (exclude time and event from features)
    X = combined.drop(columns=[time_col, event_col, "pid"], errors="ignore")

    # Handle categorical variables
    for col in X.select_dtypes(include=["object", "category"]).columns:
        X[col] = pd.Categorical(X[col]).codes

    # Handle missing values
    X = X.fillna(X.median())

    # Remove zero-variance columns
    variances = X.var()
    zero_var_cols = variances[variances == 0].index
    if len(zero_var_cols) > 0:
        X = X.drop(columns=zero_var_cols)

    print(
        f"Features prepared: {X.shape[1]} features, {X.shape[0]} samples",
        file=sys.stderr,
        flush=True,
    )

    # Prepare survival data
    time = combined[time_col].values
    event = combined[event_col].values

    # Ensure event is binary
    if event.dtype == "object":
        mapping = {"alive": 0, "dead": 1, "censored": 0, "event": 1}
        event = pd.Series(event).str.lower().map(mapping).values
    event = event.astype(bool)

    y_surv = Surv.from_arrays(event=event, time=time)

    # Remove invalid entries
    valid_mask = (time > 0) & (~np.isnan(time)) & (~pd.isna(event))
    X = X[valid_mask]
    y_surv = y_surv[valid_mask]
    combined_valid = combined[valid_mask].reset_index(drop=True)

    print(f"Valid samples for survival analysis: {len(X)}", file=sys.stderr, flush=True)

    # Downsample large datasets for XGBoost performance
    if len(X) > 50000:
        from sklearn.utils import resample

        indices = resample(
            range(len(X)), n_samples=50000, random_state=42, replace=False
        )
        X = X.iloc[indices]
        y_surv = y_surv[indices]
        combined_valid = combined_valid.iloc[indices].reset_index(drop=True)
        print(
            f"⚠️ Downsampled to 50,000 rows for XGBoost performance",
            file=sys.stderr,
            flush=True,
        )

    # Determine grouping column based on --group-by parameter
    group_col = None
    group_labels = {}

    if args.group_by == "race":
        if (
            "race_group" in combined_valid.columns
            and combined_valid["race_group"].nunique() >= 2
        ):
            group_col = "race_group"
            group_labels = {
                1: "Caucasian",
                2: "African-American",
                3: "Asian/Pacific Islander",
                4: "American Indian/Alaska Native",
                5: "Unknown",
            }

    elif args.group_by == "meno":
        if "meno" in combined_valid.columns and combined_valid["meno"].nunique() >= 2:
            group_col = "meno"
            group_labels = {0: "Pre-menopausal", 1: "Post-menopausal"}

    elif args.group_by == "grade":
        if "grade" in combined_valid.columns and combined_valid["grade"].nunique() >= 2:
            group_col = "grade"
            # Group 1-2 vs 3
            combined_valid["grade_binary"] = (combined_valid["grade"] >= 3).astype(int)
            group_col = "grade_binary"
            group_labels = {0: "Low-Moderate Grade (1-2)", 1: "High Grade (3)"}

    elif args.group_by == "er":
        er_col = (
            "ER_Status_BC_Group"
            if "ER_Status_BC_Group" in combined_valid.columns
            else "er" if "er" in combined_valid.columns else None
        )
        if er_col and combined_valid[er_col].nunique() >= 2:
            unique_vals = combined_valid[er_col].unique()
            if set(unique_vals).issubset({1, 2}):
                # SEER uses 1=negative, 2=positive
                group_col = er_col
                group_labels = {1: "ER-negative", 2: "ER-positive"}
            else:
                # German/Pakistani use 0/1
                combined_valid["er_binary"] = (combined_valid[er_col] > 0).astype(int)
                group_col = "er_binary"
                group_labels = {0: "ER-negative", 1: "ER-positive"}

    elif args.group_by == "pgr":
        pgr_col = None
        if "pgr" in combined_valid.columns and combined_valid["pgr"].nunique() >= 2:
            pgr_col = "pgr"
        elif (
            "PR_Status_BC_Group" in combined_valid.columns
            and combined_valid["PR_Status_BC_Group"].nunique() >= 2
        ):
            pgr_col = "PR_Status_BC_Group"

        if pgr_col:
            unique_vals = combined_valid[pgr_col].unique()
            if set(unique_vals).issubset({1, 2}):
                group_col = pgr_col
                group_labels = {1: "PR-negative", 2: "PR-positive"}
            else:
                combined_valid["pgr_binary"] = (combined_valid[pgr_col] > 0).astype(int)
                group_col = "pgr_binary"
                group_labels = {0: "PR-negative", 1: "PR-positive"}

    elif args.group_by == "age":
        # Check for age column (handle different naming conventions)
        age_col = None
        if "age" in combined_valid.columns:
            age_col = "age"
        elif "age_at_diagnosis" in combined_valid.columns:
            age_col = "age_at_diagnosis"

        if age_col and combined_valid[age_col].nunique() >= 2:
            group_col = "age_group"
            combined_valid["age_group"] = (combined_valid[age_col] >= 50).astype(int)
            group_labels = {0: "Age <50", 1: "Age ≥50"}
            print(
                f"✅ Created age groups from {age_col} column",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                f"⚠️ Age column not found or insufficient variation",
                file=sys.stderr,
                flush=True,
            )

    elif args.group_by == "nodes":
        if "nodes" in combined_valid.columns:
            unique_node_values = combined_valid["nodes"].unique()

            # Check if we have both 0 and >0 values
            if 0 in unique_node_values:
                # Standard binary: 0 vs >0
                combined_valid["nodes_group"] = (combined_valid["nodes"] > 0).astype(
                    int
                )
                group_col = "nodes_group"
                group_labels = {0: "No nodes", 1: "Nodes involved"}
            else:
                # No zeros - split at median instead
                median_nodes = combined_valid["nodes"].median()
                combined_valid["nodes_group"] = (
                    combined_valid["nodes"] > median_nodes
                ).astype(int)
                group_col = "nodes_group"
                group_labels = {
                    0: f"≤{int(median_nodes)} nodes",
                    1: f">{int(median_nodes)} nodes",
                }
                print(
                    f"ℹ️ No patients with 0 nodes, splitting at median ({median_nodes})",
                    file=sys.stderr,
                    flush=True,
                )

    image_path = None

    if group_col and group_col in combined_valid.columns:
        print(
            f"🔍 Using --group-by {args.group_by} - performing group comparison",
            file=sys.stderr,
            flush=True,
        )

        groups = sorted(combined_valid[group_col].dropna().unique())

        group_results = []
        groups_for_plotting = []  # Store data for plotting

        # Reset indices to align X and combined_valid
        X_aligned = X.reset_index(drop=True)
        y_surv_aligned = y_surv  # Already aligned
        combined_valid_aligned = combined_valid.reset_index(drop=True)

        for group_val in groups:
            mask = combined_valid_aligned[group_col] == group_val
            if mask.sum() < 20:
                print(
                    f"⚠️ Skipping {group_labels.get(group_val, f'Group_{group_val}')}: only {mask.sum()} samples",
                    file=sys.stderr,
                    flush=True,
                )
                continue

            X_group = X_aligned[mask]
            y_group = y_surv_aligned[mask]

            # Train GradientBoosting Survival

            group_start = timer.time()
            print(
                f"⏱️ [{timer.time() - start_time:.1f}s] Training {group_labels.get(group_val, f'Group_{group_val}')} with {mask.sum()} samples...",
                file=sys.stderr,
                flush=True,
            )

            model = GradientBoostingSurvivalAnalysis(
                n_estimators=5,
                learning_rate=0.1,
                max_depth=3,
                random_state=42,
            )

            try:
                model.fit(X_group, y_group)
                c_index = model.score(X_group, y_group)

                group_elapsed = timer.time() - group_start
                print(
                    f"⏱️ [{timer.time() - start_time:.1f}s] ✅ {group_labels.get(group_val, f'Group_{group_val}')} complete in {group_elapsed:.1f}s - C-index: {c_index:.4f}",
                    file=sys.stderr,
                    flush=True,
                )

                print(
                    f"✅ {group_labels.get(group_val, f'Group_{group_val}')}: C-index = {c_index:.4f}",
                    file=sys.stderr,
                    flush=True,
                )

                group_results.append(
                    {
                        "group": group_labels.get(group_val, f"Group_{group_val}"),
                        "n_samples": int(mask.sum()),
                        "n_events": int(y_group["event"].sum()),
                        "c_index": float(c_index),
                    }
                )

                # Store for plotting
                groups_for_plotting.append(
                    (
                        X_group,
                        y_group,
                        model,
                        group_labels.get(group_val, f"Group_{group_val}"),
                    )
                )

            except Exception as e:
                print(
                    f"⚠️ Error training {group_labels.get(group_val, f'Group_{group_val}')}: {e}",
                    file=sys.stderr,
                )
                continue

        # Generate survival curve plot if we have groups
        if len(groups_for_plotting) >= 1 and args.output_image:
            image_path = args.output_image
            plot_survival_curves(
                groups_for_plotting, group_labels, args.filters, image_path
            )

        output = {
            "model": "XGBoost Survival (Group Comparison)",
            "n_features": X.shape[1],
            "group_by": args.group_by,
            "groups_compared": [group_labels.get(g, f"Group_{g}") for g in groups],
            "group_results": group_results,
            "filters_applied": args.filters if args.filters else "None",
        }

        if image_path:
            output["image_path"] = image_path

    else:
        # Single group survival analysis
        print(
            f"📊 No valid grouping column found for --group-by={args.group_by} - performing single survival analysis",
            file=sys.stderr,
            flush=True,
        )

        training_start = timer.time()
        print(
            f"⏱️ [{timer.time() - start_time:.1f}s] Training single model with {len(X)} samples...",
            file=sys.stderr,
            flush=True,
        )

        model = GradientBoostingSurvivalAnalysis(
            n_estimators=5, learning_rate=0.1, max_depth=3, random_state=42
        )

        model.fit(X, y_surv)
        c_index = model.score(X, y_surv)

        training_elapsed = timer.time() - training_start
        print(
            f"⏱️ [{timer.time() - start_time:.1f}s] ✅ Training complete in {training_elapsed:.1f}s - C-index: {c_index:.4f}",
            file=sys.stderr,
            flush=True,
        )

        output = {
            "model": "XGBoost Survival",
            "n_samples": len(X),
            "n_features": X.shape[1],
            "n_events": int(y_surv["event"].sum()),
            "c_index": float(c_index),
            "filters_applied": args.filters if args.filters else "None",
        }

    total_elapsed = timer.time() - start_time
    print(
        f"⏱️ Total execution time: {total_elapsed:.1f}s ({total_elapsed/60:.1f} minutes)",
        file=sys.stderr,
        flush=True,
    )

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
