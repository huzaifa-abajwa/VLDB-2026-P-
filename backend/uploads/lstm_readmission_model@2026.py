#!/usr/bin/env python3
"""
LSTM Readmission Prediction Model
Bidirectional LSTM for hospital readmission prediction using diabetic_data.csv
Author: Ibrahim Murtaza
Date: February 2026
"""

import argparse
import json
import sys
import time as timer

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.utils.class_weight import compute_class_weight

# Check TensorFlow availability
try:
    import tensorflow as tf
    from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
    from sklearn.model_selection import train_test_split
    from tensorflow import keras
    from tensorflow.keras.layers import (
        LSTM,
        Bidirectional,
        Dense,
        Dropout,
        Input,
        Masking,
    )
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.utils import to_categorical

    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False
    print(
        "Error: TensorFlow not installed. Install with: pip install tensorflow",
        file=sys.stderr,
    )


def parse_filters(filter_str):
    """Parse filter string into dictionary"""
    filters = {}
    if not filter_str:
        return filters

    for part in filter_str.split(","):
        if "=" not in part:
            continue
        key, val = part.split("=", 1)
        key = key.strip()
        val = val.strip()

        if "-" in val and not val.startswith("-"):
            # Range filter
            try:
                low, high = val.split("-")
                filters[key] = ("range", float(low), float(high))
            except ValueError:
                filters[key] = ("exact", val)
        else:
            # Exact match
            filters[key] = ("exact", val)

    return filters


def apply_filters(df, filter_str):
    """Apply filters to diabetes dataset"""
    filters = parse_filters(filter_str)

    for col, (ftype, *vals) in filters.items():
        if col not in df.columns:
            print(f"⚠️ Filter column '{col}' not found, skipping", file=sys.stderr)
            continue

        if ftype == "range":
            low, high = vals
            df = df[(df[col] >= low) & (df[col] <= high)]
        elif ftype == "exact":
            df = df[df[col] == vals[0]]

    return df


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


def preprocess_diabetic_data(df):
    """
    Preprocess diabetic_data.csv into patient sequences
    Converts multi-encounter data into sequential format for LSTM
    """
    print(" Preprocessing diabetic data...", file=sys.stderr, flush=True)

    # Map readmitted to numeric: NO=0, >30=1, <30=2
    readmit_map = {"NO": 0, ">30": 1, "<30": 2}
    df["readmitted_class"] = df["readmitted"].map(readmit_map)

    # Handle missing values
    df = df.fillna(0)

    # Select features for LSTM (exclude target and IDs)
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
        # Convert A1C categories to numeric
        a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
        df["a1c_numeric"] = df["A1Cresult"].map(a1c_map).fillna(0)
        print(
            f"📊 A1C mapping - unmapped values: {df['A1Cresult'][~df['A1Cresult'].isin(a1c_map.keys())].unique()}",
            file=sys.stderr,
            flush=True,
        )
        feature_cols.append("a1c_numeric")

    # Normalize features before sequencing
    from sklearn.preprocessing import StandardScaler

    # Safety: fill any remaining NaN
    nan_count = df[feature_cols].isna().sum().sum()
    if nan_count > 0:
        print(
            f"⚠️ Found {nan_count} NaN values in features, filling with 0",
            file=sys.stderr,
            flush=True,
        )
        df[feature_cols] = df[feature_cols].fillna(0)
    scaler = StandardScaler()
    print(f" Feature ranges BEFORE scaling:", file=sys.stderr, flush=True)
    for col in feature_cols:
        print(
            f"   {col}: min={df[col].min()}, max={df[col].max()}, mean={df[col].mean():.2f}",
            file=sys.stderr,
            flush=True,
        )
    df[feature_cols] = scaler.fit_transform(df[feature_cols].astype(float))
    print(f"✅ Features normalized with StandardScaler", file=sys.stderr, flush=True)
    print(f" Feature ranges AFTER scaling:", file=sys.stderr, flush=True)
    for col in feature_cols:
        print(
            f"   {col}: min={df[col].min():.2f}, max={df[col].max():.2f}, mean={df[col].mean():.2f}",
            file=sys.stderr,
            flush=True,
        )

    # Label distribution
    print(f" Label distribution:", file=sys.stderr, flush=True)
    for val, name in {0: "NO", 1: ">30", 2: "<30"}.items():
        count = (df["readmitted_class"] == val).sum()
        print(
            f"   {name}: {count} ({count/len(df)*100:.1f}%)",
            file=sys.stderr,
            flush=True,
        )

    # Group by patient_nbr to create sequences
    patient_groups = df.groupby("patient_nbr")

    sequences = []
    labels = []
    patient_ids = []

    for patient_id, group in patient_groups:
        # Sort by encounter_id to maintain temporal order
        group = group.sort_values("encounter_id")

        # Extract feature sequence
        seq = group[feature_cols].values

        # Use last encounter's readmission status as label
        label = group["readmitted_class"].iloc[-1]

        sequences.append(seq)
        labels.append(label)
        patient_ids.append(patient_id)

    print(f"✅ Created {len(sequences)} patient sequences", file=sys.stderr, flush=True)

    return sequences, np.array(labels), patient_ids, feature_cols


def pad_sequences_custom(sequences, maxlen=None):
    """Pad sequences to same length with masking support"""
    if maxlen is None:
        maxlen = max(len(seq) for seq in sequences)

    padded = np.full((len(sequences), maxlen, sequences[0].shape[1]), -1.0)
    print(
        f" Padding {len(sequences)} sequences to maxlen={maxlen}, pad_value=-1.0",
        file=sys.stderr,
        flush=True,
    )

    for i, seq in enumerate(sequences):
        length = min(len(seq), maxlen)
        padded[i, :length, :] = seq[:length]

    return padded


def compute_subgroup_probabilities(df_patients, y_pred_proba, subgroup_col, subgroup_labels=None):
    """
    Compute mean predicted P(readmission <30 days) per subgroup with 95% CI.
    """
    from scipy import stats

    results = {}
    if subgroup_col not in df_patients.columns:
        return results

    p_readmit = y_pred_proba[:, 2]

    for val in sorted(df_patients[subgroup_col].dropna().unique()):
        mask = df_patients[subgroup_col].values == val
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


def plot_readmission_probability(race_probabilities, subgroup_key, output_path):
    """
    Plot paper-style readmission probability graph.
    Multiple lines (one per race) on the same plot with unified x-axis.
    """
    fig, ax = plt.subplots(figsize=(12, 7))
    colors = {"African American": "#1f77b4", "Caucasian": "#ff7f0e", "Hispanic": "#2ca02c", "Asian": "#d62728"}
    markers = {"African American": "o", "Caucasian": "s", "Hispanic": "^", "Asian": "D"}

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
    ax.set_title(f"LSTM — Readmission Probability by {subgroup_key} Across Races", fontsize=14, fontweight="bold")
    ax.legend(title="Race", fontsize=10, title_fontsize=11)
    ax.grid(True, alpha=0.3)
    ax.set_ylim(bottom=0)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(f"✅ Probability plot saved to {output_path}", file=sys.stderr, flush=True)
    plt.close()


def build_lstm_model(input_shape, num_classes=3, lstm_units=64, dropout_rate=0.5):
    """
    Build Bidirectional LSTM model for readmission prediction

    Args:
        input_shape: (max_sequence_length, num_features)
        num_classes: 3 (NO, >30, <30)
        lstm_units: Number of LSTM units
        dropout_rate: Dropout rate for regularization
    """
    model = Sequential(
        [
            Input(shape=input_shape),
            Masking(mask_value=-1.0),  # Ignore padded values
            Bidirectional(
                LSTM(lstm_units, return_sequences=False, dropout=dropout_rate)
            ),
            Dense(32, activation="relu"),
            Dropout(dropout_rate),
            Dense(num_classes, activation="softmax"),
        ]
    )

    model.compile(
        optimizer="adam", loss="categorical_crossentropy", metrics=["accuracy"]
    )

    return model


def plot_readmission_results(
    groups_for_plotting,
    group_labels,
    filters_str,
    output_path,
    mode="readmit_time",
    group_by="",
):
    """
    Plot single-panel bar chart of per-group/per-class accuracy
    """
    fig, ax1 = plt.subplots(1, 1, figsize=(10, 7))

    # === Bar chart ===
    group_names = []
    accuracies = []

    for predictions, true_labels, label in groups_for_plotting:
        group_names.append(label)
        pred_classes = np.argmax(predictions, axis=1)
        if len(predictions.shape) > 1:
            acc = np.mean(pred_classes == true_labels)
        else:
            acc = np.mean(predictions == true_labels)
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

    # Descriptive titles based on grouping
    title_map = {
        "readmit_time": "Readmission Classification Accuracy by Outcome Class",
        "a1c_control": "Readmission Classification Accuracy by A1C Control Level",
        "age_diabetes": "Readmission Classification Accuracy by Age Group",
        "race_diabetes": "Readmission Classification Accuracy by Race",
    }
    ax1.set_title(
        title_map.get(group_by, "Readmission Classification Accuracy"),
        fontsize=13,
        fontweight="bold",
    )
    ax1.set_xlabel(
        "Readmission Class" if mode == "readmit_time" else "Group", fontsize=11
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
        f"LSTM Hospital Readmission Prediction — Diabetes Dataset\n{filter_text}",
        fontsize=14,
        fontweight="bold",
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(
        f"✅ Readmission prediction plot saved to {output_path}",
        file=sys.stderr,
        flush=True,
    )
    plt.close()


def main():
    if not TF_AVAILABLE:
        print(json.dumps({"error": "TensorFlow not installed"}))
        sys.exit(1)

    start_time = timer.time()

    parser = argparse.ArgumentParser(description="LSTM Readmission Prediction")
    parser.add_argument(
        "--vars",
        type=str,
        default="all",
        help="Variables (not used for LSTM, kept for compatibility)",
    )
    parser.add_argument(
        "--filters", type=str, default="", help="Filters (e.g., age_range=40-50)"
    )
    parser.add_argument(
        "--group-by",
        type=str,
        default="readmit_time",
        help="Group by: readmit_time, a1c_control, age_diabetes, race_diabetes",
    )
    parser.add_argument(
        "--output-image", type=str, default="", help="Path to save plot"
    )
    parser.add_argument("datasets", nargs="+", help="Dataset file paths")

    args = parser.parse_args()

    # ===== CROSS-RACE PROBABILITY MODE =====
    race_datasets = [(d, extract_race_from_filename(d)) for d in args.datasets
                     if extract_race_from_filename(d) is not None]

    if len(race_datasets) >= 2:
        print(f"🏥 LSTM Cross-race probability mode: {len(race_datasets)} race datasets detected",
              file=sys.stderr, flush=True)

        all_race_probs = {}
        race_metrics = []

        for dataset_path, race_label in race_datasets:
            print(f"\n{'='*60}", file=sys.stderr, flush=True)
            print(f"Processing {race_label}...", file=sys.stderr, flush=True)

            df_race = pd.read_csv(dataset_path)
            df_race = apply_filters(df_race, args.filters)

            # Sequential preprocessing
            sequences, labels_seq, patient_ids, feature_cols = preprocess_diabetic_data(df_race)

            if len(sequences) < 20:
                print(f"⚠️ Skipping {race_label}: only {len(sequences)} patients", file=sys.stderr)
                continue

            # Build patient-level metadata for subgroup analysis
            df_patients = df_race.groupby("patient_nbr").first().reindex(patient_ids).reset_index()

            # Pad sequences
            max_len = max(len(s) for s in sequences)
            X_race = pad_sequences_custom(sequences, maxlen=max_len)

            # Split by index to keep df_patients aligned
            indices = np.arange(len(X_race))
            train_idx, test_idx = train_test_split(
                indices, test_size=0.2, random_state=42, stratify=labels_seq
            )

            X_train, X_test = X_race[train_idx], X_race[test_idx]
            y_train, y_test = labels_seq[train_idx], labels_seq[test_idx]
            df_test_race = df_patients.iloc[test_idx].reset_index(drop=True)

            y_train_cat = to_categorical(y_train, num_classes=3)
            y_test_cat = to_categorical(y_test, num_classes=3)

            # Class weights
            class_weights = compute_class_weight("balanced", classes=np.array([0, 1, 2]), y=y_train)
            class_weight_dict = {i: class_weights[i] for i in range(3)}

            model = build_lstm_model(
                input_shape=(X_train.shape[1], X_train.shape[2]),
                num_classes=3, lstm_units=64, dropout_rate=0.5,
            )

            step_start = timer.time()
            model.fit(
                X_train, y_train_cat, epochs=30, batch_size=32, verbose=0,
                validation_split=0.2, class_weight=class_weight_dict,
                callbacks=[keras.callbacks.ModelCheckpoint(
                    f"best_lstm_{race_label.replace(' ', '_')}.weights.h5",
                    monitor="val_accuracy", mode="max",
                    save_best_only=True, save_weights_only=True, verbose=1,
                )]
            )
            model.load_weights(f"best_lstm_{race_label.replace(' ', '_')}.weights.h5")
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
                "n_patients": len(X_race),
                "n_train": len(X_train),
                "n_test": len(X_test),
                "accuracy": accuracy,
                "auc": avg_auc,
            })

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
                        low = int(str(bracket).strip("[()").split("-")[0])
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
        image_paths = []
        if args.output_image and all_race_probs:
            base_path = args.output_image.rsplit(".", 1)[0]
            for subgroup_key, race_data in all_race_probs.items():
                safe_key = subgroup_key.replace(" ", "_").lower()
                img_path = f"{base_path}_{safe_key}.png"
                plot_readmission_probability(race_data, subgroup_key, img_path)
                image_paths.append(img_path)

        output = {
            "model": "LSTM Cross-Race Readmission Probability",
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

        if image_paths:
            output["image_paths"] = image_paths
            output["image_path"] = image_paths[0] if image_paths else None

        total_elapsed = timer.time() - start_time
        print(f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True)
        print(json.dumps(output, indent=2))
        sys.exit(0)

    # Load diabetic_data.csv
    print(f"📂 Loading datasets: {args.datasets}", file=sys.stderr, flush=True)

    frames = []
    for dataset_path in args.datasets:
        if "diabetic" not in dataset_path.lower() and "readmission" not in dataset_path.lower():
            print(f"⚠️ Skipping non-diabetic dataset: {dataset_path}", file=sys.stderr)
            continue

        df = pd.read_csv(dataset_path)
        df = apply_filters(df, args.filters)
        frames.append(df)

    if not frames:
        print(
            json.dumps(
                {
                    "error": "No diabetic datasets found",
                    "model": "LSTM Readmission Prediction",
                }
            )
        )
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f" Combined dataset: {len(combined)} encounters", file=sys.stderr, flush=True)

    # Preprocess into sequences
    sequences, labels, patient_ids, feature_cols = preprocess_diabetic_data(combined)

    # Pad sequences
    max_length = max(len(seq) for seq in sequences)
    X = pad_sequences_custom(sequences, maxlen=max_length)

    print(f" Sequence shape: {X.shape}", file=sys.stderr, flush=True)
    print(f" Max sequence length: {max_length} encounters", file=sys.stderr, flush=True)

    # Check if we have enough data for grouping
    group_col = None
    group_labels_dict = {}

    # Reconstruct dataframe for grouping
    df_for_grouping = combined.groupby("patient_nbr").first().reset_index()
    df_for_grouping["readmitted_class"] = labels

    if args.group_by == "readmit_time":
        # SPECIAL CASE: readmit_time splits by the TARGET variable
        # Train ONE model on all data, report per-class metrics
        print(
            f" Readmission timing mode: training single model, reporting per-class metrics",
            file=sys.stderr,
            flush=True,
        )

        y_cat = to_categorical(labels, num_classes=3)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_cat, test_size=0.2, random_state=42, stratify=labels
        )

        print(
            f"🔬 Training LSTM: {len(X_train)} train, {len(X_test)} test",
            file=sys.stderr,
            flush=True,
        )

        # Debug: check data isn't all zeros or constant
        print(
            f"📊 X_train stats: mean={X_train.mean():.4f}, std={X_train.std():.4f}, min={X_train.min():.4f}, max={X_train.max():.4f}",
            file=sys.stderr,
            flush=True,
        )
        print(
            f"📊 X_train non-padded timesteps: {(X_train != -1.0).any(axis=2).sum()}",
            file=sys.stderr,
            flush=True,
        )
        y_debug = np.argmax(y_train, axis=1)
        print(
            f"📊 y_train distribution: NO={np.sum(y_debug==0)}, >30={np.sum(y_debug==1)}, <30={np.sum(y_debug==2)}",
            file=sys.stderr,
            flush=True,
        )

        step_start = timer.time()

        model = build_lstm_model(
            input_shape=(X_train.shape[1], X_train.shape[2]),
            num_classes=3,
            lstm_units=64,
            dropout_rate=0.5,
        )

        # Compute class weights to handle imbalance
        y_train_classes = np.argmax(y_train, axis=1)
        class_weights = compute_class_weight(
            "balanced", classes=np.array([0, 1, 2]), y=y_train_classes
        )
        class_weight_dict = {
            0: class_weights[0],
            1: class_weights[1],
            2: class_weights[2],
        }
        print(f" Class weights: {class_weight_dict}", file=sys.stderr, flush=True)

        history = model.fit(
            X_train,
            y_train,
            validation_split=0.2,
            epochs=30,
            batch_size=32,
            verbose=0,
            class_weight=class_weight_dict,
            callbacks=[
                keras.callbacks.ModelCheckpoint(
                    "best_lstm_weights.weights.h5",
                    monitor="val_accuracy",
                    mode="max",
                    save_best_only=True,
                    save_weights_only=True,
                    verbose=1,
                )
            ],
        )
        model.load_weights("best_lstm_weights.weights.h5")
        print(f"✅ Loaded best weights from training", file=sys.stderr, flush=True)

        print(
            f"⏱️ Training took {timer.time() - step_start:.1f}s",
            file=sys.stderr,
            flush=True,
        )

        y_pred = model.predict(X_test, verbose=0)
        y_pred_classes = np.argmax(y_pred, axis=1)
        y_test_classes = np.argmax(y_test, axis=1)

        # Debug: what is the model actually predicting?
        print(
            f"📊 Prediction distribution: NO={np.sum(y_pred_classes==0)}, >30={np.sum(y_pred_classes==1)}, <30={np.sum(y_pred_classes==2)}",
            file=sys.stderr,
            flush=True,
        )
        print(
            f"📊 True label distribution: NO={np.sum(y_test_classes==0)}, >30={np.sum(y_test_classes==1)}, <30={np.sum(y_test_classes==2)}",
            file=sys.stderr,
            flush=True,
        )
        print(f"📊 Pred probabilities sample (first 5):", file=sys.stderr, flush=True)
        for i in range(min(5, len(y_pred))):
            print(
                f"   [{y_pred[i][0]:.4f}, {y_pred[i][1]:.4f}, {y_pred[i][2]:.4f}] → predicted={y_pred_classes[i]}, true={y_test_classes[i]}",
                file=sys.stderr,
                flush=True,
            )

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
            except:
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
                plot_readmission_results(
                    groups_for_plotting,
                    class_names,
                    args.filters,
                    image_path,
                    mode="readmit_time",
                    group_by=args.group_by,
                )

        output = {
            "model": "LSTM Readmission Prediction (Group Comparison)",
            "n_features": X.shape[2],
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
            f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True
        )
        sys.exit(0)

    elif args.group_by == "a1c_control":
        if "A1Cresult" in df_for_grouping.columns:
            # Map A1C to groups
            a1c_map = {"None": 0, "Norm": 1, ">7": 2, ">8": 3}
            df_for_grouping["a1c_group"] = (
                df_for_grouping["A1Cresult"].map(a1c_map).fillna(0)
            )
            group_col = "a1c_group"
            group_labels_dict = {0: "No test", 1: "Normal", 2: ">7%", 3: ">8%"}

    elif args.group_by == "age_diabetes":
        if "age" in df_for_grouping.columns:
            # Create age groups
            age_bins = [0, 50, 70, 150]
            age_labels = [0, 1, 2]
            df_for_grouping["age_group"] = pd.cut(
                df_for_grouping["age"]
                .str.extract(r"(\d+)", expand=False)
                .astype(float),
                bins=age_bins,
                labels=age_labels,
                include_lowest=True,
            )
            group_col = "age_group"
            group_labels_dict = {0: "<50 years", 1: "50-70 years", 2: "≥70 years"}

    elif args.group_by == "race_diabetes":
        if "race" in df_for_grouping.columns:
            race_map = {
                "Caucasian": 0,
                "AfricanAmerican": 1,
                "Hispanic": 2,
                "Asian": 3,
                "Other": 4,
            }
            df_for_grouping["race_group"] = (
                df_for_grouping["race"].map(race_map).fillna(4)
            )
            group_col = "race_group"
            group_labels_dict = {
                0: "Caucasian",
                1: "African American",
                2: "Hispanic",
                3: "Asian",
                4: "Other",
            }

    # GROUP COMPARISON MODE
    if group_col and group_col in df_for_grouping.columns:
        unique_groups = sorted(df_for_grouping[group_col].dropna().unique())

        if len(unique_groups) >= 2:
            print(
                f" Group comparison mode: {args.group_by}",
                file=sys.stderr,
                flush=True,
            )
            print(f" Groups found: {unique_groups}", file=sys.stderr, flush=True)

            group_results = []
            groups_for_plotting = []

            for group_val in unique_groups:
                # Get indices for this group
                group_mask = df_for_grouping[group_col] == group_val
                group_indices = df_for_grouping[group_mask].index.tolist()

                if len(group_indices) < 10:
                    print(
                        f"⚠️ Skipping {group_labels_dict.get(group_val, f'Group_{group_val}')}: only {len(group_indices)} samples",
                        file=sys.stderr,
                    )
                    continue

                X_group = X[group_indices]
                y_group = labels[group_indices]

                # Convert labels to categorical
                y_group_cat = to_categorical(y_group, num_classes=3)

                # Train-test split
                X_train, X_test, y_train, y_test = train_test_split(
                    X_group,
                    y_group_cat,
                    test_size=0.2,
                    random_state=42,
                    stratify=y_group,
                )

                print(
                    f"🔬 Training LSTM for {group_labels_dict.get(group_val, f'Group_{group_val}')}: {len(X_train)} train, {len(X_test)} test",
                    file=sys.stderr,
                    flush=True,
                )

                # Build and train model
                model = build_lstm_model(
                    input_shape=(X_train.shape[1], X_train.shape[2]),
                    num_classes=3,
                    lstm_units=64,
                    dropout_rate=0.5,
                )

                # Train
                step_start = timer.time()
                history = model.fit(
                    X_train,
                    y_train,
                    validation_split=0.2,
                    epochs=30,
                    batch_size=32,
                    verbose=0,
                    callbacks=[
                        keras.callbacks.ModelCheckpoint(
                            "best_lstm_weights.weights.h5",
                            monitor="val_accuracy",
                            mode="max",
                            save_best_only=True,
                            save_weights_only=True,
                            verbose=1,
                        )
                    ],
                )
                model.load_weights("best_lstm_weights.weights.h5")
                print(
                    f"✅ Loaded best weights from training", file=sys.stderr, flush=True
                )
                print(
                    f"⏱️ Training took {timer.time() - step_start:.1f}s",
                    file=sys.stderr,
                    flush=True,
                )

                # Evaluate
                y_pred = model.predict(X_test, verbose=0)
                y_pred_classes = np.argmax(y_pred, axis=1)
                y_test_classes = np.argmax(y_test, axis=1)

                accuracy = np.mean(y_pred_classes == y_test_classes)

                # Calculate AUC for each class
                try:
                    auc_scores = []
                    for i in range(3):
                        auc = roc_auc_score(y_test[:, i], y_pred[:, i])
                        auc_scores.append(auc)
                    avg_auc = np.mean(auc_scores)
                except:
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
                        "n_events": int(np.sum(y_group == 2)),  # <30 day readmissions
                        "accuracy": float(accuracy),
                        "auc": float(avg_auc) if avg_auc else None,
                    }
                )

                # Collect for plotting
                groups_for_plotting.append(
                    (
                        y_pred,
                        y_test_classes,
                        group_labels_dict.get(group_val, f"Group_{group_val}"),
                    )
                )

            # Generate plot
            image_path = None
            if len(groups_for_plotting) >= 1 and args.output_image:
                image_path = args.output_image
                plot_readmission_results(
                    groups_for_plotting,
                    group_labels_dict,
                    args.filters,
                    image_path,
                    mode="group_comparison",
                    group_by=args.group_by,
                )

            output = {
                "model": "LSTM Readmission Prediction (Group Comparison)",
                "n_features": X.shape[2],
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

        else:
            print(f"⚠️ Not enough groups for comparison", file=sys.stderr)
            # Fall through to single model training

    # SINGLE MODEL MODE (if no valid grouping)
    else:
        print(f" Single model training on all data", file=sys.stderr, flush=True)

        # Convert labels to categorical
        y_cat = to_categorical(labels, num_classes=3)

        # Train-test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_cat, test_size=0.2, random_state=42, stratify=labels
        )

        print(
            f"🔬 Training LSTM: {len(X_train)} train, {len(X_test)} test",
            file=sys.stderr,
            flush=True,
        )

        # Build and train model
        model = build_lstm_model(
            input_shape=(X_train.shape[1], X_train.shape[2]),
            num_classes=3,
            lstm_units=64,
            dropout_rate=0.5,
        )

        # Train
        step_start = timer.time()
        history = model.fit(
            X_train,
            y_train,
            validation_split=0.2,
            epochs=30,
            batch_size=32,
            verbose=0,
            callbacks=[
                keras.callbacks.ModelCheckpoint(
                    "best_lstm_weights.weights.h5",
                    monitor="val_accuracy",
                    mode="max",
                    save_best_only=True,
                    save_weights_only=True,
                    verbose=1,
                )
            ],
        )
        model.load_weights("best_lstm_weights.weights.h5")
        print(f"✅ Loaded best weights from training", file=sys.stderr, flush=True)
        print(
            f"⏱️ Training took {timer.time() - step_start:.1f}s",
            file=sys.stderr,
            flush=True,
        )

        # Evaluate
        y_pred = model.predict(X_test, verbose=0)
        y_pred_classes = np.argmax(y_pred, axis=1)
        y_test_classes = np.argmax(y_test, axis=1)

        accuracy = np.mean(y_pred_classes == y_test_classes)

        # Calculate AUC
        try:
            auc_scores = []
            for i in range(3):
                auc = roc_auc_score(y_test[:, i], y_pred[:, i])
                auc_scores.append(auc)
            avg_auc = np.mean(auc_scores)
        except:
            avg_auc = None

        print(f"✅ Accuracy: {accuracy:.4f}", file=sys.stderr, flush=True)

        output = {
            "model": "LSTM Readmission Prediction",
            "n_samples": len(X),
            "n_features": X.shape[2],
            "n_events": int(np.sum(labels == 2)),  # <30 day readmissions
            "accuracy": float(accuracy),
            "auc": float(avg_auc) if avg_auc else None,
            "filters_applied": args.filters if args.filters else "None",
        }

        print(json.dumps(output, indent=2))

    total_elapsed = timer.time() - start_time
    print(f"⏱️ Total execution time: {total_elapsed:.1f}s", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
