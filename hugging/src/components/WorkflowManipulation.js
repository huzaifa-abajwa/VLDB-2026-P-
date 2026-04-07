import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import Layout from "./Layout";
import "../styles/workflowManipulation.css";

// Import BPMN Modeler and necessary CSS
import BpmnModeler from "bpmn-js/lib/Modeler";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const DISPLAY_NAMES = {
  "cox_model@2020.py": "Cox Proportional Hazards",
  "kaplan_meier_model@2020.py": "Kaplan-Meier Estimator",
  "xgboost_risk_model@2025.py": "XGBoost",
  "random_survival_forest@2025.py": "Random Survival Forest",
  "mlp_cancer_classifier@2025.py": "Multi-Layer Perceptron (MLP)",
  "lstm_readmission_model@2026.py": "Bidirectional LSTM",
  "google_Health_Cancer_Prediction_Model.py": "Logistic Regression",
  "SEER_Cancer_Registry_of_USA.csv": "SEER Cancer Registry (USA)",
  "German_Cancer_registry@2020.csv": "German Cancer Registry",
  "National_Cancer_Registry_of_Pakistan.csv":
    "National Cancer Registry (Pakistan)",
  "diabetic_data.csv": "UCI Diabetes 130-US Hospitals",
  "Sylhet_Diabetes_Hospital_Bangladesh.csv":
    "Sylhet Diabetes Hospital (Bangladesh)",
  "Pima_Indians_Diabetes_USA.csv": "Pima Indians Diabetes (USA)",
  "heart_failure_clinical_records_dataset.csv":
    "Heart Failure Clinical Records",
  "UCI_AfricanAmerican_Readmission.csv": "UCI Readmission (African American)",
  "UCI_Caucasian_Readmission.csv": "UCI Readmission (Caucasian)",
  "UCI_Hispanic_Readmission.csv": "UCI Readmission (Hispanic)",
  "UCI_Asian_Readmission.csv": "UCI Readmission (Asian)",
};
const displayName = (filename) => DISPLAY_NAMES[filename] || filename;

const parseOutput = (output) => {
  console.log("🔍 parseOutput called with:", output);
  console.log("🔍 output type:", typeof output);

  if (!output) {
    console.error("parseOutput called with invalid output:", output);
    return {};
  }
  try {
    let trimmedOutput = output.trim();
    // Extract JSON from mixed output (e.g., epoch logs + JSON)
    const jsonStart = trimmedOutput.lastIndexOf("\n{");
    if (jsonStart !== -1) {
      trimmedOutput = trimmedOutput.substring(jsonStart + 1);
    }
    const jsonOutput = JSON.parse(trimmedOutput);
    console.log("✅ JSON parsed successfully:", jsonOutput);

    // Handle new Random Survival Forest format with results_by_dataset
    if (jsonOutput.results_by_dataset) {
      // Check if ANY dataset has group_results (group comparison mode)
      const hasGroupComparison = Object.values(
        jsonOutput.results_by_dataset,
      ).some(
        (result) => result.group_results && Array.isArray(result.group_results),
      );

      if (hasGroupComparison) {
        // Extract group comparison from first dataset that has it
        const datasetWithGroups = Object.values(
          jsonOutput.results_by_dataset,
        ).find((result) => result.group_results);

        console.log("✅ MATCHED RSF group comparison in results_by_dataset");
        const result = {
          model: datasetWithGroups.model || jsonOutput.model,
          group_results: datasetWithGroups.group_results,
          groups_compared: datasetWithGroups.groups_compared,
          filters_applied:
            datasetWithGroups.filters_applied || jsonOutput.filters_applied,
          // Create prettyTable for legacy compatibility
          prettyTable: {
            "Groups Compared":
              datasetWithGroups.groups_compared?.join(" vs ") || "N/A",
            Filter1:
              datasetWithGroups.filters_applied ||
              jsonOutput.filters_applied ||
              "",
            Filter2: "",
            Filter3: "",
            coef: "N/A",
            HR: "N/A",
            p: "N/A",
            accuracy:
              datasetWithGroups.group_results?.[0]?.accuracy != null
                ? datasetWithGroups.group_results.reduce(
                    (sum, g) => sum + (g.accuracy || 0),
                    0,
                  ) / datasetWithGroups.group_results.length
                : null,
            auc:
              datasetWithGroups.group_results?.[0]?.auc != null
                ? datasetWithGroups.group_results.reduce(
                    (sum, g) => sum + (g.auc || 0),
                    0,
                  ) / datasetWithGroups.group_results.length
                : null,
          },
        };

        // Add image_path if present
        if (datasetWithGroups.image_path) {
          result.image_path = datasetWithGroups.image_path;
        }

        return result;
      }

      // No group comparison - convert multi-dataset results to display format
      const datasetResults = [];
      for (const [datasetName, result] of Object.entries(
        jsonOutput.results_by_dataset,
      )) {
        if (result.error) {
          datasetResults.push({
            dataset: datasetName,
            error: result.error,
          });
        } else {
          datasetResults.push({
            dataset: datasetName,
            n_samples: result.n_samples,
            n_features: result.n_features,
            n_events: result.n_events,
            n_censored: result.n_censored,
            c_index: result.metrics?.c_index,
            oob_score: result.metrics?.oob_score,
            top_features: result.top_features,
            time_range: result.time_range,
          });
        }
      }
      return {
        coxResults: datasetResults,
        results_by_dataset: jsonOutput.results_by_dataset,
        model: jsonOutput.model,
        n_estimators: jsonOutput.n_estimators,
        filters_applied: jsonOutput.filters_applied,
      };
    }

    // Handle cross-race probability mode (XGBoost/MLP/LSTM race comparison)
    if (jsonOutput.mode === "cross_race_probability") {
      console.log("✅ MATCHED cross-race probability format");
      return {
        model: jsonOutput.model,
        cross_race: true,
        race_metrics: jsonOutput.race_metrics,
        subgroups_analyzed: jsonOutput.subgroups_analyzed,
        probability_data: jsonOutput.probability_data,
        filters_applied: jsonOutput.filters_applied,
        prettyTable: {
          "Groups Compared":
            jsonOutput.race_metrics?.map((r) => r.race).join(" vs ") || "N/A",
          Filter1: jsonOutput.filters_applied || "",
          Filter2: "",
          Filter3: "",
          accuracy:
            jsonOutput.race_metrics?.length > 0
              ? jsonOutput.race_metrics.reduce(
                  (sum, r) => sum + (r.accuracy || 0),
                  0,
                ) / jsonOutput.race_metrics.length
              : null,
          auc:
            jsonOutput.race_metrics?.filter((r) => r.auc).length > 0
              ? jsonOutput.race_metrics.reduce(
                  (sum, r) => sum + (r.auc || 0),
                  0,
                ) / jsonOutput.race_metrics.filter((r) => r.auc).length
              : null,
        },
      };
    }

    if (jsonOutput.group_results && Array.isArray(jsonOutput.group_results)) {
      console.log("✅ MATCHED group comparison format");

      // Use actual pretty_table if present (Cox model), otherwise create dummy one
      const prettyTable = jsonOutput.pretty_table || {
        "Groups Compared": jsonOutput.groups_compared?.join(" vs ") || "N/A",
        Filter1: jsonOutput.filters_applied || "",
        Filter2: "",
        Filter3: "",
        coef: "N/A", // XGBoost/RSF/MLP don't output coefficients
        HR: "N/A", // XGBoost/RSF/MLP don't output hazard ratios
        p: "N/A", // XGBoost/RSF/MLP don't output p-values
        accuracy:
          jsonOutput.overall_accuracy != null
            ? jsonOutput.overall_accuracy
            : jsonOutput.group_results?.[0]?.accuracy != null
              ? jsonOutput.group_results.reduce(
                  (sum, g) => sum + (g.accuracy || 0),
                  0,
                ) / jsonOutput.group_results.length
              : null,
        auc:
          jsonOutput.group_results?.[0]?.auc != null
            ? jsonOutput.group_results.reduce(
                (sum, g) => sum + (g.auc || 0),
                0,
              ) / jsonOutput.group_results.filter((g) => g.auc).length
            : null,
      };

      return {
        model: jsonOutput.model,
        group_results: jsonOutput.group_results,
        groups_compared: jsonOutput.groups_compared,
        filters_applied: jsonOutput.filters_applied,
        prettyTable: prettyTable,
      };
    }

    if (
      jsonOutput.model &&
      jsonOutput.c_index !== undefined &&
      !jsonOutput.group_results &&
      !jsonOutput.results_by_dataset
    ) {
      console.log("✅ MATCHED single-group survival condition");
      const result = {
        model: jsonOutput.model,
        coxResults: [
          {
            model: jsonOutput.model,
            n_samples: jsonOutput.n_samples,
            n_features: jsonOutput.n_features,
            n_events: jsonOutput.n_events,
            n_censored: jsonOutput.n_censored,
            metrics: {
              c_index: jsonOutput.c_index,
              oob_score: jsonOutput.oob_score,
            },
            time_range: jsonOutput.time_range,
            top_features: jsonOutput.top_features,
            filters_applied: jsonOutput.filters_applied,
          },
        ],
      };
      console.log("📤 Returning parsed structure:", result);
      return result;
    }

    // Handle XGBoost format with metrics object (OLD classification format)
    if (
      jsonOutput.model &&
      jsonOutput.metrics &&
      !jsonOutput.results_by_dataset &&
      !jsonOutput.summary
    ) {
      return {
        coxResults: [
          {
            model: jsonOutput.model,
            n_samples_train: jsonOutput.n_samples_train,
            n_samples_test: jsonOutput.n_samples_test,
            n_features: jsonOutput.n_features,
            metrics: jsonOutput.metrics,
            confusion_matrix: jsonOutput.confusion_matrix,
            top_features: jsonOutput.top_features,
            filters_applied: jsonOutput.filters_applied,
          },
        ],
      };
    }

    // Handle Cox/KM format with summary
    if (jsonOutput.summary && Array.isArray(jsonOutput.summary)) {
      return {
        coxResults: jsonOutput.summary,
        baseline: jsonOutput.baseline,
        groupLabels: jsonOutput.group_labels || {},
        prettyTable: jsonOutput.pretty_table || null,
      };
    } else if (Array.isArray(jsonOutput)) {
      return { coxResults: jsonOutput };
    }
  } catch (e) {
    const lines = output.split("\n");
    let confusionMatrix = [];
    let classificationReport = "";
    let metrics = {};
    let isConfusionMatrix = false;
    let isClassificationReport = false;
    let classReportLines = [];
    lines.forEach((line) => {
      if (line.startsWith("Confusion Matrix:")) {
        isConfusionMatrix = true;
        isClassificationReport = false;
        return;
      }
      if (line.startsWith("Classification Report:")) {
        isConfusionMatrix = false;
        isClassificationReport = true;
        return;
      }
      if (isConfusionMatrix) {
        if (line.trim() !== "") {
          confusionMatrix.push(line.trim());
        }
      } else if (isClassificationReport) {
        classReportLines.push(line);
        const metricMatch = line.match(
          /(accuracy|macro avg|weighted avg)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d]+)/,
        );
        if (metricMatch) {
          const [_, label, precision, recall, f1Score, support] = metricMatch;
          metrics[label.trim()] = {
            precision: parseFloat(precision),
            recall: parseFloat(recall),
            f1Score: parseFloat(f1Score),
            support: parseInt(support),
          };
        }
      }
    });
    return {
      confusionMatrix,
      classificationReport: classReportLines.join("\n"),
      metrics,
    };
  }
};

// --- HELPER COMPONENT: PASTE THIS ABOVE YOUR MAIN COMPONENT ---
const SingleOutputRenderer = ({ outputObj }) => {
  const { imageUrl, output, dataset } = outputObj;

  // 1. Safe Parse
  let parsed = null;
  try {
    // Try your global helper first, fallback to standard JSON
    parsed =
      typeof parseOutput !== "undefined"
        ? parseOutput(output)
        : JSON.parse(output);
  } catch (e) {
    if (output && output !== "null") console.error("Parse Error:", e);
  }

  // 2. Determine "First Result" for easy access (safety check)
  const hasCoxResults =
    parsed && parsed.coxResults && parsed.coxResults.length > 0;
  const firstRes = hasCoxResults ? parsed.coxResults[0] : {};

  // --- RENDER HELPERS ---

  const renderGroupTable = (results, title) => {
    // Detect LSTM output: has accuracy/auc instead of c_index
    const isLSTM = results.length > 0 && results[0].accuracy !== undefined;

    return (
      <div className="wm-survival-comparison-results">
        <h5>
          {title ||
            (dataset || outputObj.datasets?.[0]
              ? `Group Comparison — ${displayName(dataset || outputObj.datasets?.[0])}`
              : "Group Comparison")}
        </h5>
        {parsed.groups_compared && (
          <p>
            <strong>Groups Compared:</strong>{" "}
            {parsed.groups_compared.join(" vs ")}
          </p>
        )}
        {parsed.overall_accuracy !== undefined && (
          <p>
            <strong>Overall Accuracy:</strong>{" "}
            {(parsed.overall_accuracy * 100).toFixed(2)}%
          </p>
        )}
        <table className="wm-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Samples</th>
              <th>{isLSTM ? "Total in Class" : "Events"}</th>
              <th>{isLSTM ? "Accuracy" : "C-Index"}</th>
              {isLSTM && <th>AUC</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((g, i) => (
              <tr key={i}>
                <td>
                  <strong>{g.group}</strong>
                </td>
                <td>{g.n_samples}</td>
                <td>{g.n_events}</td>
                <td>
                  {isLSTM
                    ? (g.accuracy * 100).toFixed(2) + "%"
                    : g.c_index
                      ? g.c_index.toFixed(4)
                      : "N/A"}
                </td>
                {isLSTM && <td>{g.auc ? g.auc.toFixed(4) : "N/A"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {renderFilters(parsed.filters_applied)}
      </div>
    );
  };

  const renderMetricsTable = (metrics) => (
    <table className="wm-table">
      <tbody>
        <tr>
          <td>Accuracy</td>
          <td>{(metrics.accuracy * 100).toFixed(2)}%</td>
        </tr>
        <tr>
          <td>Precision</td>
          <td>{(metrics.precision * 100).toFixed(2)}%</td>
        </tr>
        <tr>
          <td>Recall</td>
          <td>{(metrics.recall * 100).toFixed(2)}%</td>
        </tr>
        <tr>
          <td>F1 Score</td>
          <td>{(metrics.f1_score * 100).toFixed(2)}%</td>
        </tr>
        {metrics.auc_roc && (
          <tr>
            <td>AUC-ROC</td>
            <td>{(metrics.auc_roc * 100).toFixed(2)}%</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  const renderConfusionMatrix = (cm) => (
    <>
      <h5>Confusion Matrix</h5>
      <table className="wm-table">
        <tbody>
          <tr>
            <td>True Negative</td>
            <td>{cm.true_negative}</td>
          </tr>
          <tr>
            <td>False Positive</td>
            <td>{cm.false_positive}</td>
          </tr>
          <tr>
            <td>False Negative</td>
            <td>{cm.false_negative}</td>
          </tr>
          <tr>
            <td>True Positive</td>
            <td>{cm.true_positive}</td>
          </tr>
        </tbody>
      </table>
    </>
  );

  const renderFilters = (filters) => {
    if (!filters || filters === "None") return null;
    return (
      <p style={{ marginTop: "10px", fontSize: "0.9em", color: "#666" }}>
        <strong>Filters Applied:</strong> {filters}
      </p>
    );
  };

  // --- MAIN RENDER LOGIC ---

  return (
    <div className="wm-single-output">
      {/* 1. IMAGE SECTION */}
      {imageUrl && !outputObj._hideImage && (
        <>
          <h4>
            {parsed &&
            parsed.model &&
            parsed.model.toLowerCase().includes("lstm")
              ? "Readmission Prediction Results"
              : parsed &&
                  (parsed.group_results?.[0]?.accuracy != null ||
                    parsed.overall_accuracy != null)
                ? "Classification Results"
                : "Survival Curves"}
          </h4>
          <img
            src={imageUrl}
            alt="Plot"
            style={{
              maxWidth: "100%",
              marginBottom: "20px",
              border: "1px solid #ddd",
            }}
          />
        </>
      )}

      {/* 2. DATA/METRICS SECTION */}
      {parsed ? (
        <>
          {parsed.model !== "Random Survival Forest" && <h4>{dataset}</h4>}

          {/* SCENARIO 0: Cross-Race Probability Results */}
          {parsed.cross_race && parsed.race_metrics ? (
            <div className="wm-survival-comparison-results">
              <h5>Cross-Race Readmission Probability Comparison</h5>
              <table className="wm-table">
                <thead>
                  <tr>
                    <th>Race</th>
                    <th>Patients</th>
                    <th>Train</th>
                    <th>Test</th>
                    <th>Accuracy</th>
                    <th>AUC</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.race_metrics.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <strong>{r.race}</strong>
                      </td>
                      <td>{r.n_patients || r.n_samples}</td>
                      <td>{r.n_train}</td>
                      <td>{r.n_test}</td>
                      <td>{(r.accuracy * 100).toFixed(2)}%</td>
                      <td>{r.auc ? r.auc.toFixed(4) : "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.subgroups_analyzed && (
                <p
                  style={{
                    marginTop: "10px",
                    fontSize: "0.9em",
                    color: "#666",
                  }}
                >
                  <strong>Subgroups Analyzed:</strong>{" "}
                  {parsed.subgroups_analyzed.join(", ")}
                </p>
              )}
              {renderFilters(parsed.filters_applied)}
              {/* Cross-race probability plots */}
              {outputObj.crossRaceImages &&
                outputObj.crossRaceImages.length > 0 && (
                  <div style={{ marginTop: "20px" }}>
                    <h5>Subgroup Probability Plots</h5>
                    {outputObj.crossRaceImages.map((imgUrl, idx) => (
                      <img
                        key={idx}
                        src={imgUrl}
                        alt={`Cross-race plot ${idx + 1}`}
                        style={{
                          maxWidth: "100%",
                          marginBottom: "15px",
                          border: "1px solid #ddd",
                        }}
                      />
                    ))}
                  </div>
                )}
            </div>
          ) : /* SCENARIO A: Group Results (Direct or inside coxResults) */
          parsed.group_results || firstRes.group_results ? (
            renderGroupTable(
              parsed.group_results || firstRes.group_results,
              dataset
                ? `Group Comparison — ${displayName(dataset)}`
                : undefined,
            )
          ) : /* SCENARIO B: XGBoost / MLP with Metrics */
          firstRes.metrics ? (
            <div className="wm-xgboost-results">
              <h5>Model Performance</h5>
              {renderMetricsTable(firstRes.metrics)}
              {firstRes.confusion_matrix &&
                renderConfusionMatrix(firstRes.confusion_matrix)}
              {firstRes.filters_applied &&
                renderFilters(firstRes.filters_applied)}
            </div>
          ) : /* SCENARIO C: Random Survival Forest (Multiple Datasets) */
          parsed.model === "Random Survival Forest" && hasCoxResults ? (
            <div className="wm-rsf-results">
              {parsed.coxResults.map((res, idx) => (
                <div key={idx} className="wm-dataset-result">
                  {/* Handle RSF Group Comparison */}
                  {res.group_results ? (
                    renderGroupTable(
                      res.group_results,
                      `Group Comparison — ${displayName(dataset || "")}`,
                    )
                  ) : (
                    <>
                      <h4>Dataset {idx + 1}</h4>
                      <h5>Summary</h5>
                      <table className="wm-table">
                        <tbody>
                          <tr>
                            <td>Samples</td>
                            <td>{res.n_samples}</td>
                          </tr>
                          <tr>
                            <td>Events</td>
                            <td>{res.n_events}</td>
                          </tr>
                          <tr>
                            <td>C-Index</td>
                            <td>{res.c_index?.toFixed(4)}</td>
                          </tr>
                        </tbody>
                      </table>
                      {renderFilters(res.filters_applied)}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* SCENARIO D: Standard Single Survival Result (Default) */
            <div className="wm-survival-single-results">
              <h5>Model Performance</h5>
              <table className="wm-table">
                <tbody>
                  <tr>
                    <td>Samples</td>
                    <td>{parsed.n_samples || firstRes.n_samples}</td>
                  </tr>
                  <tr>
                    <td>Events</td>
                    <td>{parsed.n_events || firstRes.n_events}</td>
                  </tr>
                  <tr>
                    <td>C-Index</td>
                    <td>
                      {(parsed.c_index || firstRes.c_index || 0).toFixed(4)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {renderFilters(
                parsed.filters_applied || firstRes.filters_applied,
              )}
            </div>
          )}
        </>
      ) : (
        // If no JSON data, but image exists, we are done. If neither, show error/empty.
        !imageUrl && <p>No data available</p>
      )}
    </div>
  );
};

const CrossDatasetChart = ({ modelOutputs }) => {
  const datasets = modelOutputs.map((o) => {
    let parsed = null;
    try {
      parsed =
        typeof parseOutput !== "undefined"
          ? parseOutput(o.output)
          : JSON.parse(o.output);
    } catch (e) {}
    const dsName = o.dataset
      ? displayName(o.dataset)
      : o.datasets
        ? displayName(o.datasets[0])
        : "Unknown";
    return {
      name: dsName,
      groups: parsed?.group_results || [],
    };
  });

  if (
    datasets.length < 2 ||
    datasets[0].groups.length === 0 ||
    datasets[1].groups.length === 0
  )
    return null;

  const chartData = datasets[0].groups.map((g, i) => ({
    group: g.group,
    [datasets[0].name + " Accuracy"]: g.accuracy,
    [datasets[1].name + " Accuracy"]: datasets[1].groups[i]?.accuracy,
  }));

  const key0 = datasets[0].name + " Accuracy";
  const key1 = datasets[1].name + " Accuracy";

  return (
    <div style={{ marginBottom: "30px" }}>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} barGap={4} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="group" />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => (v * 100).toFixed(0) + "%"}
          />
          <Tooltip formatter={(v) => (v * 100).toFixed(2) + "%"} />
          <Legend />
          <Bar dataKey={key0} fill="#4A90D9" name={datasets[0].name} />
          <Bar dataKey={key1} fill="#82ca9d" name={datasets[1].name} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const WorkflowManipulation = () => {
  // Reference for the BPMN Modeler container
  const bpmnRef = useRef(null);
  const modelerRef = useRef(null);
  const isInitialMount = useRef(true);

  const variableNames = {
    pid: "Patient Identifier",
    age: "Age",
    meno: "Menopausal Status",
    size: "Tumor Size",
    grade: "Tumor Grade",
    nodes: "Number of Positive Lymph Nodes",
    pgr: "Progesterone Receptor Status",
    er: "Estrogen Receptor Status",
    hormon: "Hormone Therapy Status",
    rfstime: "Follow-up Time (Days)",
    status: "Event Indicator (Death)",
  };
  const FILTER_DEFS = {
    // Cancer filters (numeric)
    grade: { type: "numeric", min: 1, max: 3 },
    age_range: { type: "numeric", min: 20, max: 110 },
    laterality_group: { type: "numeric", min: 1, max: 2 },
    ER_Status_BC_Group: { type: "numeric", min: 1, max: 2 },
    PR_Status_BC_Group: { type: "numeric", min: 1, max: 2 },
    marital_status_at_dx: { type: "numeric", min: 1, max: 5 },
    // UCI Diabetes filters (numeric)
    a1c_range: { type: "numeric", min: 4, max: 14 },
    num_medications: { type: "numeric", min: 0, max: 30 },
    time_in_hospital: { type: "numeric", min: 1, max: 14 },
    num_lab_procedures: { type: "numeric", min: 0, max: 100 },
    // Sylhet Bangladesh filters (categorical + numeric)
    Gender: { type: "categorical", options: ["Male", "Female"] },
    Obesity: { type: "categorical", options: ["Yes", "No"] },
    age_range_sylhet: { type: "numeric", min: 20, max: 80 },
    // Pima Indians USA filters (numeric)
    age_range_pima: { type: "numeric", min: 21, max: 81 },
    glucose_range: { type: "numeric", min: 0, max: 200 },
    bmi_range: { type: "numeric", min: 0, max: 70 },
  };
  // Retrieve models and datasets from localStorage
  const [availableModels] = useState(() => {
    // Try LLM keys first, then fallback to manual selection keys
    const llmModels = localStorage.getItem("llmSelectedModels");
    const manualModels = localStorage.getItem("selectedModels");
    const modelsData = llmModels || manualModels;
    return modelsData ? JSON.parse(modelsData) : [];
  });

  const [availableDatasets] = useState(() => {
    // Try LLM keys first, then fallback to manual selection keys
    const llmDatasets = localStorage.getItem("llmSelectedDatasets");
    const manualDatasets = localStorage.getItem("selectedDatasets");
    const datasetsData = llmDatasets || manualDatasets;
    return datasetsData ? JSON.parse(datasetsData) : [];
  });

  // State to track selected models, datasets, and filters
  const [selectedModel, setSelectedModel] = useState([]);
  const [selectedDatasets, setSelectedDatasets] = useState(availableDatasets);
  const [filterString, setFilterString] = useState("");

  const [outputs, setOutputs] = useState([]); // Store outputs from multiple runs
  const [allPrettyTables, setAllPrettyTables] = useState([]); // Store concatenated pretty tables
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [dataSample, setDataSample] = useState(null);

  // Filter widget state
  const [selectedFilters, setSelectedFilters] = useState([]); // [{key, values:Set}]
  const [groupBy, setGroupBy] = useState("meno");
  const [groupByDataset2, setGroupByDataset2] = useState("gender_sylhet");
  const filterKeysAvailable = Object.keys(FILTER_DEFS);

  useEffect(() => {
    const spec = selectedFilters
      .map((f) => {
        const def = FILTER_DEFS[f.key];
        if (def && def.type === "categorical") {
          const selected = [...f.values];
          if (selected.length === 0) return null;
          return `${f.key}=${selected[0]}`;
        }
        const nums = [...f.values].sort((a, b) => a - b);
        if (nums.length === 0) return null;
        const lo = nums[0];
        const hi = nums[nums.length - 1];
        if (
          f.key === "age_range" ||
          f.key === "age_range_sylhet" ||
          f.key === "age_range_pima"
        ) {
          const rangeLo = lo;
          const rangeHi = lo + 10;
          return `Age=${rangeLo}-${rangeHi}`;
        }
        return lo === hi ? `${f.key}=${lo}` : `${f.key}=${lo}-${hi}`;
      })
      .filter(Boolean)
      .join(",");
    setFilterString(spec);
  }, [selectedFilters]);

  // // Initialize BPMN Modeler on component mount
  // useEffect(() => {
  // 	modelerRef.current = new BpmnModeler({
  // 		container: bpmnRef.current,
  // 		height: 600,
  // 		width: "100%",
  // 		keyboard: { bindTo: document },
  // 	});
  // 	updateBPMN();
  // 	return () => {
  // 		if (modelerRef.current) modelerRef.current.destroy();
  // 	};
  // }, []);

  // This hook initializes the modeler and loads the LLM diagram.
  useEffect(() => {
    if (!bpmnRef.current) {
      console.error("❌ BPMN container ref is not available");
      return;
    }

    // Destroy old modeler if it exists (handles StrictMode remount)
    if (modelerRef.current) {
      try {
        modelerRef.current.destroy();
      } catch (e) {
        // Ignore destroy errors from StrictMode
      }
      modelerRef.current = null;
    }

    // Initialize the BPMN Modeler on the CURRENT DOM node
    modelerRef.current = new BpmnModeler({
      container: bpmnRef.current,
      height: 600,
      width: "100%",
      keyboard: { bindTo: document },
    });

    console.log("✅ BPMN Modeler initialized");

    setTimeout(() => {
      console.log("🔄 Attempting to load BPMN diagram...");
      updateBPMN(true);
    }, 300);

    return () => {
      if (modelerRef.current) {
        try {
          modelerRef.current.destroy();
        } catch (e) {
          // Ignore
        }
        modelerRef.current = null;
      }
      isInitialMount.current = true; // Reset for StrictMode remount
    };
  }, []);

  // useEffect(() => {
  // 	updateBPMN();
  // }, [selectedModel, selectedDatasets, selectedFilters]);

  // This hook now runs ONLY AFTER the initial load, when you manually change a selection.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false; // The first render is finished, so we flip the flag
    } else {
      // It's now safe to update with static diagrams
      updateBPMN(false);
    }
  }, [selectedModel, selectedDatasets, selectedFilters]);

  const resetOutputs = () => {
    setOutputs([]);
    setComparisonResult(null);
    setDataSample(null);
  };

  const clearAllResults = () => {
    setAllPrettyTables([]);
    resetOutputs();
  };

  const handleModelSelect = (model) => {
    let updatedModels;
    if (selectedModel.includes(model)) {
      updatedModels = selectedModel.filter((m) => m !== model);
    } else {
      updatedModels = [...selectedModel, model];
    }
    setSelectedModel(updatedModels);
    resetOutputs();
  };

  const groupedOutputs = outputs.reduce((acc, curr) => {
    const { model } = curr;
    if (!acc[model]) acc[model] = [];
    acc[model].push(curr);
    return acc;
  }, {});

  const addFilterKey = (key) => {
    if (!key) return;
    if (
      selectedFilters.find((f) => f.key === key) ||
      selectedFilters.length >= 3
    )
      return;
    setSelectedFilters([...selectedFilters, { key, values: new Set() }]);
  };

  const removeFilterKey = (key) => {
    setSelectedFilters(selectedFilters.filter((f) => f.key !== key));
  };

  const toggleValue = (key, val) => {
    setSelectedFilters(
      selectedFilters.map((f) => {
        if (f.key !== key) return f;
        const v = new Set(f.values);
        v.has(val) ? v.delete(val) : v.add(val);
        return { ...f, values: v };
      }),
    );
  };

  const handleDatasetSelect = (dataset) => {
    let updatedDatasets;
    if (selectedDatasets.includes(dataset)) {
      updatedDatasets = selectedDatasets.filter((d) => d !== dataset);
    } else {
      updatedDatasets = [...selectedDatasets, dataset];
    }
    setSelectedDatasets(updatedDatasets);
    resetOutputs();
  };

  // Check if race comparison is available for selected datasets
  const isRaceComparisonAvailable = () => {
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("seer") || ds.toLowerCase().includes("usa"),
    );
  };

  // Check if menopausal status comparison is available
  const isMenoComparisonAvailable = () => {
    // Meno is available in German and Pakistani, NOT in SEER
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("german") ||
        ds.toLowerCase().includes("pakistan") ||
        ds.toLowerCase().includes("canadian"),
    );
  };

  // Auto-reset groupBy if it becomes invalid when datasets change
  useEffect(() => {
    if (!groupBy) return;

    // Check if current groupBy is still valid for selected datasets
    let isValid = false;

    switch (groupBy) {
      case "race":
        isValid = isRaceComparisonAvailable();
        break;
      case "meno":
        isValid = isMenoComparisonAvailable();
        break;
      case "nodes":
        isValid = isNodesComparisonAvailable();
        break;
      case "readmit_time":
      case "a1c_control":
      case "age_diabetes":
      case "race_diabetes":
        isValid = isUSDiabetesDatasetSelected();
        break;
      case "gender_sylhet":
      case "age_sylhet":
      case "obesity_sylhet":
        isValid = isSylhetDatasetSelected();
        break;
      case "age_pima":
      case "bmi_pima":
      case "glucose_pima":
        isValid = isPimaDatasetSelected();
        break;
      case "grade":
      case "er":
      case "pgr":
      case "age":
        isValid = selectedDatasets.length > 0 && !isDiabetesDatasetSelected();
        break;
      default:
        isValid = true;
    }

    // If invalid, reset to a valid default
    if (!isValid) {
      // Find first valid option
      if (
        isPimaDatasetSelected() &&
        !isUSDiabetesDatasetSelected() &&
        !isSylhetDatasetSelected()
      ) {
        setGroupBy("age_pima");
        console.log(
          "⚠️ Auto-reset groupBy from",
          groupBy,
          "to age_pima (Pima dataset selected)",
        );
      } else if (isSylhetDatasetSelected() && !isUSDiabetesDatasetSelected()) {
        setGroupBy("gender_sylhet");
        console.log(
          "⚠️ Auto-reset groupBy from",
          groupBy,
          "to gender_sylhet (Sylhet dataset selected)",
        );
      } else if (isDiabetesDatasetSelected()) {
        setGroupBy("readmit_time");
        console.log(
          "⚠️ Auto-reset groupBy from",
          groupBy,
          "to readmit_time (diabetes dataset selected)",
        );
      } else if (isRaceComparisonAvailable()) {
        setGroupBy("race");
        console.log(
          "⚠️ Auto-reset groupBy from",
          groupBy,
          "to race (invalid for current datasets)",
        );
      } else if (selectedDatasets.length > 0) {
        setGroupBy("grade"); // Grade works on all datasets
        console.log(
          "⚠️ Auto-reset groupBy from",
          groupBy,
          "to grade (invalid for current datasets)",
        );
      }
    }
  }, [selectedDatasets]); // Trigger when datasets change

  // Auto-reset groupByDataset2 when entering cross-diagnosis mode
  useEffect(() => {
    if (isCrossDiagnosisMode()) {
      let newG1 = groupBy;
      let newG2 = groupByDataset2;
      if (!["age_cross", "bmi_pima", "glucose_pima"].includes(newG1)) {
        newG1 = "age_cross";
      }
      if (!["age_cross", "gender_sylhet", "obesity_sylhet"].includes(newG2)) {
        newG2 = "age_cross";
      }
      // Enforce unified rule: age_cross must be on both or neither
      if (newG1 === "age_cross" && newG2 !== "age_cross") newG2 = "age_cross";
      if (newG2 === "age_cross" && newG1 !== "age_cross") newG1 = "age_cross";
      setGroupBy(newG1);
      setGroupByDataset2(newG2);
    }
  }, [selectedDatasets]);

  // Clear outputs when grouping changes in cross-diagnosis mode
  useEffect(() => {
    if (isCrossDiagnosisMode()) {
      resetOutputs();
    }
  }, [groupBy, groupByDataset2]);

  // Auto-deselect LSTM if Sylhet is the only diabetes dataset selected
  useEffect(() => {
    if (
      (isSylhetDatasetSelected() || isPimaDatasetSelected()) &&
      !selectedDatasets.some((ds) => ds.toLowerCase().includes("diabetic"))
    ) {
      const hasLSTM = selectedModel.some((m) =>
        m.toLowerCase().includes("lstm"),
      );
      if (hasLSTM) {
        setSelectedModel(
          selectedModel.filter((m) => !m.toLowerCase().includes("lstm")),
        );
        console.log(
          "⚠️ Auto-deselected LSTM (incompatible with Sylhet dataset)",
        );
      }
    }
  }, [selectedDatasets]);

  // Check if nodes comparison is available
  const isNodesComparisonAvailable = () => {
    // Nodes available in German and Pakistani, NOT in SEER
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("german") ||
        ds.toLowerCase().includes("pakistan") ||
        ds.toLowerCase().includes("canadian"),
    );
  };

  const isDiabetesDatasetSelected = () => {
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("diabetic") ||
        ds.toLowerCase().includes("diabetes") ||
        ds.toLowerCase().includes("sylhet") ||
        ds.toLowerCase().includes("bangladesh") ||
        ds.toLowerCase().includes("readmission"),
    );
  };

  const isSylhetDatasetSelected = () => {
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("sylhet") ||
        ds.toLowerCase().includes("bangladesh"),
    );
  };

  const isUSDiabetesDatasetSelected = () => {
    return selectedDatasets.some(
      (ds) =>
        ds.toLowerCase().includes("diabetic") ||
        ds.toLowerCase().includes("readmission"),
    );
  };

  const isBothDiabetesDatasetsSelected = () => {
    // Incompatible combos: UCI (readmission) with either diagnosis dataset
    return (
      isUSDiabetesDatasetSelected() &&
      (isSylhetDatasetSelected() || isPimaDatasetSelected())
    );
  };

  const isPimaDatasetSelected = () => {
    return selectedDatasets.some((ds) => ds.toLowerCase().includes("pima"));
  };

  const isCrossDiagnosisMode = () => {
    return (
      isPimaDatasetSelected() &&
      isSylhetDatasetSelected() &&
      !isUSDiabetesDatasetSelected()
    );
  };

  const isRaceSplitDatasetSelected = () => {
    return selectedDatasets.some((ds) =>
      ds.toLowerCase().includes("readmission"),
    );
  };

  const renderFilterWidgets = () => (
    <div className="wm-filter-section">
      <h3>Pick up to 3 filters (optional)</h3>

      {/* selector to add new filter */}
      <div className="wm-filter-adder">
        <select
          value=""
          onChange={(e) => {
            addFilterKey(e.target.value);
          }}
          disabled={selectedFilters.length >= 3}
        >
          <option value="" disabled>
            {selectedFilters.length >= 3
              ? "Max 3 filters reached"
              : "Add filter…"}
          </option>
          {filterKeysAvailable
            .filter((k) => !selectedFilters.find((f) => f.key === k))
            .filter((k) => {
              const uciDiabetesFilters = [
                "a1c_range",
                "num_medications",
                "time_in_hospital",
                "num_lab_procedures",
              ];
              const sylhetFilters = ["Gender", "Obesity", "age_range_sylhet"];
              const cancerFilters = [
                "grade",
                "age_range",
                "laterality_group",
                "ER_Status_BC_Group",
                "PR_Status_BC_Group",
                "marital_status_at_dx",
              ];
              const pimaFilters = [
                "age_range_pima",
                "glucose_range",
                "bmi_range",
              ];
              if (isBothDiabetesDatasetsSelected()) return false;
              if (isCrossDiagnosisMode()) return false;
              if (isRaceSplitDatasetSelected()) return false; // Filters disabled in cross-race comparison
              if (
                isPimaDatasetSelected() &&
                !isUSDiabetesDatasetSelected() &&
                !isSylhetDatasetSelected()
              )
                return pimaFilters.includes(k);
              if (
                isSylhetDatasetSelected() &&
                !isUSDiabetesDatasetSelected() &&
                !isPimaDatasetSelected()
              )
                return sylhetFilters.includes(k);
              if (
                isUSDiabetesDatasetSelected() &&
                !isSylhetDatasetSelected() &&
                !isPimaDatasetSelected()
              )
                return uciDiabetesFilters.includes(k);
              if (selectedDatasets.length === 0) return false;
              return cancerFilters.includes(k);
            })
            .map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
        </select>
      </div>

      {/* active filters */}
      <div className="wm-filter-grid">
        {selectedFilters.map(({ key, values }) => {
          const def = FILTER_DEFS[key];

          if (def.type === "categorical") {
            return (
              <div className="wm-filter-box" key={key}>
                <div className="wm-filter-head">
                  <span>{key}</span>
                  <button onClick={() => removeFilterKey(key)}>✕</button>
                </div>
                <div className="wm-filter-values">
                  {def.options.map((opt) => (
                    <div
                      key={opt}
                      className={`wm-filter-value ${
                        values.has(opt) ? "active" : ""
                      }`}
                      onClick={() => toggleValue(key, opt)}
                      title={opt}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const { min, max } = def;
          const allValues =
            key === "age_range" ||
            key === "age_range_sylhet" ||
            key === "age_range_pima"
              ? Array.from(
                  { length: Math.floor((max - min) / 10) + 1 },
                  (_, i) => min + i * 10,
                )
              : Array.from({ length: max - min + 1 }, (_, i) => min + i);
          return (
            <div className="wm-filter-box" key={key}>
              <div className="wm-filter-head">
                <span>
                  {key === "age_range_sylhet" || key === "age_range_pima"
                    ? "Age Range"
                    : key}
                </span>
                <button onClick={() => removeFilterKey(key)}>✕</button>
              </div>
              <div className="wm-filter-values">
                {allValues.map((n) => {
                  const displayValue =
                    key === "age_range" ||
                    key === "age_range_sylhet" ||
                    key === "age_range_pima"
                      ? `${n}-${n + 10}`
                      : n;
                  return (
                    <div
                      key={n}
                      className={`wm-filter-value ${
                        values.has(n) ? "active" : ""
                      }`}
                      onClick={() => toggleValue(key, n)}
                      title={
                        key === "age_range" ||
                        key === "age_range_sylhet" ||
                        key === "age_range_pima"
                          ? `${n}-${n + 10}`
                          : `${n}`
                      }
                    >
                      {displayValue}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const handleRunWorkflow = async () => {
    if (selectedModel.length === 0 || selectedDatasets.length === 0) {
      setError("Please select at least one model and one dataset.");
      return;
    }

    setError(null);
    setIsProcessing(true);
    resetOutputs();

    try {
      if (isCrossDiagnosisMode()) {
        // Cross-diagnosis mode: run each dataset separately with its own groupBy
        const pimaDataset = selectedDatasets.find((ds) =>
          ds.toLowerCase().includes("pima"),
        );
        const sylhetDataset = selectedDatasets.find(
          (ds) =>
            ds.toLowerCase().includes("sylhet") ||
            ds.toLowerCase().includes("bangladesh"),
        );

        const [pimaResponse, sylhetResponse] = await Promise.all([
          axios.post(`${process.env.REACT_APP_API_URL}/process-data`, {
            models: selectedModel,
            datasets: [pimaDataset],
            variables: ["age", "grade", "er", "pgr"],
            filters: "",
            groupBy: groupBy,
          }),
          axios.post(`${process.env.REACT_APP_API_URL}/process-data`, {
            models: selectedModel,
            datasets: [sylhetDataset],
            variables: ["age", "grade", "er", "pgr"],
            filters: "",
            groupBy: groupByDataset2,
          }),
        ]);

        const combinedOutputs = [
          ...pimaResponse.data.outputs,
          ...sylhetResponse.data.outputs,
        ];
        setOutputs(combinedOutputs);

        const newPrettyTables = combinedOutputs
          .map((outputObj) => {
            const parsed = parseOutput(outputObj.output);
            return parsed.prettyTable
              ? {
                  model: outputObj.model,
                  dataset:
                    outputObj.dataset ||
                    (outputObj.datasets ? outputObj.datasets.join(", ") : ""),
                  ...parsed.prettyTable,
                }
              : null;
          })
          .filter(Boolean);
        setAllPrettyTables((prev) => [...prev, ...newPrettyTables]);
        console.log("📊 Cross-diagnosis outputs:", combinedOutputs);
      } else {
        // Normal mode: single API call
        const response = await axios.post(
          `${process.env.REACT_APP_API_URL}/process-data`,
          {
            models: selectedModel,
            datasets: selectedDatasets,
            variables: ["age", "grade", "er", "pgr"],
            filters: filterString,
            groupBy: groupBy,
          },
        );
        setOutputs(response.data.outputs);
        const newPrettyTables = response.data.outputs
          .map((outputObj) => {
            const parsed = parseOutput(outputObj.output);
            return parsed.prettyTable
              ? {
                  model: outputObj.model,
                  dataset:
                    outputObj.dataset ||
                    (outputObj.datasets ? outputObj.datasets.join(", ") : ""),
                  ...parsed.prettyTable,
                }
              : null;
          })
          .filter(Boolean);
        setAllPrettyTables((prev) => [...prev, ...newPrettyTables]);
        console.log("Received outputs:", response.data.outputs);
        console.log("📊 About to parse outputs...");
      }
    } catch (err) {
      console.error("Error processing data:", err);
      const errorMsg = err.response?.data?.error || "Failed to process data.";
      const errorDetails = err.response?.data?.details || "";
      setError(`${errorMsg} ${errorDetails}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const compareOutputs = () => {
    if (outputs.length < 2) {
      setError("Please select at least two outputs to compare.");
      return;
    }
    const parsedOutputs = outputs.map((outputObj) =>
      parseOutput(outputObj.output),
    );
    console.log("📊 All parsed outputs:", parsedOutputs);

    const isCoxModel = selectedModel.some((model) =>
      model.toLowerCase().includes("cox"),
    );

    // Cross-race comparison: compare per-race metrics across models
    const isCrossRace = parsedOutputs.every((p) => p && p.cross_race);
    if (isCrossRace) {
      const allRaces = new Set();
      parsedOutputs.forEach((p) =>
        p.race_metrics?.forEach((r) => allRaces.add(r.race)),
      );

      const comparisonTable = (
        <table className="wm-comparison-table">
          <thead>
            <tr>
              <th>Race</th>
              {outputs.map((o, i) => (
                <th key={i} colSpan={2}>
                  {displayName(o.model)}
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {outputs.map((_, i) => (
                <React.Fragment key={i}>
                  <th>Accuracy</th>
                  <th>AUC</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...allRaces].map((race) => (
              <tr key={race}>
                <td>
                  <strong>{race}</strong>
                </td>
                {parsedOutputs.map((p, i) => {
                  const rm = p.race_metrics?.find((r) => r.race === race);
                  return (
                    <React.Fragment key={i}>
                      <td>
                        {rm ? (rm.accuracy * 100).toFixed(2) + "%" : "N/A"}
                      </td>
                      <td>{rm ? rm.auc?.toFixed(4) || "N/A" : "N/A"}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
      setComparisonResult(comparisonTable);
      return;
    }

    if (isCoxModel) {
      const comparisonData = outputs.map((outputObj, index) => ({
        model: outputObj.model,
        dataset: outputObj.dataset,
        results: parsedOutputs[index].coxResults || [],
      }));
      const allVariables = new Set();
      comparisonData.forEach((data) => {
        data.results.forEach((variableResult) => {
          allVariables.add(variableResult.Variable);
        });
      });
      const comparisonTable = (
        <table className="wm-comparison-table">
          <thead>
            <tr>
              <th>Variable</th>
              {comparisonData.map((data, index) => (
                <th key={index}>{`${data.model} - ${data.dataset}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...allVariables].map((variable) => (
              <tr key={variable}>
                <td>{variable}</td>
                {comparisonData.map((data, index) => {
                  const varResult = data.results.find(
                    (v) => v.Variable === variable,
                  );
                  return (
                    <td key={`${variable}-${index}`}>
                      {varResult
                        ? `Coef: ${varResult.coef}\nP-value: ${varResult.p}`
                        : "N/A"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
      setComparisonResult(comparisonTable);
    } else {
      const metricsToCompare = ["accuracy", "macro avg", "weighted avg"];
      const comparisonData = outputs.map((outputObj, index) => {
        const metrics = parsedOutputs[index].metrics || {};
        return { model: outputObj.model, dataset: outputObj.dataset, metrics };
      });
      const comparisonTable = (
        <table className="wm-comparison-table">
          <thead>
            <tr>
              <th>Metric</th>
              {comparisonData.map((data, index) => (
                <th key={index}>{`${data.model} - ${data.dataset}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricsToCompare.map((metric) => (
              <tr key={metric}>
                <td>{metric}</td>
                {comparisonData.map((data, index) => {
                  const metricData = data.metrics[metric] || {};
                  return (
                    <td key={index}>
                      {`Precision: ${metricData.precision || "N/A"}\nRecall: ${
                        metricData.recall || "N/A"
                      }\nF1-Score: ${metricData.f1Score || "N/A"}\nSupport: ${
                        metricData.support || "N/A"
                      }`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
      setComparisonResult(comparisonTable);
    }
  };

  // In hugging/src/components/WorkflowManipulation.js

  // const updateBPMN = async () => {
  // 	// --- START: THE FIX ---
  // 	// 1. Check if an LLM-generated diagram exists in localStorage
  // 	const llmGeneratedXml = localStorage.getItem('llmGeneratedBpmnXml');

  // 	if (llmGeneratedXml) {
  // 		console.log("✅ Found LLM-generated BPMN. Displaying it now.");
  // 		try {
  // 			// Use the XML directly from localStorage
  // 			await modelerRef.current.importXML(llmGeneratedXml);
  // 			modelerRef.current.get("canvas").zoom("fit-viewport");
  // 			setError(null);

  // 			// IMPORTANT: Clear the diagram from storage after using it
  // 			// so it doesn't show up again later by mistake.
  // 			localStorage.removeItem('llmGeneratedBpmnXml');
  // 			return; // Exit the function to prevent loading a static file
  // 		} catch (err) {
  // 			console.error("Error importing LLM-generated BPMN:", err);
  // 			setError("Failed to load the generated BPMN diagram.");
  // 			localStorage.removeItem('llmGeneratedBpmnXml'); // Also clear on error
  // 		}
  // 	}
  // 	// --- END: THE FIX ---

  // 	// --- FALLBACK: Keep the old logic for when no LLM diagram is available ---
  // 	console.log("🟡 No LLM-generated BPMN found. Loading a static diagram based on selections.");
  // 	let diagramPath;
  // 	const modelCount = selectedModel.length;
  // 	const datasetCount = selectedDatasets.length;
  // 	const isFilter = selectedFilters.length > 0; // Simplified check

  // 	if (modelCount === 0 && datasetCount === 0) {
  // 		diagramPath = "/default_diagram.xml";
  // 	} else if (modelCount === 1 && datasetCount === 1) {
  // 		diagramPath = isFilter ? "/single_model_and_single_dataset_with_filter.xml" : "/single_model_and_single_dataset.xml";
  // 	} else if (modelCount === 1 && datasetCount > 1) {
  // 		diagramPath = isFilter ? "/single_model_and_multiple_datasets_with_filter.xml" : "/single_model_and_multiple_datasets.xml";
  // 	} else if (modelCount > 1 && datasetCount === 1) {
  // 		diagramPath = isFilter ? "/multiple_models_and_single_dataset_with_filter.xml" : "/multiple_models_and_single_dataset.xml";
  // 	} else if (modelCount > 1 && datasetCount > 1) {
  // 		diagramPath = isFilter ? "/multiple_models_and_multiple_datasets_with_filter.xml" : "/multiple_models_and_multiple_datasets.xml";
  // 	} else {
  // 		diagramPath = "/default_diagram.xml";
  // 	}

  // 	console.log("Loading static diagram:", diagramPath);

  // 	try {
  // 		const response = await fetch(diagramPath);
  // 		if (!response.ok)
  // 			throw new Error(`HTTP error! status: ${response.status}`);
  // 		const xml = await response.text();
  // 		await modelerRef.current.importXML(xml);
  // 		modelerRef.current.get("canvas").zoom("fit-viewport");
  // 		setError(null);
  // 	} catch (err) {
  // 		console.error("Error updating BPMN diagram:", err);
  // 		setError("Failed to update BPMN diagram.");
  // 	}
  // };

  const updateBPMN = async (isInitialLoad = false) => {
    console.log(`📊 updateBPMN called with isInitialLoad=${isInitialLoad}`);

    // Check if modeler is initialized
    if (!modelerRef.current) {
      console.error("❌ BPMN Modeler is not initialized");
      setError("BPMN Modeler not initialized");
      return;
    }

    // Only check for the LLM diagram on the very first load
    if (isInitialLoad) {
      const llmGeneratedXml = localStorage.getItem("llmGeneratedBpmnXml");
      console.log(
        `🔍 Looking for LLM diagram in localStorage: ${llmGeneratedXml ? "FOUND" : "NOT FOUND"}`,
      );

      if (llmGeneratedXml) {
        console.log("✅ Found LLM-generated BPMN. Displaying it now.");
        console.log(
          "📄 BPMN XML length:",
          llmGeneratedXml.length,
          "characters",
        );
        try {
          // Replace raw filenames with display names in BPMN task labels
          let cleanedXml = llmGeneratedXml;
          Object.entries(DISPLAY_NAMES).forEach(([filename, display]) => {
            const nameNoExt = filename.replace(/\.(py|csv)$/, "");
            const nameNoVersion = nameNoExt.replace(/@\d+$/, "");
            cleanedXml = cleanedXml.replaceAll(filename, display);
            cleanedXml = cleanedXml.replaceAll(nameNoExt, display);
            if (nameNoVersion !== nameNoExt) {
              cleanedXml = cleanedXml.replaceAll(nameNoVersion, display);
            }
          });
          await modelerRef.current.importXML(cleanedXml);
          console.log("✅ Successfully imported LLM-generated BPMN");
          modelerRef.current.get("canvas").zoom("fit-viewport");
          setError(null);
          setTimeout(() => {
            localStorage.removeItem("llmGeneratedBpmnXml");
            console.log("🧹 Cleaned up localStorage");
          }, 2000);
          return; // Exit to prevent the fallback logic from running
        } catch (err) {
          console.error("❌ Error importing LLM-generated BPMN:", err);
          console.error("Error details:", err.message);
          console.error("Error stack:", err.stack);
          setError(`Failed to load the generated BPMN diagram: ${err.message}`);
          localStorage.removeItem("llmGeneratedBpmnXml");
        }
      } else {
        console.log("⚠️ No LLM-generated BPMN found in localStorage");
      }
    }

    // --- FALLBACK LOGIC (your original code) ---
    console.log(
      "🟡 No LLM-generated BPMN found. Loading a static diagram based on selections.",
    );
    let diagramPath;
    const modelCount = selectedModel.length;
    const datasetCount = selectedDatasets.length;
    const isFilter = selectedFilters.length > 0;

    if (modelCount === 0 && datasetCount === 0) {
      diagramPath = "/default_diagram.xml";
    } else if (modelCount === 1 && datasetCount === 1) {
      diagramPath = isFilter
        ? "/single_model_and_single_dataset_with_filter.xml"
        : "/single_model_and_single_dataset.xml";
    } else if (modelCount === 1 && datasetCount > 1) {
      diagramPath = isFilter
        ? "/single_model_and_multiple_datasets_with_filter.xml"
        : "/single_model_and_multiple_datasets.xml";
    } else if (modelCount > 1 && datasetCount === 1) {
      diagramPath = isFilter
        ? "/multiple_models_and_single_dataset_with_filter.xml"
        : "/multiple_models_and_single_dataset.xml";
    } else if (modelCount > 1 && datasetCount > 1) {
      diagramPath = isFilter
        ? "/multiple_models_and_multiple_datasets_with_filter.xml"
        : "/multiple_models_and_multiple_datasets.xml";
    } else {
      diagramPath = "/default_diagram.xml";
    }

    console.log(
      "🟡 No LLM-generated BPMN found. Loading a static diagram based on selections.",
    );

    try {
      const response = await fetch(diagramPath);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      let xml = await response.text();

      // Replace static placeholder names with actual selections + display names
      const datasetNames = selectedDatasets.map((d) => displayName(d));
      const modelNames = selectedModel.map((m) => displayName(m));

      // Replace generic placeholders in static XML
      xml = xml.replace(
        /SEER_Cancer_Registry_of_USA\.csv/g,
        datasetNames[0] || "Dataset 1",
      );
      xml = xml.replace(
        /German_Cancer_registry@2020\.csv/g,
        datasetNames[1] || "Dataset 2",
      );
      xml = xml.replace(
        /National_Cancer_Registry_of_Pakistan\.csv/g,
        datasetNames[2] || "Dataset 3",
      );
      xml = xml.replace(
        /cox_model@2020\.py\/kaplan_meier_model@2020\.py/g,
        modelNames.join(" / ") || "Model",
      );
      xml = xml.replace(/cox_model@2020\.py/g, modelNames[0] || "Model 1");
      xml = xml.replace(
        /kaplan_meier_model@2020\.py/g,
        modelNames[1] || "Model 2",
      );

      // Also apply general DISPLAY_NAMES cleanup for any remaining raw filenames
      Object.entries(DISPLAY_NAMES).forEach(([filename, display]) => {
        const nameNoExt = filename.replace(/\.(py|csv)$/, "");
        const nameNoVersion = nameNoExt.replace(/@\d+$/, "");
        xml = xml.replaceAll(filename, display);
        xml = xml.replaceAll(nameNoExt, display);
        if (nameNoVersion !== nameNoExt) {
          xml = xml.replaceAll(nameNoVersion, display);
        }
      });

      await modelerRef.current.importXML(xml);
      modelerRef.current.get("canvas").zoom("fit-viewport");
      setError(null);
    } catch (err) {
      console.error("Error updating BPMN diagram:", err);
      setError("Failed to update BPMN diagram.");
    }
  };

  return (
    <Layout>
      <div className="wm-container">
        <h2>Workflow Manipulation</h2>
        <div className="wm-bpmn-section">
          <h3>Workflow Diagram</h3>
          <div className="wm-bpmn-container" ref={bpmnRef}></div>
        </div>
        <div className="wm-main-section">
          <div className="wm-selection-section">
            <div className="wm-models">
              <h3>Select a Model</h3>
              <div className="wm-boxes">
                {availableModels.map((model, index) => {
                  const isLSTM = model.toLowerCase().includes("lstm");
                  const disabled =
                    isLSTM &&
                    (isSylhetDatasetSelected() || isPimaDatasetSelected());
                  return (
                    <div
                      key={index}
                      className={`wm-box ${selectedModel.includes(model) ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                      onClick={() => !disabled && handleModelSelect(model)}
                      title={
                        disabled
                          ? "LSTM requires sequential encounter data (not available in Sylhet dataset)"
                          : displayName(model)
                      }
                    >
                      <p>{displayName(model)}</p>
                      {disabled && (
                        <span style={{ fontSize: "0.7em", color: "#999" }}>
                          Requires sequential encounter data
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="wm-datasets">
              <h3>Select Datasets</h3>
              <div className="wm-boxes">
                {availableDatasets.map((dataset, index) => (
                  <div
                    key={index}
                    className={`wm-box ${selectedDatasets.includes(dataset) ? "selected" : ""}`}
                    onClick={() => handleDatasetSelect(dataset)}
                    title={dataset}
                  >
                    <p>{displayName(dataset)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!isRaceSplitDatasetSelected() && (
            <>
              {renderFilterWidgets()}

              <div
                className="wm-group-section"
                style={{ marginTop: "20px", marginBottom: "20px" }}
              >
                {isCrossDiagnosisMode() ? (
                  <>
                    <div style={{ marginBottom: "10px" }}>
                      <label
                        style={{ fontWeight: "bold", marginRight: "10px" }}
                      >
                        📊 Pima Indians (USA) — Group By:
                      </label>
                      <select
                        value={groupBy}
                        onChange={(e) => {
                          setGroupBy(e.target.value);
                          if (e.target.value === "age_cross")
                            setGroupByDataset2("age_cross");
                          else if (groupByDataset2 === "age_cross")
                            setGroupByDataset2("gender_sylhet");
                        }}
                        style={{
                          padding: "8px",
                          fontSize: "14px",
                          minWidth: "250px",
                        }}
                      >
                        <option value="age_cross">
                          Age — Unified (&lt;35 vs 35-50 vs &gt;50)
                        </option>
                        <option value="bmi_pima">
                          BMI (Normal vs Overweight vs Obese)
                        </option>
                        <option value="glucose_pima">
                          Glucose (Normal vs Prediabetic vs Diabetic)
                        </option>
                      </select>
                    </div>
                    <div>
                      <label
                        style={{ fontWeight: "bold", marginRight: "10px" }}
                      >
                        📊 Sylhet Hospital (Bangladesh) — Group By:
                      </label>
                      <select
                        value={groupByDataset2}
                        onChange={(e) => {
                          setGroupByDataset2(e.target.value);
                          if (e.target.value === "age_cross")
                            setGroupBy("age_cross");
                          else if (groupBy === "age_cross")
                            setGroupBy("bmi_pima");
                        }}
                        style={{
                          padding: "8px",
                          fontSize: "14px",
                          minWidth: "250px",
                        }}
                      >
                        <option value="age_cross">
                          Age — Unified (&lt;35 vs 35-50 vs &gt;50)
                        </option>
                        <option value="gender_sylhet">
                          Gender (Male vs Female)
                        </option>
                        <option value="obesity_sylhet">
                          Obesity (Yes vs No)
                        </option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ fontWeight: "bold", marginRight: "10px" }}>
                      Group Comparison:
                    </label>
                    <select
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value)}
                      disabled={selectedDatasets.length === 0}
                      style={{
                        padding: "8px",
                        fontSize: "14px",
                        minWidth: "250px",
                      }}
                    >
                      {/* Cancer dataset options */}
                      <option
                        value="meno"
                        disabled={
                          isDiabetesDatasetSelected() ||
                          !isMenoComparisonAvailable()
                        }
                      >
                        Menopausal Status (Pre vs Post){" "}
                        {isDiabetesDatasetSelected()
                          ? "(Cancer only)"
                          : !isMenoComparisonAvailable()
                            ? "(Requires German/Pakistani dataset)"
                            : ""}
                      </option>
                      <option
                        value="grade"
                        disabled={isDiabetesDatasetSelected()}
                      >
                        Tumor Grade (Low-Moderate vs High){" "}
                        {isDiabetesDatasetSelected() && "(Cancer only)"}
                      </option>
                      <option
                        value="age"
                        disabled={isDiabetesDatasetSelected()}
                      >
                        Age (&lt;50 vs ≥50){" "}
                        {isDiabetesDatasetSelected() && "(Cancer only)"}
                      </option>
                      <option value="er" disabled={isDiabetesDatasetSelected()}>
                        ER Status (Negative vs Positive){" "}
                        {isDiabetesDatasetSelected() && "(Cancer only)"}
                      </option>
                      <option
                        value="pgr"
                        disabled={isDiabetesDatasetSelected()}
                      >
                        PR Status (Negative vs Positive){" "}
                        {isDiabetesDatasetSelected() && "(Cancer only)"}
                      </option>
                      <option
                        value="nodes"
                        disabled={
                          isDiabetesDatasetSelected() ||
                          !isNodesComparisonAvailable()
                        }
                      >
                        Lymph Nodes (None vs Involved){" "}
                        {isDiabetesDatasetSelected()
                          ? "(Cancer only)"
                          : !isNodesComparisonAvailable()
                            ? "(Requires German/Pakistani dataset)"
                            : ""}
                      </option>
                      <option
                        value="race"
                        disabled={
                          isDiabetesDatasetSelected() ||
                          !isRaceComparisonAvailable()
                        }
                      >
                        Race (All 5 groups){" "}
                        {isDiabetesDatasetSelected()
                          ? "(Cancer only)"
                          : !isRaceComparisonAvailable()
                            ? "(Requires SEER dataset)"
                            : ""}
                      </option>

                      {/* US Diabetes dataset options */}
                      <option
                        value="readmit_time"
                        disabled={!isUSDiabetesDatasetSelected()}
                      >
                        Readmission Timing (&lt;30 vs &gt;30 vs NO){" "}
                        {!isUSDiabetesDatasetSelected() &&
                          "(Requires UCI diabetic dataset)"}
                      </option>
                      <option
                        value="a1c_control"
                        disabled={!isUSDiabetesDatasetSelected()}
                      >
                        A1C Control (Normal vs &gt;7 vs &gt;8){" "}
                        {!isUSDiabetesDatasetSelected() &&
                          "(Requires UCI diabetic dataset)"}
                      </option>
                      <option
                        value="age_diabetes"
                        disabled={!isUSDiabetesDatasetSelected()}
                      >
                        Age Groups (&lt;50 vs 50-70 vs ≥70){" "}
                        {!isUSDiabetesDatasetSelected() &&
                          "(Requires UCI diabetic dataset)"}
                      </option>
                      <option
                        value="race_diabetes"
                        disabled={!isUSDiabetesDatasetSelected()}
                      >
                        Race (Diabetes cohort){" "}
                        {!isUSDiabetesDatasetSelected() &&
                          "(Requires UCI diabetic dataset)"}
                      </option>

                      {/* Sylhet Bangladesh dataset options */}
                      <option
                        value="gender_sylhet"
                        disabled={!isSylhetDatasetSelected()}
                      >
                        Gender (Male vs Female){" "}
                        {!isSylhetDatasetSelected() &&
                          "(Requires Sylhet dataset)"}
                      </option>
                      <option
                        value="age_sylhet"
                        disabled={!isSylhetDatasetSelected()}
                      >
                        Age (&lt;40 vs 40-55 vs ≥55){" "}
                        {!isSylhetDatasetSelected() &&
                          "(Requires Sylhet dataset)"}
                      </option>
                      <option
                        value="obesity_sylhet"
                        disabled={!isSylhetDatasetSelected()}
                      >
                        Obesity (Yes vs No){" "}
                        {!isSylhetDatasetSelected() &&
                          "(Requires Sylhet dataset)"}
                      </option>

                      {/* Pima Indians USA dataset options */}
                      <option
                        value="age_pima"
                        disabled={!isPimaDatasetSelected()}
                      >
                        Age (&lt;30 vs 30-45 vs &gt;45){" "}
                        {!isPimaDatasetSelected() && "(Requires Pima dataset)"}
                      </option>
                      <option
                        value="bmi_pima"
                        disabled={!isPimaDatasetSelected()}
                      >
                        BMI (Normal vs Overweight vs Obese){" "}
                        {!isPimaDatasetSelected() && "(Requires Pima dataset)"}
                      </option>
                      <option
                        value="glucose_pima"
                        disabled={!isPimaDatasetSelected()}
                      >
                        Glucose (Normal vs Prediabetic vs Diabetic){" "}
                        {!isPimaDatasetSelected() && "(Requires Pima dataset)"}
                      </option>
                    </select>
                  </>
                )}
              </div>
            </>
          )}

          <div className="wm-button-group">
            <button
              className="wm-run-button"
              onClick={handleRunWorkflow}
              disabled={isProcessing || isBothDiabetesDatasetsSelected()}
            >
              {isProcessing
                ? "Running..."
                : isBothDiabetesDatasetsSelected()
                  ? "Cannot run readmission + diagnosis datasets together"
                  : isCrossDiagnosisMode()
                    ? "Run Cross-Dataset Comparison"
                    : "Run Workflow"}
            </button>
          </div>

          {error && (
            <p className="wm-notification-message wm-error-message">{error}</p>
          )}

          {outputs.length > 0 && (
            <div className="wm-output-section">
              <h3>Processing Outputs:</h3>

              {/* 1. Main Output Loop using Helper Component */}
              {Object.keys(groupedOutputs).map((modelName, mIdx) => (
                <div key={mIdx} className="wm-model-output">
                  <h2>{displayName(modelName)}</h2>
                  {isCrossDiagnosisMode() &&
                    groupBy === "age_cross" &&
                    groupByDataset2 === "age_cross" &&
                    groupedOutputs[modelName].length >= 2 && (
                      <>
                        <h4>Cross-Dataset Age Comparison</h4>
                        <CrossDatasetChart
                          modelOutputs={groupedOutputs[modelName]}
                        />
                      </>
                    )}
                  {groupedOutputs[modelName].map((outputObj, idx) => {
                    const hideImage =
                      isCrossDiagnosisMode() &&
                      groupBy === "age_cross" &&
                      groupByDataset2 === "age_cross";
                    return (
                      <SingleOutputRenderer
                        key={idx}
                        outputObj={{ ...outputObj, _hideImage: hideImage }}
                      />
                    );
                  })}
                </div>
              ))}

              {/* 2. Pretty Table Section */}
              {allPrettyTables.length > 0 &&
                (() => {
                  const hasClassification = allPrettyTables.some(
                    (t) => t.accuracy != null,
                  );
                  const hasSurvival = allPrettyTables.some(
                    (t) => t.coef && t.coef !== "N/A",
                  );
                  return (
                    <div className="wm-pretty-table">
                      <h5>Model Table Outputs (All Runs):</h5>
                      <div className="wm-table-container">
                        <table className="wm-table wm-cox-pretty-table">
                          <thead>
                            <tr>
                              <th>Model</th>
                              <th>Dataset</th>
                              <th>Filter1</th>
                              <th>Filter2</th>
                              <th>Filter3</th>
                              <th>Groups Compared</th>
                              {hasClassification && <th>Accuracy</th>}
                              {hasClassification && <th>AUC</th>}
                              {!hasClassification && <th>coef</th>}
                              {!hasClassification && <th>HR</th>}
                              {!hasClassification && <th>p</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {allPrettyTables.map((table, idx) => (
                              <tr key={idx}>
                                <td>{displayName(table.model)}</td>
                                <td>{displayName(table.dataset)}</td>
                                <td>{table.Filter1 || ""}</td>
                                <td>{table.Filter2 || ""}</td>
                                <td>{table.Filter3 || ""}</td>
                                <td>{table["Groups Compared"] || "N/A"}</td>
                                {hasClassification && (
                                  <td>
                                    {table.accuracy != null
                                      ? (table.accuracy * 100).toFixed(2) + "%"
                                      : "N/A"}
                                  </td>
                                )}
                                {hasClassification && (
                                  <td>
                                    {table.auc != null
                                      ? table.auc.toFixed(4)
                                      : "N/A"}
                                  </td>
                                )}
                                {!hasClassification && (
                                  <td>{table.coef || ""}</td>
                                )}
                                {!hasClassification && (
                                  <td>{table.HR || ""}</td>
                                )}
                                {!hasClassification && <td>{table.p || ""}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="wm-table-footer">
                        <button
                          className="wm-clear-button"
                          onClick={clearAllResults}
                          title="Clear all previous results"
                        >
                          ✕ Clear Results
                        </button>
                      </div>
                    </div>
                  );
                })()}

              {/* 3. Data Sample Section */}
              {dataSample && (
                <div className="wm-data-sample">
                  <h3>Data Sample:</h3>
                  <div className="wm-table-container">
                    <table className="wm-table wm-data-sample-table">
                      <thead>
                        <tr>
                          {Object.keys(dataSample[0]).map((key, i) => (
                            <th key={i}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataSample.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {Object.values(row).map((val, cIdx) => (
                              <td key={cIdx}>{val}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 4. Comparison Section */}
              {outputs.length >= 2 && (
                <button className="wm-compare-button" onClick={compareOutputs}>
                  Compare Outputs
                </button>
              )}

              {comparisonResult && (
                <div className="wm-comparison-section">
                  <h3>Comparison Results:</h3>
                  <div className="wm-comparison-container">
                    <div className="wm-table-container">{comparisonResult}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default WorkflowManipulation;
