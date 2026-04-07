"""
MLP Cancer Classifier
Version: 1.0
Description: Multi-Layer Perceptron neural network for binary cancer classification on tabular healthcare data
"""

import argparse
import json
import sys
import time as timer
import warnings

import matplotlib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

matplotlib.use("Agg")  # Use non-interactive backend
import matplotlib.pyplot as plt
from lifelines import KaplanMeierFitter

warnings.filterwarnings("ignore")

# Try TensorFlow/Keras
try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras.callbacks import EarlyStopping
    from tensorflow.keras.layers import Dense, Dropout
    from tensorflow.keras.models import Sequential

    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False

# Column name aliases
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
            # Convert from days to months
            df["survival_months"] = df["survival_months"] / 30.44
            print(
                f"⚠️ Converted survival_months from days to months (÷30.44)",
                file=sys.stderr,
            )

    return df


def apply_filters(df, filter_string):
    """Apply filters from filter string"""
    if not filter_string or filter_string.strip() == "":
        return df

    filters = filter_string.split(",")
    for filt in filters:
        filt = filt.strip()
        if not filt or "=" not in filt:
            continue

        key, value = filt.split("=", 1)
        key = key.strip()
        key_lower = key.lower()
        value = value.strip()

        # MAP ALIASES FIRST
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
                    )
            except Exception as e:
                print(f"Warning: Failed to apply age filter: {e}", file=sys.stderr)

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
                        )
                    except Exception as e:
                        print(
                            f"Warning: Failed to apply grade range filter: {e}",
                            file=sys.stderr,
                        )
                else:
                    try:
                        df = df[df[grade_col] == int(value)]
                        print(
                            f"Applied grade={value} filter: {len(df)} rows remain",
                            file=sys.stderr,
                        )
                    except Exception as e:
                        print(
                            f"Warning: Failed to apply grade filter: {e}",
                            file=sys.stderr,
                        )

        # Handle generic column filters
        else:
            matching_col = next((c for c in df.columns if c.lower() == key_lower), None)

            if matching_col:
                try:
                    numeric_value = float(value)
                    df = df[df[matching_col] == numeric_value]
                    print(
                        f"Applied {matching_col}={value} filter: {len(df)} rows remain",
                        file=sys.stderr,
                    )
                except ValueError:
                    df = df[df[matching_col].astype(str) == value]
                    print(
                        f"Applied {matching_col}={value} filter: {len(df)} rows remain",
                        file=sys.stderr,
                    )
            else:
                print(
                    f"Warning: Column '{key}' not found in dataset. Available columns: {list(df.columns)}",
                    file=sys.stderr,
                )

    print(f"Final dataset after all filters: {len(df)} rows", file=sys.stderr)
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
    """Prepare features for MLP training"""
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    # Identify target column
    TARGET_CANDIDATES = [
        "status",
        "death_status",
        "death_status_mod",
        "event",
        "diagnosis",
        "outcome",
    ]

    if target_col.lower() not in df.columns:
        for alt in TARGET_CANDIDATES:
            if alt in df.columns:
                target_col = alt
                print(f"Using target column: {target_col}", file=sys.stderr)
                break

    if target_col not in df.columns:
        print(
            f"Error: Target column '{target_col}' not found in dataset", file=sys.stderr
        )
        print(f"Available columns: {list(df.columns)}", file=sys.stderr)
        sys.exit(1)

    # Separate features and target
    y = df[target_col].copy()

    # Convert target to binary
    if y.dtype == "object":
        mapping = {
            "M": 1,
            "B": 0,
            "malignant": 1,
            "benign": 0,
            "yes": 1,
            "no": 0,
            "true": 1,
            "false": 0,
        }
        y = y.str.lower().map(mapping)
        if y.isna().any():
            y = pd.to_numeric(y, errors="coerce")

    # Remove non-feature columns
    exclude_cols = [target_col, "pid", "patient_id", "id", "unnamed:_0"]
    X = df.drop(columns=[c for c in exclude_cols if c in df.columns])

    # Handle categorical columns
    for col in X.columns:
        if X[col].dtype == "object":
            X[col] = pd.Categorical(X[col]).codes

    # Convert all to numeric
    X = X.apply(pd.to_numeric, errors="coerce")

    # Handle missing values
    X = X.fillna(X.mean().fillna(0))

    # Drop zero variance columns
    X = X.loc[:, X.std() > 1e-6]

    return X, y


def build_mlp_model(input_dim, hidden_layers=[64, 32, 16]):
    """Build MLP neural network model"""
    model = Sequential()

    # Input layer + first hidden layer
    model.add(Dense(hidden_layers[0], input_dim=input_dim, activation="relu"))
    model.add(Dropout(0.3))

    # Additional hidden layers
    for units in hidden_layers[1:]:
        model.add(Dense(units, activation="relu"))
        model.add(Dropout(0.3))

    # Output layer
    model.add(Dense(1, activation="sigmoid"))

    # Compile model
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])

    return model


def plot_mlp_survival_curves(groups_data, group_labels, filters_str, output_path):
    """
    Plot predicted MLP survival curves overlaid with actual Kaplan-Meier curves.

    For each group:
    1. Use trained MLP to predict risk scores
    2. Bin patients by risk score (high/medium/low)
    3. Plot actual KM curves for predicted risk bins
    4. Compare with overall group KM curve

    Args:
        groups_data: List of (X_group, time_group, event_group, model, scaler, group_label)
        group_labels: Dict mapping group values to readable labels
        filters_str: Filter string to display in legend
        output_path: Path to save the PNG image
    """
    plt.figure(figsize=(12, 8))

    colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"]

    for idx, (
        X_group,
        time_group,
        event_group,
        model,
        scaler,
        group_label,
    ) in enumerate(groups_data):
        color = colors[idx % len(colors)]

        # Plot actual Kaplan-Meier curve for the group
        kmf = KaplanMeierFitter()
        kmf.fit(time_group, event_group, label=f"{group_label} (Actual)")
        kmf.plot_survival_function(
            ax=plt.gca(), ci_show=False, color=color, linestyle="-", linewidth=2.5
        )

        # Generate predicted curve based on risk scores
        try:
            # Scale features and predict risk scores
            X_scaled = scaler.transform(X_group)
            risk_scores = model.predict(X_scaled, verbose=0).flatten()

            # Create predicted survival curve by stratifying by risk
            # High risk patients should have worse survival
            median_risk = np.median(risk_scores)
            high_risk_mask = risk_scores > median_risk

            # Get time points for interpolation
            time_points = np.linspace(time_group.min(), time_group.max(), 100)

            # Fit KM on high risk group
            if high_risk_mask.sum() > 10:
                kmf_high = KaplanMeierFitter()
                kmf_high.fit(time_group[high_risk_mask], event_group[high_risk_mask])
                high_risk_surv = kmf_high.survival_function_at_times(time_points).values
            else:
                high_risk_surv = np.ones(len(time_points))

            # Fit KM on low risk group
            low_risk_mask = ~high_risk_mask
            if low_risk_mask.sum() > 10:
                kmf_low = KaplanMeierFitter()
                kmf_low.fit(time_group[low_risk_mask], event_group[low_risk_mask])
                low_risk_surv = kmf_low.survival_function_at_times(time_points).values
            else:
                low_risk_surv = np.ones(len(time_points))

            # Predicted curve is weighted average based on risk distribution
            # Weight by proportion of patients in each risk group
            predicted_surv = (
                high_risk_surv * high_risk_mask.sum()
                + low_risk_surv * low_risk_mask.sum()
            ) / len(risk_scores)

            # Plot predicted curve
            plt.plot(
                time_points,
                predicted_surv,
                label=f"{group_label} (Predicted)",
                color=color,
                linestyle="--",
                linewidth=2.5,
                alpha=0.8,
            )

        except Exception as e:
            print(
                f"⚠️ Could not plot predicted curve for {group_label}: {e}",
                file=sys.stderr,
                flush=True,
            )

    plt.title("MLP Predicted vs Actual Survival Curves", fontsize=14, fontweight="bold")
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


# ===========================================================================
# DIABETES CLASSIFICATION MODE (3-class readmission prediction)
# ===========================================================================


def preprocess_diabetic_flat(df):
    """
    Preprocess diabetic_data.csv into flat tabular format (one row per patient).
    Uses last encounter per patient, same features as LSTM model.
    """
    print(" Preprocessing diabetic data (flat mode)...", file=sys.stderr, flush=True)

    readmit_map = {"NO": 0, ">30": 1, "<30": 2}
    df["readmitted_class"] = df["readmitted"].map(readmit_map)
    df = df.dropna(subset=["readmitted_class"])
    df["readmitted_class"] = df["readmitted_class"].astype(int)

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

    if "A1Cresult" in df.columns:
        a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
        df["a1c_numeric"] = df["A1Cresult"].map(a1c_map).fillna(0)
        feature_cols.append("a1c_numeric")

    df[feature_cols] = df[feature_cols].fillna(0)

    df_flat = df.sort_values("encounter_id").groupby("patient_nbr").last().reset_index()
    print(
        f"✅ Flattened to {len(df_flat)} patients (last encounter per patient)",
        file=sys.stderr,
        flush=True,
    )

    scaler = StandardScaler()
    df_flat[feature_cols] = scaler.fit_transform(df_flat[feature_cols].astype(float))

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


def build_classification_mlp(input_dim, num_classes=3):
    """Build MLP for 3-class readmission classification"""
    if not TF_AVAILABLE:
        print("Error: TensorFlow not installed", file=sys.stderr)
        sys.exit(1)

    model = Sequential(
        [
            Dense(128, activation="relu", input_dim=input_dim),
            Dropout(0.5),
            Dense(64, activation="relu"),
            Dropout(0.3),
            Dense(32, activation="relu"),
            Dropout(0.3),
            Dense(num_classes, activation="softmax"),
        ]
    )

    model.compile(
        optimizer="adam", loss="categorical_crossentropy", metrics=["accuracy"]
    )

    return model


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
        "readmit_time": "MLP Readmission Classification Accuracy by Outcome Class",
        "a1c_control": "MLP Readmission Classification Accuracy by A1C Control Level",
        "age_diabetes": "MLP Readmission Classification Accuracy by Age Group",
        "race_diabetes": "MLP Readmission Classification Accuracy by Race",
    }
    ax1.set_title(
        title_map.get(group_by, "MLP Readmission Classification Accuracy"),
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
        f"MLP Hospital Readmission Prediction — Diabetes Dataset\n{filter_text}",
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
    ax.set_title(f"Readmission Probability by {subgroup_key} Across Races (MLP)", fontsize=14, fontweight="bold")
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
    """
    from scipy import stats

    results = {}
    if subgroup_col not in df_flat.columns:
        return results

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
    """
    from sklearn.preprocessing import StandardScaler

    print("🇧🇩 Preprocessing Sylhet Bangladesh dataset...", file=sys.stderr, flush=True)

    df.columns = [c.strip() for c in df.columns]

    target_map = {"Positive": 1, "Negative": 0}
    df["label"] = df["class"].map(target_map)
    df = df.dropna(subset=["label"])
    df["label"] = df["label"].astype(int)

    df["Gender"] = df["Gender"].map({"Male": 1, "Female": 0})

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
    feature_cols = [c for c in feature_cols if c in df.columns]

    df[feature_cols] = df[feature_cols].fillna(0)

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


def build_sylhet_mlp(input_dim):
    """Build MLP for binary diabetes classification (Sylhet)"""
    if not TF_AVAILABLE:
        print("Error: TensorFlow not installed", file=sys.stderr)
        sys.exit(1)

    model = Sequential(
        [
            Dense(64, activation="relu", input_dim=input_dim),
            Dropout(0.4),
            Dense(32, activation="relu"),
            Dropout(0.3),
            Dense(16, activation="relu"),
            Dense(1, activation="sigmoid"),
        ]
    )

    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])

    return model


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
        "gender_sylhet": "MLP Diabetes Prediction Accuracy by Gender",
        "age_sylhet": "MLP Diabetes Prediction Accuracy by Age Group",
        "obesity_sylhet": "MLP Diabetes Prediction Accuracy by Obesity Status",
        "age_cross": "MLP Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "MLP Diabetes Prediction Accuracy"),
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
        f"MLP Diabetes Diagnosis — Sylhet Hospital (Bangladesh)\n{filter_text}",
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
    """Run binary diabetes classification using MLP on Sylhet Bangladesh data"""
    import time as timer

    from tensorflow.keras.callbacks import EarlyStopping

    start_time = timer.time()

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
            json.dumps({"error": "No Sylhet datasets found", "model": "MLP Diabetes"})
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f"🇧🇩 Sylhet dataset: {len(combined)} patients", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_sylhet(combined)
    print(f"📐 Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)

    group_col = None
    group_labels_dict = {}

    if args.group_by == "gender_sylhet":
        if "Gender" in df_flat.columns:
            group_col = "Gender"
            group_labels_dict = {1: "Male", 0: "Female"}

    elif args.group_by == "age_sylhet":
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
                    f"🔬 Training MLP for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = build_sylhet_mlp(X_train.shape[1])

                step_start = timer.time()
                model.fit(
                    X_train,
                    y_train,
                    epochs=100,
                    batch_size=16,
                    validation_split=0.15,
                    callbacks=[EarlyStopping(patience=10, restore_best_weights=True)],
                    verbose=0,
                )
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred_proba = model.predict(X_test, verbose=0).flatten()
                y_pred_classes = (y_pred_proba >= 0.5).astype(int)

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
                "model": "MLP Diabetes Prediction (Group Comparison)",
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

    model = build_sylhet_mlp(X_train.shape[1])

    step_start = timer.time()
    model.fit(
        X_train,
        y_train,
        epochs=100,
        batch_size=16,
        validation_split=0.15,
        callbacks=[EarlyStopping(patience=10, restore_best_weights=True)],
        verbose=0,
    )
    print(
        f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True
    )

    y_pred_proba = model.predict(X_test, verbose=0).flatten()
    y_pred_classes = (y_pred_proba >= 0.5).astype(int)

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
        "model": "MLP Diabetes Prediction",
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
        "age_pima": "MLP Diabetes Prediction Accuracy by Age Group",
        "bmi_pima": "MLP Diabetes Prediction Accuracy by BMI Category",
        "glucose_pima": "MLP Diabetes Prediction Accuracy by Glucose Level",
        "age_cross": "MLP Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "MLP Diabetes Prediction Accuracy"),
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
        f"MLP Diabetes Diagnosis — Pima Indians (USA)\n{filter_text}",
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
    """Run binary diabetes classification using MLP on Pima Indians USA data"""
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
        print(json.dumps({"error": "No Pima datasets found", "model": "MLP Diabetes"}))
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
                    f"🔬 Training MLP for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = build_sylhet_mlp(X_train.shape[1])

                step_start = timer.time()
                model.fit(
                    X_train,
                    y_train,
                    epochs=100,
                    batch_size=16,
                    validation_split=0.15,
                    callbacks=[EarlyStopping(patience=10, restore_best_weights=True)],
                    verbose=0,
                )
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred_proba = model.predict(X_test, verbose=0).flatten()
                y_pred_classes = (y_pred_proba >= 0.5).astype(int)

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
                "model": "MLP Diabetes Prediction (Group Comparison)",
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

    model = build_sylhet_mlp(X_train.shape[1])

    step_start = timer.time()
    model.fit(
        X_train,
        y_train,
        epochs=100,
        batch_size=16,
        validation_split=0.15,
        callbacks=[EarlyStopping(patience=10, restore_best_weights=True)],
        verbose=0,
    )
    print(
        f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True
    )

    y_pred_proba = model.predict(X_test, verbose=0).flatten()
    y_pred_classes = (y_pred_proba >= 0.5).astype(int)

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
        "model": "MLP Diabetes Prediction",
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
    """Run 3-class readmission classification using MLP on diabetic data"""
    import time as timer

    from sklearn.utils.class_weight import compute_class_weight
    from tensorflow.keras.utils import to_categorical

    start_time = timer.time()

    frames = []
    for dataset_path in args.datasets:
        if (
            "diabetic" not in dataset_path.lower()
            and "readmission" not in dataset_path.lower()
        ):
            print(f"⚠️ Skipping non-diabetic dataset: {dataset_path}", file=sys.stderr)
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
                {"error": "No diabetic datasets found", "model": "MLP Readmission"}
            )
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f" Combined dataset: {len(combined)} encounters", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_diabetic_flat(combined)

    print(f" Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)

    group_col = None
    group_labels_dict = {}
    
    # ===== CROSS-RACE PROBABILITY MODE =====
    race_datasets = [(d, extract_race_from_filename(d)) for d in args.datasets
                     if extract_race_from_filename(d) is not None]

    if len(race_datasets) >= 2:
        print(f"🏥 Cross-race probability mode: {len(race_datasets)} race datasets detected",
              file=sys.stderr, flush=True)

        all_race_probs = {}
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

            from tensorflow.keras.utils import to_categorical
            y_train_cat = to_categorical(y_train, num_classes=3)
            y_test_cat = to_categorical(y_test, num_classes=3)

            # Compute class weights
            from sklearn.utils.class_weight import compute_class_weight
            class_weights = compute_class_weight("balanced", classes=np.array([0, 1, 2]), y=y_train)
            class_weight_dict = {i: class_weights[i] for i in range(3)}

            model = build_classification_mlp(input_dim=X_train.shape[1], num_classes=3)

            step_start = timer.time()
            model.fit(X_train, y_train_cat, epochs=50, batch_size=32, verbose=0,
                      validation_split=0.2, class_weight=class_weight_dict,
                      callbacks=[tf.keras.callbacks.EarlyStopping(
                          monitor="val_loss", patience=5, restore_best_weights=True)])
            print(f"⏱️ Training took {timer.time() - step_start:.1f}s", file=sys.stderr, flush=True)

            y_pred_proba = model.predict(X_test, verbose=0)
            y_pred_classes = np.argmax(y_pred_proba, axis=1)
            accuracy = float(np.mean(y_pred_classes == y_test))

            try:
                auc_scores = [roc_auc_score(y_test_cat[:, i], y_pred_proba[:, i]) for i in range(3)]
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
            "model": "MLP Cross-Race Readmission Probability",
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

    if args.group_by == "readmit_time":
        print(
            f" Readmission timing mode: training single model, reporting per-class metrics",
            file=sys.stderr,
            flush=True,
        )

        y_cat = to_categorical(labels, num_classes=3)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_cat, test_size=0.2, random_state=42, stratify=labels
        )

        y_train_classes = np.argmax(y_train, axis=1)
        class_weights = compute_class_weight(
            "balanced", classes=np.array([0, 1, 2]), y=y_train_classes
        )
        class_weight_dict = {
            0: class_weights[0],
            1: class_weights[1],
            2: class_weights[2],
        }

        print(
            f"🔬 Training MLP: {len(X_train)} train, {len(X_test)} test",
            file=sys.stderr,
            flush=True,
        )

        model = build_classification_mlp(input_dim=X_train.shape[1], num_classes=3)

        step_start = timer.time()
        model.fit(
            X_train,
            y_train,
            validation_split=0.2,
            epochs=30,
            batch_size=32,
            verbose=0,
            class_weight=class_weight_dict,
            callbacks=[
                EarlyStopping(
                    monitor="val_accuracy",
                    patience=5,
                    restore_best_weights=True,
                )
            ],
        )
        print(
            f"⏱️ Training took {timer.time() - step_start:.1f}s",
            file=sys.stderr,
            flush=True,
        )

        y_pred = model.predict(X_test, verbose=0)
        y_pred_classes = np.argmax(y_pred, axis=1)
        y_test_classes = np.argmax(y_test, axis=1)

        overall_accuracy = np.mean(y_pred_classes == y_test_classes)

        class_names = {0: "NO readmission", 1: ">30 days", 2: "<30 days"}
        group_results = []

        for class_id, class_name in class_names.items():
            class_mask = y_test_classes == class_id
            if class_mask.sum() == 0:
                continue
            class_acc = np.mean(y_pred_classes[class_mask] == class_id)
            try:
                class_auc = roc_auc_score(y_test[:, class_id], y_pred[:, class_id])
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
                class_mask = y_test_classes == class_id
                if class_mask.sum() > 0:
                    groups_for_plotting.append(
                        (y_pred[class_mask], y_test_classes[class_mask], class_name)
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
            "model": "MLP Readmission Prediction (Group Comparison)",
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

                y_group_cat = to_categorical(y_group, num_classes=3)
                X_train, X_test, y_train, y_test = train_test_split(
                    X_group,
                    y_group_cat,
                    test_size=0.2,
                    random_state=42,
                    stratify=y_group,
                )

                print(
                    f"🔬 Training MLP for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = build_classification_mlp(
                    input_dim=X_train.shape[1], num_classes=3
                )

                step_start = timer.time()
                model.fit(
                    X_train,
                    y_train,
                    validation_split=0.2,
                    epochs=30,
                    batch_size=32,
                    verbose=0,
                    callbacks=[
                        EarlyStopping(
                            monitor="val_accuracy",
                            patience=5,
                            restore_best_weights=True,
                        )
                    ],
                )
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                y_pred = model.predict(X_test, verbose=0)
                y_pred_classes = np.argmax(y_pred, axis=1)
                y_test_classes = np.argmax(y_test, axis=1)

                accuracy = np.mean(y_pred_classes == y_test_classes)

                try:
                    auc_scores = []
                    for i in range(3):
                        auc = roc_auc_score(y_test[:, i], y_pred[:, i])
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
                        y_pred,
                        y_test_classes,
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
                "model": "MLP Readmission Prediction (Group Comparison)",
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
    print("🚀 MLP SCRIPT STARTED", file=sys.stderr, flush=True)
    parser = argparse.ArgumentParser(description="MLP Cancer Classifier")
    parser.add_argument(
        "--vars",
        type=str,
        default="all",
        help='Comma-separated list of variables or "all"',
    )
    parser.add_argument(
        "--filters",
        type=str,
        default="",
        help="Filters in format: age_range=40-50,grade=1-2",
    )
    parser.add_argument(
        "--group-by",
        type=str,
        default="race",
        help="Column to group by: race, meno, grade, er, pgr, age, nodes (default: race)",
    )
    parser.add_argument(
        "--target",
        type=str,
        default="status",
        help="Target variable name (default: status)",
    )
    parser.add_argument(
        "--output-image",
        type=str,
        default="",
        help="Path to save survival curve image (optional)",
    )
    parser.add_argument(
        "--min_rows", type=int, default=20, help="Minimum rows required after filtering"
    )
    parser.add_argument("datasets", nargs="+", help="Dataset file paths")

    args = parser.parse_args()

    if not TF_AVAILABLE:
        print(
            "Error: TensorFlow not installed. Install with: pip install tensorflow",
            file=sys.stderr,
        )
        sys.exit(1)

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

    # Early branch: if any dataset is diabetic, run classification mode
    if any(
        "diabetic" in d.lower() or "readmission" in d.lower() for d in args.datasets
    ):
        print(
            "🔀 Diabetic dataset detected — switching to classification mode",
            file=sys.stderr,
            flush=True,
        )
        run_diabetes_classification(args)
        sys.exit(0)

    # Load and process datasets
    frames = []
    for path in args.datasets:
        try:
            if path.endswith(".csv"):
                df = pd.read_csv(path)
            elif path.endswith(".xlsx") or path.endswith(".xls"):
                df = pd.read_excel(path)
            else:
                print(f"Error: Unsupported file format for {path}", file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"Error loading {path}: {e}", file=sys.stderr)
            sys.exit(1)

        dataset_type = detect_dataset_type(path)
        df = canonicalise_columns(df, dataset_type)
        df = apply_filters(df, args.filters)
        frames.append(df)

    # Combine datasets
    combined = pd.concat(frames, ignore_index=True)
    print(f"🔍 Combined dataset: {len(combined)} rows", file=sys.stderr)

    if combined.shape[0] < args.min_rows:
        print(
            f"Error: Only {combined.shape[0]} rows after filtering (minimum {args.min_rows} required)",
            file=sys.stderr,
        )
        sys.exit(1)

    # Merge status columns if both exist (BEFORE prepare_features)
    if "status" in combined.columns and "death_status" in combined.columns:
        combined["status"] = combined["status"].fillna(combined["death_status"])
        print(f"🔧 Merged 'status' and 'death_status' columns", file=sys.stderr)

    # Prepare features
    X, y = prepare_features(combined, args.target)
    print(f"🔍 After prepare_features: X={len(X)}, y={len(y)}", file=sys.stderr)

    # Remove rows with NaN in target
    mask = ~y.isna()
    X = X[mask]
    y = y[mask]
    combined = combined[mask].reset_index(drop=True)  # Filter combined too
    print(f"🔍 After target NaN filter: {len(combined)} rows", file=sys.stderr)

    if len(y) < args.min_rows:
        print(
            f"Error: Only {len(y)} valid samples after preprocessing", file=sys.stderr
        )
        sys.exit(1)

    # Check if we have lifelines for C-index calculation
    try:
        from lifelines import KaplanMeierFitter
        from lifelines.utils import concordance_index

        LIFELINES_AVAILABLE = True
    except ImportError:
        LIFELINES_AVAILABLE = False
        print(
            "Warning: lifelines not available, C-index calculation may be limited",
            file=sys.stderr,
        )

    # Identify time and event columns
    time_col = None
    event_col = None

    time_candidates = ["survival_months", "rfstime", "time", "duration"]
    event_candidates = ["status", "event", "death_status", "censored"]

    for col in time_candidates:
        if col in combined.columns:
            time_col = col
            break

    for col in event_candidates:
        if col in combined.columns:
            event_col = col
            break

    if not time_col or not event_col:
        print(
            f"Error: Missing survival columns. Found: {list(combined.columns)}",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Using time column: {time_col}, event column: {event_col}", file=sys.stderr)

    # Prepare survival data
    time = combined[time_col].values
    event = combined[event_col].values

    # Ensure event is binary
    if event.dtype == "object":
        mapping = {"alive": 0, "dead": 1, "censored": 0, "event": 1}
        event = pd.Series(event).str.lower().map(mapping).values
    event = event.astype(int)

    # Remove invalid entries
    valid_mask = (time > 0) & (~np.isnan(time)) & (~pd.isna(event))
    X = X[valid_mask]
    time = time[valid_mask]
    event = event[valid_mask]
    combined_valid = combined[valid_mask].reset_index(drop=True)
    print(f"🔍 After valid_mask filter: {len(combined_valid)} rows", file=sys.stderr)

    # Build survival MLP model
    def build_survival_mlp(input_dim):
        model = Sequential()
        model.add(Dense(256, activation="relu", input_dim=input_dim))
        model.add(Dropout(0.4))
        model.add(Dense(128, activation="relu"))
        model.add(Dropout(0.3))
        model.add(Dense(64, activation="relu"))
        model.add(Dropout(0.3))
        model.add(Dense(32, activation="relu"))
        model.add(Dropout(0.2))
        model.add(Dense(1, activation="linear"))

        # Use lower learning rate for large datasets
        optimizer = tf.keras.optimizers.Adam(learning_rate=0.0001)
        model.compile(optimizer=optimizer, loss="mse")
        return model

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
            combined_valid["grade_binary"] = (combined_valid["grade"] >= 3).astype(int)
            group_col = "grade_binary"
            group_labels = {0: "Low-Moderate Grade (1-2)", 1: "High Grade (3)"}

    elif args.group_by == "er":
        er_col = None
        if "ER_Status_BC_Group" in combined_valid.columns:
            er_col = "ER_Status_BC_Group"
        elif "er" in combined_valid.columns:
            er_col = "er"

        if er_col:
            unique_vals = combined_valid[er_col].unique()
            if set(unique_vals).issubset({1, 2}):
                # SEER encoding: 1=negative, 2=positive
                group_col = er_col
                group_labels = {1: "ER-negative", 2: "ER-positive"}
            else:
                # German/Pakistani encoding: 0=negative, 1=positive
                combined_valid["er_binary"] = (combined_valid[er_col] > 0).astype(int)
                group_col = "er_binary"
                group_labels = {0: "ER-negative", 1: "ER-positive"}

    elif args.group_by == "pgr":
        # Check for pgr or PR_Status_BC_Group
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
                # SEER encoding: 1=negative, 2=positive
                group_col = pgr_col
                group_labels = {1: "PR-negative", 2: "PR-positive"}
            else:
                # German/Pakistani encoding: continuous values
                combined_valid["pgr_binary"] = (combined_valid[pgr_col] > 0).astype(int)
                group_col = "pgr_binary"
                group_labels = {0: "PR-negative", 1: "PR-positive"}

    elif args.group_by == "age":
        age_col = (
            "age"
            if "age" in combined_valid.columns
            else (
                "age_at_diagnosis"
                if "age_at_diagnosis" in combined_valid.columns
                else None
            )
        )
        if age_col:
            combined_valid["age_group"] = (combined_valid[age_col] >= 50).astype(int)
            group_col = "age_group"
            group_labels = {0: "Age <50", 1: "Age ≥50"}

    elif args.group_by == "nodes":
        if "nodes" in combined_valid.columns:
            unique_node_values = combined_valid["nodes"].unique()
            print(
                f"🔍 DEBUG nodes unique values: {sorted(unique_node_values)}",
                file=sys.stderr,
            )
            print(
                f"🔍 DEBUG 0 in unique_node_values: {0 in unique_node_values}",
                file=sys.stderr,
            )

            # Check if we have both 0 and >0 values
            if 0 in unique_node_values:
                # Check if binary split gives enough samples in each group
                n_zero = (combined_valid["nodes"] == 0).sum()
                n_nonzero = (combined_valid["nodes"] > 0).sum()

                if n_zero >= 20 and n_nonzero >= 20:
                    # Standard binary: 0 vs >0
                    combined_valid["nodes_group"] = (
                        combined_valid["nodes"] > 0
                    ).astype(int)
                    group_col = "nodes_group"
                    group_labels = {0: "No nodes", 1: "Nodes involved"}
                else:
                    # Too few in one group - use median split instead
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
                        f"ℹ️ Too few patients with 0 nodes ({n_zero}), splitting at median ({median_nodes})",
                        file=sys.stderr,
                    )
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
                )

    if group_col and group_col in combined_valid.columns:
        print(
            f"🔍 Using --group-by {args.group_by} - performing group comparison",
            file=sys.stderr,
        )

        groups = sorted(
            combined_valid[group_col].dropna().unique()
        )  # ALL groups, sorted

        group_results = []
        groups_for_plotting = []  # Store models and data for plotting

        # Reset indices to align X, time, event, and combined_valid
        X_aligned = X.reset_index(drop=True)
        time_aligned = pd.Series(time).reset_index(drop=True).values
        event_aligned = pd.Series(event).reset_index(drop=True).values
        combined_valid_aligned = combined_valid.reset_index(drop=True)

        for group_val in groups:
            mask = combined_valid_aligned[group_col] == group_val
            if mask.sum() < 20:  # Need more samples for neural network
                print(
                    f"⚠️ Skipping {group_labels.get(group_val, f'Group_{group_val}')}: only {mask.sum()} samples",
                    file=sys.stderr,
                )
                continue

            X_group = X_aligned[mask]
            time_group = time_aligned[mask]
            event_group = event_aligned[mask]

            # Split
            X_train, X_test, time_train, time_test, event_train, event_test = (
                train_test_split(
                    X_group, time_group, event_group, test_size=0.2, random_state=42
                )
            )

            # Scale
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)

            # Build and train
            model = build_survival_mlp(X_train_scaled.shape[1])
            # Larger batch size for big datasets
            batch_size = 512 if len(X_train_scaled) > 50000 else 32

            model.fit(
                X_train_scaled,
                time_train,
                epochs=100,  # More epochs
                batch_size=batch_size,
                verbose=0,
                validation_split=0.2,
            )

            # Calculate C-index
            risk_scores = model.predict(X_test_scaled, verbose=0).flatten()
            if LIFELINES_AVAILABLE:
                c_index = concordance_index(time_test, -risk_scores, event_test)
            else:
                c_index = 0.5  # Placeholder

            print(
                f"✅ {group_labels.get(group_val, f'Group_{group_val}')}: C-index = {c_index:.4f}",
                file=sys.stderr,
            )

            group_results.append(
                {
                    "group": group_labels.get(group_val, f"Group_{group_val}"),
                    "n_samples": int(mask.sum()),
                    "n_events": int(event_group.sum()),
                    "c_index": float(c_index),
                }
            )

            # Store model and data for plotting
            groups_for_plotting.append(
                (
                    X_group,
                    time_group,
                    event_group,
                    model,
                    scaler,
                    group_labels.get(group_val, f"Group_{group_val}"),
                )
            )

        # Generate survival curves if requested
        image_path = None
        if args.output_image and LIFELINES_AVAILABLE and len(groups_for_plotting) >= 1:
            # Generate plot
            image_path = args.output_image
            plot_mlp_survival_curves(
                groups_for_plotting, group_labels, args.filters, image_path
            )

        output = {
            "model": "MLP Survival (Group Comparison)",
            "architecture": "Multi-Layer Perceptron (256-128-64-32 neurons)",
            "n_features": X.shape[1],
            "groups_compared": [group_labels.get(g, f"Group_{g}") for g in groups],
            "group_results": group_results,
            "filters_applied": args.filters if args.filters else "None",
        }

        if image_path:
            output["image_path"] = image_path
    else:
        # Single group survival
        print(
            f"📊 No race_group column - performing single survival analysis",
            file=sys.stderr,
        )

        X_train, X_test, time_train, time_test, event_train, event_test = (
            train_test_split(X, time, event, test_size=0.2, random_state=42)
        )

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        model = build_survival_mlp(X_train_scaled.shape[1])
        # Larger batch size for big datasets
        batch_size = 512 if len(X_train_scaled) > 50000 else 32

        model.fit(
            X_train_scaled,
            time_train,
            epochs=100,  # More epochs
            batch_size=batch_size,
            verbose=0,
            validation_split=0.2,
        )

        risk_scores = model.predict(X_test_scaled, verbose=0).flatten()
        if LIFELINES_AVAILABLE:
            c_index = concordance_index(time_test, -risk_scores, event_test)
        else:
            c_index = 0.5

        output = {
            "model": "MLP Survival (Group Comparison)",
            "architecture": "Multi-Layer Perceptron (256-128-64-32 neurons)",
            "n_features": X.shape[1],
            "group_by": args.group_by,
            "groups_compared": [group_labels.get(g, f"Group_{g}") for g in groups],
            "group_results": group_results,
            "filters_applied": args.filters if args.filters else "None",
        }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
