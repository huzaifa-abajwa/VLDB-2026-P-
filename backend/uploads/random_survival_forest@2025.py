"""
Random Survival Forest Model
Version: 1.0
Description: Random Survival Forest for ensemble survival analysis (extends Cox/DeepSurv capabilities)
"""

import argparse
import json
import sys
import time as timer
import warnings

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore")

# Try lifelines for Kaplan-Meier plotting
try:
    from lifelines import KaplanMeierFitter

    LIFELINES_AVAILABLE = True
except ImportError:
    LIFELINES_AVAILABLE = False

# Try scikit-survival, fall back to basic implementation if unavailable
try:
    from sksurv.ensemble import RandomSurvivalForest
    from sksurv.metrics import concordance_index_censored
    from sksurv.util import Surv

    SKSURV_AVAILABLE = True
except ImportError:
    SKSURV_AVAILABLE = False

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

    for alias, canonical in COLUMN_ALIASES.items():
        if alias in df.columns and canonical.lower() not in df.columns:
            df.rename(columns={alias: canonical.lower()}, inplace=True)

    # Dataset-specific mappings
    if dataset_type == "seer":
        if "survival months" in df.columns:
            df.rename(columns={"survival months": "survival_months"}, inplace=True)
    elif dataset_type == "german":
        if "rfstime" in df.columns:
            df.rename(columns={"rfstime": "survival_months"}, inplace=True)
    elif dataset_type == "registry":  # Pakistani/Canadian datasets
        # Column already renamed by COLUMN_ALIASES dict (line 42-44)
        # Just convert units from days to months
        if "survival_months" in df.columns:
            df["survival_months"] = df["survival_months"] / 30.44
            print(
                f"⚠️ Converted survival_months from days to months (÷30.44)",
                file=sys.stderr,
            )

    return df


def apply_filters(df, filter_string):
    """Apply filters from filter string (e.g., 'age_range=40-50,grade=1-2')"""
    if not filter_string or filter_string.strip() == "":
        return df

    filters = filter_string.split(",")
    for filt in filters:
        filt = filt.strip()
        if not filt or "=" not in filt:
            continue

        key, value = filt.split("=", 1)
        key = key.strip().lower()
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
        elif "grade" in key:
            grade_col = next((c for c in df.columns if "grade" in c.lower()), None)
            if grade_col:
                if "-" in value:
                    try:
                        low, high = map(int, value.split("-"))
                        df = df[(df[grade_col] >= low) & (df[grade_col] <= high)]
                    except:
                        pass
                else:
                    try:
                        df = df[df[grade_col] == int(value)]
                    except:
                        pass

    return df


def detect_dataset_type(filename):
    """Detect dataset type from filename"""
    filename_lower = filename.lower()
    if "sylhet" in filename_lower or "bangladesh" in filename_lower:
        return "sylhet"
    elif "pima" in filename_lower:
        return "pima"
    elif "diabetic" in filename_lower:
        return "diabetic"
    elif "seer" in filename_lower or "usa" in filename_lower:
        return "seer"
    elif "german" in filename_lower:
        return "german"
    elif "pakistan" in filename_lower or "canadian" in filename_lower:
        return "registry"
    else:
        return "generic"


def identify_time_event_columns(df):
    """Identify time and event columns in the dataset"""
    time_col = None
    event_col = None

    # Search for time column
    time_candidates = [
        "survival_months",
        "rfstime",
        "time",
        "duration",
        "survival_time",
    ]
    for col in time_candidates:
        if col in df.columns:
            time_col = col
            break

    # Search for event column
    event_candidates = ["status", "event", "death_status", "censored"]
    for col in event_candidates:
        if col in df.columns:
            event_col = col
            break

    return time_col, event_col


def prepare_survival_features(df, time_col, event_col):
    """Prepare features for Random Survival Forest"""
    # Remove non-feature columns
    exclude_cols = [time_col, event_col, "pid", "patient_id", "id", "unnamed:_0"]
    X = df.drop(columns=[c for c in exclude_cols if c in df.columns])

    # Handle categorical columns
    for col in X.columns:
        if X[col].dtype == "object":
            X[col] = pd.Categorical(X[col]).codes

    # Convert all to numeric
    X = X.apply(pd.to_numeric, errors="coerce")
    X = X.fillna(X.mean())

    # Drop zero variance columns
    X = X.loc[:, X.std() > 1e-6]

    # Prepare survival data
    time = df[time_col].values
    event = df[event_col].values

    # Ensure event is binary
    if event.dtype == "object":
        mapping = {"alive": 0, "dead": 1, "censored": 0, "event": 1}
        event = pd.Series(event).str.lower().map(mapping).values

    event = event.astype(bool)

    return X, time, event


def py_scalar(val):
    """Convert numpy types to Python scalars"""
    if isinstance(val, (np.integer, np.floating)):
        return val.item()
    return val


def plot_survival_curves(groups_data, group_labels, filters_str, output_path):
    """
    Plot predicted RSF survival curves overlaid with actual Kaplan-Meier curves

    Args:
        groups_data: List of tuples (X_group, y_surv_group, model, group_label)
        group_labels: Dictionary mapping group values to labels
        filters_str: Filter string for legend
        output_path: Path to save PNG
    """
    if not LIFELINES_AVAILABLE:
        print(
            "⚠️ Lifelines not available, skipping survival curve plot",
            file=sys.stderr,
            flush=True,
        )
        return

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

        # Plot predicted RSF survival curve
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
        "Random Survival Forest Predicted vs Actual Survival Curves",
        fontsize=14,
        fontweight="bold",
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
        "readmit_time": "Random Forest Readmission Classification Accuracy by Outcome Class",
        "a1c_control": "Random Forest Readmission Classification Accuracy by A1C Control Level",
        "age_diabetes": "Random Forest Readmission Classification Accuracy by Age Group",
        "race_diabetes": "Random Forest Readmission Classification Accuracy by Race",
    }
    ax1.set_title(
        title_map.get(group_by, "Random Forest Readmission Classification Accuracy"),
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
        f"Random Forest Hospital Readmission Prediction — Diabetes Dataset\n{filter_text}",
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
        "gender_sylhet": "Random Forest Diabetes Prediction Accuracy by Gender",
        "age_sylhet": "Random Forest Diabetes Prediction Accuracy by Age Group",
        "obesity_sylhet": "Random Forest Diabetes Prediction Accuracy by Obesity Status",
        "age_cross": "Random Forest Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "Random Forest Diabetes Prediction Accuracy"),
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
        f"Random Forest Diabetes Diagnosis — Sylhet Hospital (Bangladesh)\n{filter_text}",
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
    """Run binary diabetes classification using Random Forest on Sylhet Bangladesh data"""
    import time as timer

    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split

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
            json.dumps(
                {"error": "No Sylhet datasets found", "model": "Random Forest Diabetes"}
            )
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
                    f"🔬 Training Random Forest for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = RandomForestClassifier(
                    n_estimators=100,
                    max_depth=None,
                    random_state=42,
                    n_jobs=-1,
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
                "model": "Random Forest Diabetes Prediction (Group Comparison)",
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

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=None,
        random_state=42,
        n_jobs=-1,
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
        "model": "Random Forest Diabetes Prediction",
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
        "age_pima": "Random Forest Diabetes Prediction Accuracy by Age Group",
        "bmi_pima": "Random Forest Diabetes Prediction Accuracy by BMI Category",
        "glucose_pima": "Random Forest Diabetes Prediction Accuracy by Glucose Level",
        "age_cross": "Random Forest Diabetes Prediction Accuracy by Age Group (Cross-Dataset)",
    }
    ax1.set_title(
        title_map.get(group_by, "Random Forest Diabetes Prediction Accuracy"),
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
        f"Random Forest Diabetes Diagnosis — Pima Indians (USA)\n{filter_text}",
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
    """Run binary diabetes classification using Random Forest on Pima Indians USA data"""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split
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
            json.dumps(
                {"error": "No Pima datasets found", "model": "Random Forest Diabetes"}
            )
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
                    f"🔬 Training Random Forest for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = RandomForestClassifier(
                    n_estimators=100,
                    max_depth=None,
                    random_state=42,
                    n_jobs=-1,
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
                "model": "Random Forest Diabetes Prediction (Group Comparison)",
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

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=None,
        random_state=42,
        n_jobs=-1,
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
        "model": "Random Forest Diabetes Prediction",
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
    """Run 3-class readmission classification using Random Forest on diabetic data"""
    import time as timer

    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import train_test_split
    from sklearn.utils.class_weight import compute_class_weight

    start_time = timer.time()

    frames = []
    for dataset_path in args.datasets:
        if "diabetic" not in dataset_path.lower():
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
                {
                    "error": "No diabetic datasets found",
                    "model": "Random Forest Readmission",
                }
            )
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f" Combined dataset: {len(combined)} encounters", file=sys.stderr, flush=True)

    X, labels, df_flat, feature_cols = preprocess_diabetic_flat(combined)

    print(f" Feature matrix shape: {X.shape}", file=sys.stderr, flush=True)

    group_col = None
    group_labels_dict = {}

    if args.group_by == "readmit_time":
        print(
            f" Readmission timing mode: training single model, reporting per-class metrics",
            file=sys.stderr,
            flush=True,
        )

        X_train, X_test, y_train, y_test = train_test_split(
            X, labels, test_size=0.2, random_state=42, stratify=labels
        )

        class_weights = compute_class_weight(
            "balanced", classes=np.array([0, 1, 2]), y=y_train
        )
        class_weight_dict = {
            0: class_weights[0],
            1: class_weights[1],
            2: class_weights[2],
        }

        print(
            f"🔬 Training Random Forest: {len(X_train)} train, {len(X_test)} test",
            file=sys.stderr,
            flush=True,
        )

        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=None,
            class_weight=class_weight_dict,
            random_state=42,
            n_jobs=-1,
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
            "model": "Random Forest Readmission Prediction (Group Comparison)",
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

                X_train, X_test, y_train, y_test = train_test_split(
                    X_group, y_group, test_size=0.2, random_state=42, stratify=y_group
                )

                print(
                    f"🔬 Training Random Forest for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                model = RandomForestClassifier(
                    n_estimators=100,
                    max_depth=None,
                    random_state=42,
                    n_jobs=-1,
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
                "model": "Random Forest Readmission Prediction (Group Comparison)",
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
    parser = argparse.ArgumentParser(description="Random Survival Forest Model")
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
        "--n_estimators", type=int, default=100, help="Number of trees in the forest"
    )
    parser.add_argument(
        "--min_rows", type=int, default=20, help="Minimum rows required after filtering"
    )
    parser.add_argument(
        "--output-image",
        type=str,
        default=None,
        help="Path to save predicted vs actual survival curve plot (PNG)",
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

    # Early branch: if any dataset is diabetic, run classification mode
    if any("diabetic" in d.lower() for d in args.datasets):
        print(
            "🔀 Diabetic dataset detected — switching to classification mode",
            file=sys.stderr,
            flush=True,
        )
        run_diabetes_classification(args)
        sys.exit(0)

    if not SKSURV_AVAILABLE:
        print(
            "Error: scikit-survival not installed. Install with: pip install scikit-survival",
            file=sys.stderr,
        )
        sys.exit(1)

    # Combine all datasets first (like XGBoost does)
    frames = []
    for dataset_path in args.datasets:
        dataset_type = detect_dataset_type(dataset_path)
        df = pd.read_csv(dataset_path)
        df = canonicalise_columns(df, dataset_type)
        df = apply_filters(df, args.filters)
        frames.append(df)
        print(f"Loaded {dataset_path}: {len(df)} rows", file=sys.stderr, flush=True)

    combined = pd.concat(frames, ignore_index=True)
    print(f"Combined dataset: {len(combined)} rows", file=sys.stderr, flush=True)

    if len(combined) < args.min_rows:
        print(f"Error: Insufficient data: {len(combined)} rows", file=sys.stderr)
        sys.exit(1)

    # Identify time and event columns
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

    print(f"Using time column: {time_col}, event column: {event_col}", file=sys.stderr)

    # Prepare features (exclude time and event from features)
    X = combined.drop(columns=[time_col, event_col, "pid"], errors="ignore")

    # Handle categorical variables
    for col in X.columns:
        if X[col].dtype == "object":
            X[col] = pd.Categorical(X[col]).codes

    # Convert to numeric
    X = X.apply(pd.to_numeric, errors="coerce")
    X = X.fillna(X.mean())

    # Remove zero-variance columns
    X = X.loc[:, X.std() > 1e-6]

    print(f"Prepared {X.shape[1]} features", file=sys.stderr, flush=True)

    # Get time and event arrays
    time = combined[time_col].values
    event = combined[event_col].values

    # Ensure event is binary
    if event.dtype == "object":
        mapping = {"alive": 0, "dead": 1, "censored": 0, "event": 1}
        event = pd.Series(event).str.lower().map(mapping).values
    event = event.astype(bool)

    # Create structured array
    y = Surv.from_arrays(event=event, time=time)

    # Remove invalid data
    valid_mask = (time > 0) & (~np.isnan(time))
    X = X[valid_mask]
    y = y[valid_mask]
    combined_valid = combined[valid_mask].reset_index(drop=True)

    print(f"Valid samples: {len(X)}", file=sys.stderr, flush=True)
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

    if group_col and group_col in combined_valid.columns:
        print(
            f"🔍 Using --group-by {args.group_by} - performing group comparison",
            file=sys.stderr,
        )

        groups = sorted(combined_valid[group_col].dropna().unique())

        group_results = []
        groups_for_plotting = []  # For survival curve visualization

        # Reset indices to align X, y, and combined_valid
        X_aligned = X.reset_index(drop=True)
        # Recreate y with aligned indices
        time_aligned = combined_valid[time_col].values
        event_aligned = combined_valid[event_col].values
        if event_aligned.dtype == "object":
            mapping = {"alive": 0, "dead": 1, "censored": 0, "event": 1}
            event_aligned = pd.Series(event_aligned).str.lower().map(mapping).values
        event_aligned = event_aligned.astype(bool)
        y_aligned = Surv.from_arrays(event=event_aligned, time=time_aligned)

        for group_val in groups:
            mask = combined_valid[group_col] == group_val
            X_group = X_aligned[mask]
            y_group = y_aligned[mask]

            if len(X_group) < 20:
                print(
                    f"⚠️ Skipping {group_labels.get(group_val, f'Group_{group_val}')}: only {len(X_group)} samples",
                    file=sys.stderr,
                )
                continue

            # Train RSF for this group
            rsf_group = RandomSurvivalForest(
                n_estimators=args.n_estimators,
                min_samples_split=10,
                min_samples_leaf=5,
                max_features="sqrt",
                random_state=42,
                n_jobs=-1,
            )

            try:
                rsf_group.fit(X_group, y_group)
                risk_scores = rsf_group.predict(X_group)
                c_index = concordance_index_censored(
                    y_group["event"], y_group["time"], -risk_scores
                )
                c_index_value = float(c_index[0])

                print(
                    f"✅ {group_labels.get(group_val, f'Group_{group_val}')}: C-index = {c_index_value:.4f}",
                    file=sys.stderr,
                )

                group_results.append(
                    {
                        "group": group_labels.get(group_val, f"Group_{group_val}"),
                        "n_samples": int(len(X_group)),
                        "n_events": int(y_group["event"].sum()),
                        "n_censored": int((~y_group["event"]).sum()),
                        "c_index": c_index_value,
                    }
                )

                # Collect data for plotting
                groups_for_plotting.append(
                    (
                        X_group,
                        y_group,
                        rsf_group,
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
        image_path = None
        if len(groups_for_plotting) >= 1 and args.output_image:
            image_path = args.output_image
            plot_survival_curves(
                groups_for_plotting, group_labels, args.filters, image_path
            )

        # Build result with group comparison
        output = {
            "model": "Random Survival Forest (Group Comparison)",
            "n_samples": len(X),
            "n_features": X.shape[1],
            "group_by": args.group_by,
            "groups_compared": [group_labels.get(g, f"Group_{g}") for g in groups],
            "group_results": group_results,
            "filters_applied": args.filters if args.filters else "None",
        }

        if image_path:
            output["image_path"] = image_path

    else:
        # Original single-group analysis
        print(
            f"📊 No valid grouping column found for --group-by={args.group_by} - performing single analysis",
            file=sys.stderr,
        )

        rsf = RandomSurvivalForest(
            n_estimators=args.n_estimators,
            min_samples_split=10,
            min_samples_leaf=5,
            max_features="sqrt",
            random_state=42,
            n_jobs=-1,
        )

        try:
            rsf.fit(X, y)
            print(f"✅ Model trained successfully", file=sys.stderr)
        except Exception as e:
            print(f"Error: Training failed: {str(e)}", file=sys.stderr)
            sys.exit(1)

        # Calculate C-index
        try:
            risk_scores = rsf.predict(X)
            c_index = concordance_index_censored(y["event"], y["time"], -risk_scores)
            c_index_value = float(c_index[0])
            print(f"C-index: {c_index_value:.4f}", file=sys.stderr)
        except Exception as e:
            print(f"⚠️ Could not calculate C-index: {e}", file=sys.stderr)
            c_index_value = None

        # Calculate feature importance
        try:
            from sklearn.inspection import permutation_importance

            perm_importance = permutation_importance(
                rsf, X, y, n_repeats=10, random_state=42, n_jobs=-1
            )
            feature_names = X.columns
            importances = perm_importance.importances_mean
            indices = np.argsort(importances)[::-1][:10]
            top_features = {feature_names[i]: float(importances[i]) for i in indices}
            print(f"✅ Calculated feature importances", file=sys.stderr)
        except Exception as e:
            print(f"⚠️ Could not calculate feature importances: {e}", file=sys.stderr)
            top_features = {col: None for col in list(X.columns)[:10]}

        # Build result for single analysis
        output = {
            "model": "Random Survival Forest",
            "n_samples": len(X),
            "n_features": X.shape[1],
            "n_events": int(np.sum(event)),
            "n_censored": int(len(event) - np.sum(event)),
            "c_index": c_index_value,
            "oob_score": float(rsf.oob_score_) if hasattr(rsf, "oob_score_") else None,
            "top_features": top_features,
            "filters_applied": args.filters if args.filters else "None",
        }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
