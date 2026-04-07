import React, { useState } from "react";
import axios from "axios";
import "../styles/llmpage.css";
import Layout from "./Layout";

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

const LLMPage = () => {
  const [prompt, setPrompt] = useState("");
  const [llmSelectedDatasets, setllmSelectedDatasets] = useState([]);
  const [llmSelectedModels, setllmSelectedModels] = useState([]);
  const [llmGenerated, setllmGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handlePromptSubmit = async () => {
    console.log(prompt);
    setErrorMessage(""); // Clear previous errors
    const token = "secret_key";

    try {
      setLoading(true);

      // ONLY ONE API CALL is needed
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/llm/rag`, // RAG endpoint
        {
          userInput: prompt,
          selectedDatasets: llmSelectedDatasets || [],
          selectedModels: llmSelectedModels || [],
        },
        {
          headers: {
            Authorization: token,
          },
        },
      );

      // Check if the response is successful and contains the data we need
      if (response.data && response.data.success) {
        console.log("✅ RAG Response:", response.data);

        const { validation, response: geminiResponse } = response.data;

        // Save the recommended datasets and models
        setllmSelectedDatasets(validation.datasets);
        setllmSelectedModels(validation.models);

        // CRITICAL FIX: Save to localStorage so WorkflowManipulation can access them
        localStorage.setItem(
          "llmSelectedDatasets",
          JSON.stringify(validation.datasets),
        );
        localStorage.setItem(
          "llmSelectedModels",
          JSON.stringify(validation.models),
        );

        setllmGenerated(true);
        console.log(
          "llmGenerated set to true, datasets:",
          validation.datasets,
          "models:",
          validation.models,
        );

        // Extract and save the BPMN XML diagram
        let responseText = "";

        if (typeof geminiResponse === "string") {
          responseText = geminiResponse;
        } else if (geminiResponse && geminiResponse.content) {
          responseText = geminiResponse.content;
        } else if (geminiResponse && typeof geminiResponse === "object") {
          responseText = JSON.stringify(geminiResponse);
        }

        console.log("📄 Response text length:", responseText.length);
        console.log(
          "📄 Response text preview:",
          responseText.substring(0, 200),
        );

        const bpmnRegex = /(<bpmn:definitions[\s\S]*?<\/bpmn:definitions>)/;
        const match = responseText.match(bpmnRegex);

        if (match && match[1]) {
          const extractedBpmnXml = match[1];
          localStorage.setItem("llmGeneratedBpmnXml", extractedBpmnXml);
          console.log("✅ BPMN diagram found and saved to localStorage.");
          console.log("📊 BPMN XML length:", extractedBpmnXml.length);
        } else {
          localStorage.removeItem("llmGeneratedBpmnXml");
          console.log("🟡 No BPMN diagram found in response.");
        }
      } else if (response.data && !response.data.success) {
        // Handle errors
        setErrorMessage(response.data.error);
        setllmGenerated(true);
        if (response.data.recommended_datasets) {
          setllmSelectedDatasets(response.data.recommended_datasets);
          setllmSelectedModels(response.data.recommended_models);

          // Save to localStorage even in error case
          localStorage.setItem(
            "llmSelectedDatasets",
            JSON.stringify(response.data.recommended_datasets),
          );
          localStorage.setItem(
            "llmSelectedModels",
            JSON.stringify(response.data.recommended_models),
          );
        }
      }
    } catch (error) {
      console.error("Error sending prompt:", error);
      localStorage.removeItem("llmGeneratedBpmnXml"); // Clear on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="llm-LLMPageContainer">
        {/* ChatGPT-like interface */}
        <div className="llm-chat-container">
          <div className="llm-chat-header">
            <h2>ChatGPT LLM Interface</h2>
          </div>
          <div className="llm-chat-content">
            {/* Display messages */}
            {prompt && (
              <div className="llm-chat-message llm-user-message">
                <div className="llm-message-content">{prompt}</div>
              </div>
            )}
            {loading && (
              <div className="llm-chat-message llm-bot-message">
                <div className="llm-message-content">
                  {/* Show loading animation */}
                  <div className="llm-loader"></div>
                </div>
              </div>
            )}
            {llmGenerated && (
              <div className="llm-chat-message llm-bot-message">
                <div className="llm-message-content">
                  <p>
                    <strong>Recommended Datasets:</strong>
                  </p>
                  {llmSelectedDatasets.length > 0 ? (
                    llmSelectedDatasets.map((dataset, index) => (
                      <li key={index}>{displayName(dataset)}</li>
                    ))
                  ) : (
                    <p style={{ color: "#666", fontStyle: "italic" }}>
                      ⚠️ No datasets available for this query domain
                    </p>
                  )}

                  <p>
                    <strong>Recommended Models:</strong>
                  </p>
                  {llmSelectedModels.length > 0 ? (
                    llmSelectedModels.map((model, index) => (
                      <li key={index}>{displayName(model)}</li>
                    ))
                  ) : (
                    <p style={{ color: "#666", fontStyle: "italic" }}>
                      ℹ️ No models available for this query domain
                    </p>
                  )}

                  {errorMessage && (
                    <div
                      style={{
                        marginTop: "20px",
                        padding: "15px",
                        backgroundColor: "#fff3cd",
                        borderRadius: "8px",
                      }}
                    >
                      <p style={{ color: "#856404", margin: 0 }}>
                        ⚠️ {errorMessage}
                      </p>
                    </div>
                  )}

                  {llmSelectedDatasets.length === 0 &&
                    llmSelectedModels.length === 0 && (
                      <p
                        style={{
                          marginTop: "20px",
                          padding: "15px",
                          backgroundColor: "#fff3cd",
                          borderRadius: "8px",
                        }}
                      >
                        💡 <strong>Tip:</strong> Try a query related to cancer
                        or diabetes research, as those are the available domains
                        in the system.
                      </p>
                    )}

                  {(llmSelectedDatasets.length > 0 ||
                    llmSelectedModels.length > 0) &&
                    !errorMessage && (
                      <a
                        href="/workflow"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-block", marginTop: "15px" }}
                      >
                        <button className="llm-view-workflow-button">
                          Verify & Run Workflow
                        </button>
                      </a>
                    )}
                </div>
              </div>
            )}
          </div>
          <div className="llm-chat-input">
            <textarea
              placeholder="Enter your workflow..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              type="button" // Added type="button" to prevent form submission
              onClick={handlePromptSubmit}
              disabled={loading || !prompt.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default LLMPage;
