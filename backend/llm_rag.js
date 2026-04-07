const axios = require("axios");
const { getChatGPTResponse } = require("./llm");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { validateBPMN } = require("./bpmnValidator");
const BPMNSaver = require("./bpmnSaver");
const bpmnSaver = new BPMNSaver();
const BPMNCorrector = require("./bpmnCorrector");
const { validateWorkflow, applySuggestedFixes } = require("./validator");
const { runCompleteVerification } = require("./verifier_llm");

// ====================================================================
// MODEL-DATASET COMPATIBILITY MAPPINGS
// ====================================================================

const MODEL_COMPATIBILITY = {
  "cox_model@2020.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
    ],
    domain: ["cancer-research", "Cardiology"],
    description: "Cox Proportional Hazards for survival analysis",
  },
  "kaplan_meier_model@2020.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
    ],
    domain: ["cancer-research", "Cardiology"],
    description: "Kaplan-Meier survival curves",
  },
  "google_Health_Cancer_Prediction_Model.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
    ],
    domain: ["cancer-research"],
    description: "Logistic regression for cancer prediction",
  },
  "xgboost_risk_model@2025.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
      "diabetic_data.csv",
      "UCI_AfricanAmerican_Readmission.csv",
      "UCI_Caucasian_Readmission.csv",
      "UCI_Hispanic_Readmission.csv",
      "UCI_Asian_Readmission.csv",
      "Sylhet_Diabetes_Hospital_Bangladesh.csv",
      "Pima_Indians_Diabetes_USA.csv",
    ],
    domain: ["cancer-research", "cardiology", "diabetes-research"],
    description:
      "XGBoost-based risk stratification and readmission classification",
  },
  "random_survival_forest@2025.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
      "diabetic_data.csv",
      "Sylhet_Diabetes_Hospital_Bangladesh.csv",
      "Pima_Indians_Diabetes_USA.csv",
    ],
    domain: ["cancer-research", "cardiology", "diabetes-research"],
    description:
      "Random Forest for survival analysis and readmission classification",
  },
  "mlp_cancer_classifier@2025.py": {
    compatible_datasets: [
      "SEER_Cancer_Registry_of_USA.csv",
      "German_Cancer_registry@2020.csv",
      "National_Cancer_Registry_of_Pakistan.csv",
      "diabetic_data.csv",
      "UCI_AfricanAmerican_Readmission.csv",
      "UCI_Caucasian_Readmission.csv",
      "UCI_Hispanic_Readmission.csv",
      "UCI_Asian_Readmission.csv",
      "Sylhet_Diabetes_Hospital_Bangladesh.csv",
      "Pima_Indians_Diabetes_USA.csv",
    ],
    domain: ["cancer-research", "diabetes-research"],
    description:
      "MLP neural network for cancer survival and readmission classification",
  },
  "lstm_readmission_model@2026.py": {
    compatible_datasets: [
      "diabetic_data.csv",
      "UCI_AfricanAmerican_Readmission.csv",
      "UCI_Caucasian_Readmission.csv",
      "UCI_Hispanic_Readmission.csv",
      "UCI_Asian_Readmission.csv",
    ],
    domain: ["diabetes-research", "endocrinology"],
    description: "Bidirectional LSTM for hospital readmission prediction",
  },
};

// ====================================================================
// CONTRACT-TO-FILE MAPPING
// ====================================================================

const CONTRACT_TO_FILE_MAPPING = {
  // Original mappings
  SEER_Cancer_Registry: "SEER_Cancer_Registry_of_USA.csv",
  German_Cancer_Registry: "German_Cancer_registry@2020.csv",
  National_Cancer_Registry_of_Pakistan:
    "National_Cancer_Registry_of_Pakistan.csv",

  // Full names with extensions (already there - good!)
  "SEER_Cancer_Registry_of_USA.csv": "SEER_Cancer_Registry_of_USA.csv",
  "German_Cancer_registry@2020.csv": "German_Cancer_registry@2020.csv",
  "National_Cancer_Registry_of_Pakistan.csv":
    "National_Cancer_Registry_of_Pakistan.csv",

  // ADD THESE NEW MAPPINGS:
  German_Cancer_registry: "German_Cancer_registry@2020.csv",
  "German_Cancer_registry@2020": "German_Cancer_registry@2020.csv",
  SEER_Cancer_Registry_of_USA: "SEER_Cancer_Registry_of_USA.csv",

  diabetic_data: "diabetic_data.csv",
  "diabetic_data.csv": "diabetic_data.csv",
  Diabetic_Data: "diabetic_data.csv",
  UCI_diabetic_dataset: "diabetic_data.csv",
  "UCI_diabetic_dataset.csv": "diabetic_data.csv",

  Sylhet_Diabetes_Hospital_Bangladesh:
    "Sylhet_Diabetes_Hospital_Bangladesh.csv",
  "Sylhet_Diabetes_Hospital_Bangladesh.csv":
    "Sylhet_Diabetes_Hospital_Bangladesh.csv",

  Pima_Indians_Diabetes_USA: "Pima_Indians_Diabetes_USA.csv",
  "Pima_Indians_Diabetes_USA.csv": "Pima_Indians_Diabetes_USA.csv",

  UCI_AfricanAmerican_Readmission: "UCI_AfricanAmerican_Readmission.csv",
  "UCI_AfricanAmerican_Readmission.csv": "UCI_AfricanAmerican_Readmission.csv",
  UCI_Caucasian_Readmission: "UCI_Caucasian_Readmission.csv",
  "UCI_Caucasian_Readmission.csv": "UCI_Caucasian_Readmission.csv",
  UCI_Hispanic_Readmission: "UCI_Hispanic_Readmission.csv",
  "UCI_Hispanic_Readmission.csv": "UCI_Hispanic_Readmission.csv",
  UCI_Asian_Readmission: "UCI_Asian_Readmission.csv",
  "UCI_Asian_Readmission.csv": "UCI_Asian_Readmission.csv",
};

function mapContractNamesToFiles(datasetNames) {
  return datasetNames.map((name) => CONTRACT_TO_FILE_MAPPING[name] || name);
}

// ====================================================================
// VALIDATION LAYER FUNCTIONS
// ====================================================================

function extractAllowedResources(ragContext) {
  const allowed = {
    datasets: new Set(),
    models: new Set(),
    datasetSpecializations: new Map(),
    modelCompatibility: new Map(),
  };

  console.log("\n🔍 DEBUG - Starting extraction from RAG context...");

  // Extract datasets from policy blocks (not from AVAILABLE DATASETS section)
  const policyBlocks = ragContext.split(/(?=Dataset:|Model:)/);
  console.log(`   Found ${policyBlocks.length} policy blocks`);

  for (const block of policyBlocks) {
    // Extract asset type and name
    const assetMatch = block.match(/^(Dataset|Model):\s*([^\n]+)/);
    if (!assetMatch) continue;

    const assetType = assetMatch[1];
    const assetName = assetMatch[2].trim();

    console.log(`   Processing ${assetType}: ${assetName}`);

    // Extract specializations
    const specializationMatch = block.match(
      /Required specializations:\s*([^\.]+)/,
    );
    if (specializationMatch) {
      const specializations = specializationMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      console.log(
        `      Specializations found: [${specializations.join(", ")}]`,
      );

      if (assetType === "Dataset") {
        allowed.datasets.add(assetName);
        allowed.datasetSpecializations.set(assetName, specializations);
      } else if (assetType === "Model") {
        const modelName = assetName.endsWith(".py")
          ? assetName
          : `${assetName}.py`;
        allowed.models.add(modelName);

        // ✅ FIX: Actually store the specializations!
        allowed.modelCompatibility.set(modelName, {
          domain: MODEL_COMPATIBILITY[modelName]?.domain || specializations,
          compatible_datasets:
            MODEL_COMPATIBILITY[modelName]?.compatible_datasets || [],
        });
      }
    }
  }

  // Extract models from the allowed resources section
  const modelsMatch = ragContext.match(/Models:\s*([^\n]+)/);
  if (modelsMatch) {
    const models = modelsMatch[1].split(",").map((m) => m.trim());
    console.log(`   Found in Models section: ${models.join(", ")}`);
    models.forEach((m) => {
      allowed.models.add(m);
      // Add to modelCompatibility from MODEL_COMPATIBILITY constant
      if (MODEL_COMPATIBILITY[m]) {
        allowed.modelCompatibility.set(m, MODEL_COMPATIBILITY[m]);
      }
    });
  }

  // DEBUG OUTPUT
  console.log("\n🔍 DEBUG - Extraction Results:");
  console.log(`   Datasets: [${Array.from(allowed.datasets).join(", ")}]`);
  console.log(`   Models: [${Array.from(allowed.models).join(", ")}]`);
  console.log("   Dataset Specializations:");
  for (const [dataset, specs] of allowed.datasetSpecializations.entries()) {
    console.log(`      ${dataset}: [${specs.join(", ")}]`);
  }
  console.log("");

  return {
    datasets: Array.from(allowed.datasets),
    models: Array.from(allowed.models),
    datasetSpecializations: allowed.datasetSpecializations,
    modelCompatibility: allowed.modelCompatibility,
  };
}

function extractGeminiRecommendations(geminiResponse) {
  const recommendations = {
    datasets: [],
    models: [],
  };

  const content = geminiResponse.content || geminiResponse;

  // Extract only the text BEFORE BPMN XML to avoid parsing element IDs
  const textContent = content.split(/(<\?xml|<bpmn:definitions)/)[0];

  // Pattern 1: Inline comma-separated OR bulleted list
  const datasetsSection = textContent.match(
    /- Datasets?:([\s\S]*?)(?=- Models?:|- Explanation|$)/i,
  );
  if (datasetsSection) {
    const sectionText = datasetsSection[1].trim();
    // First try: comma-separated on same line
    const firstLine = sectionText.split("\n")[0].trim();
    if (firstLine && !firstLine.startsWith("-")) {
      const items = firstLine
        .split(",")
        .map((s) => s.trim().replace(/[\[\]'"]/g, ""))
        .filter((s) => s.length > 2);
      recommendations.datasets.push(...items);
    }
    // Also try: bulleted list items on subsequent lines
    const listItems = sectionText.matchAll(/^\s*-\s*([a-zA-Z0-9_@.-]+)/gm);
    for (const match of listItems) {
      const name = match[1].trim();
      if (name && name.length > 2 && !recommendations.datasets.includes(name)) {
        recommendations.datasets.push(name);
      }
    }
  }

  const modelsSection = textContent.match(
    /- Models?:([\s\S]*?)(?=- Explanation|- BPMN|\n\n|$)/i,
  );
  if (modelsSection) {
    const sectionText = modelsSection[1].trim();
    // First try: comma-separated on same line
    const firstLine = sectionText.split("\n")[0].trim();
    if (firstLine && !firstLine.startsWith("-")) {
      const items = firstLine
        .split(",")
        .map((s) => s.trim().replace(/[\[\]'"]/g, ""))
        .filter((s) => s.length > 2);
      recommendations.models.push(...items);
    }
    // Also try: bulleted list items
    const listItems = sectionText.matchAll(/^\s*-\s*([a-zA-Z0-9_@.-]+)/gm);
    for (const match of listItems) {
      const name = match[1].trim();
      if (name && name.length > 2 && !recommendations.models.includes(name)) {
        recommendations.models.push(name);
      }
    }
  }

  // Pattern 2: File extensions (fallback)
  if (recommendations.datasets.length === 0) {
    const datasetPatterns = [
      /["']([a-zA-Z0-9_.-]+\.(?:csv|xlsx|xls|json|xml))["']/gi,
      /\*\*([a-zA-Z0-9_.-]+\.(?:csv|xlsx|xls|json|xml))\*\*/gi,
      /([a-zA-Z0-9_]+_[a-zA-Z0-9_]+(?:\.(?:csv|xlsx|xls|json|xml))?)/gi,
    ];

    for (const pattern of datasetPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        recommendations.datasets.push(match[1].trim());
      }
    }
  }

  // Pattern 3: Model files (fallback)
  if (recommendations.models.length === 0) {
    const modelPatterns = [
      /["']([a-zA-Z0-9_@.-]+\.py)["']/gi,
      /\*\*([a-zA-Z0-9_@.-]+\.py)\*\*/gi,
    ];

    for (const pattern of modelPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        recommendations.models.push(match[1].trim());
      }
    }
  }

  // Filter out obvious non-model names
  const invalidModelNames = [
    "explanation",
    "bpmn",
    "the",
    "models",
    "workflow",
  ];
  recommendations.models = recommendations.models.filter((m) => {
    const lower = m.toLowerCase();
    return !invalidModelNames.some(
      (invalid) => lower === invalid || lower === invalid + ".py",
    );
  });

  // Remove duplicates
  recommendations.datasets = [...new Set(recommendations.datasets)];
  recommendations.models = [...new Set(recommendations.models)];

  return recommendations;
}

function detectQueryDomain(query) {
  const lowerQuery = query.toLowerCase();

  // Check cardiac FIRST
  if (
    lowerQuery.match(/cardiac|heart|cardiology|cardiovascular|ecg|coronary/)
  ) {
    return "Cardiology";
  }

  // Then check for diabetes (ADD THIS BLOCK)
  if (
    lowerQuery.match(
      /diabetes|diabetic|readmission|endocrinology|glucose|insulin|hyperglycemia|hypoglycemia/,
    )
  ) {
    return "diabetes-research";
  }

  // Then check for cancer
  if (
    lowerQuery.match(
      /cancer|tumor|oncology|chemotherapy|radiation|malignant|breast|lung|prostate/,
    )
  ) {
    return "cancer-research";
  }

  return "general";
}

const domainAliases = {
  "diabetes-research": ["medical-research", "bioinformatics", "data-analysis"],
  "cancer-research": ["medical-research", "bioinformatics", "cancer-research"],
  cardiology: ["medical-research", "bioinformatics", "cardiology"],
};

function checkDomainMatch(queryDomain, assetSpecializations) {
  if (queryDomain === "general") return true;
  if (!assetSpecializations || assetSpecializations.length === 0) return false;

  const queryLower = queryDomain.toLowerCase();
  const accepted = [queryLower, ...(domainAliases[queryLower] || [])];

  // Exclude cancer datasets when querying diabetes domain
  if (
    queryLower === "diabetes-research" &&
    assetSpecializations.includes("cancer-research")
  )
    return false;

  return assetSpecializations.some((spec) =>
    accepted.includes(spec.toLowerCase()),
  );
}

function validateRecommendations(
  geminiRecommendations,
  allowedResources,
  userQuery,
) {
  const validation = {
    valid: { datasets: [], models: [] },
    invalid: { datasets: [], models: [] },
    replacements: { datasets: [], models: [] },
  };

  const queryDomain = detectQueryDomain(userQuery);
  console.log(`   🔍 Detected query domain: ${queryDomain}`);

  // Validate datasets
  for (const dataset of geminiRecommendations.datasets) {
    const isFunctional = CONTRACT_TO_FILE_MAPPING.hasOwnProperty(dataset);

    // Normalize dataset name to match what's in the specializations map
    // E.g., "German_Cancer_registry" -> "German_Cancer_registry@2020"
    let normalizedDataset = dataset;
    if (CONTRACT_TO_FILE_MAPPING[dataset]) {
      const mappedFile = CONTRACT_TO_FILE_MAPPING[dataset];
      // Try to find the matching key in datasetSpecializations
      for (const [key] of allowedResources.datasetSpecializations.entries()) {
        if (mappedFile.includes(key) || key.includes(dataset)) {
          normalizedDataset = key;
          break;
        }
      }
    }

    const specializations =
      allowedResources.datasetSpecializations.get(normalizedDataset) || [];
    const matchesDomain = checkDomainMatch(queryDomain, specializations);

    console.log(`   Validating dataset: ${dataset}`);
    console.log(`      Functional: ${isFunctional}`);
    console.log(`      Specializations: [${specializations.join(", ")}]`);
    console.log(`      Domain match: ${matchesDomain}`);

    if (isFunctional && matchesDomain) {
      const mappedDataset = CONTRACT_TO_FILE_MAPPING[dataset] || dataset;
      validation.valid.datasets.push(mappedDataset);
    } else {
      validation.invalid.datasets.push(dataset);
      if (!matchesDomain) {
        console.log(
          `   ❌ Blocked ${dataset}: specialization mismatch (has: ${specializations.join(", ")}, need: ${queryDomain})`,
        );
      }
    }
  }

  // Validate models with compatibility checking
  for (const model of geminiRecommendations.models) {
    // ✅ Normalize: try with and without .py extension (both directions)
    let normalizedModel = model;
    let withPy = model;
    if (model.endsWith(".py")) {
      normalizedModel = model.replace(".py", "");
    } else {
      withPy = model + ".py";
    }

    const isFunctional =
      MODEL_COMPATIBILITY.hasOwnProperty(model) ||
      MODEL_COMPATIBILITY.hasOwnProperty(withPy);

    // 🔍 DEBUG: Check what's actually in the Map
    console.log(`   🔍 Checking model: ${model}`);
    console.log(`      Normalized (no .py): ${normalizedModel}`);
    console.log(`      With .py: ${withPy}`);
    console.log(
      `      Map has exact match? ${allowedResources.modelCompatibility.has(model)}`,
    );
    console.log(
      `      Map has with .py? ${allowedResources.modelCompatibility.has(withPy)}`,
    );
    console.log(
      `      All Map keys: [${Array.from(allowedResources.modelCompatibility.keys()).join(", ")}]`,
    );

    const compatibility =
      allowedResources.modelCompatibility.get(model) ||
      allowedResources.modelCompatibility.get(normalizedModel) ||
      allowedResources.modelCompatibility.get(withPy);

    let isCompatible = false;

    if (compatibility) {
      // Check if model is compatible with query domain
      const modelDomains = compatibility.domain || [];
      const domainMatch =
        queryDomain === "general" ||
        modelDomains.some((d) => d.toLowerCase() === queryDomain.toLowerCase());

      // Check if model is compatible with selected datasets
      const validDatasets = validation.valid.datasets;
      const datasetMatch = validDatasets.some((ds) =>
        compatibility.compatible_datasets.includes(ds),
      );

      isCompatible = domainMatch && datasetMatch;

      if (!domainMatch) {
        console.log(
          `   ❌ Blocked ${model}: domain mismatch (supports: ${modelDomains.join(", ")}, need: ${queryDomain})`,
        );
      }
      if (!datasetMatch) {
        console.log(
          `   ❌ Blocked ${model}: incompatible with selected datasets`,
        );
      }
    } else {
      // Model not in RAG results → incompatible
      console.log(`   ❌ ${model} not in allowed resources`);
    }

    if (isFunctional && isCompatible) {
      validation.valid.models.push(
        model.endsWith(".py") ? model : model + ".py",
      );
    } else {
      validation.invalid.models.push(model);
    }
  }

  // Generate replacements ONLY if domain matches
  if (validation.valid.datasets.length === 0) {
    const domainMatched = Array.from(
      allowedResources.datasetSpecializations.entries(),
    )
      .filter(([dataset, specs]) => checkDomainMatch(queryDomain, specs))
      .map(([dataset]) => dataset)
      .slice(0, 3);

    if (domainMatched.length > 0) {
      validation.replacements.datasets = domainMatched;
    } else if (queryDomain === "general") {
      // Only provide all datasets for general queries
      validation.replacements.datasets = Array.from(
        allowedResources.datasets,
      ).slice(0, 3);
    } else {
      // For specific domains with no matches, don't suggest anything
      validation.replacements.datasets = [];
      console.log(`   ⚠️  No datasets available for domain: ${queryDomain}`);
    }
  }

  // Generate model replacements based on dataset compatibility
  if (
    validation.valid.models.length === 0 &&
    allowedResources.models.length > 0
  ) {
    const validDatasets =
      validation.valid.datasets.length > 0
        ? validation.valid.datasets
        : validation.replacements.datasets;

    // Only suggest models if we have valid/replacement datasets
    if (validDatasets.length > 0) {
      const compatibleModels = Array.from(
        allowedResources.modelCompatibility.entries(),
      )
        .filter(([model, info]) => {
          const domainMatch =
            queryDomain === "general" ||
            info.domain.some(
              (d) => d.toLowerCase() === queryDomain.toLowerCase(),
            );
          const datasetMatch = validDatasets.some((ds) =>
            info.compatible_datasets.includes(ds),
          );
          return domainMatch && datasetMatch;
        })
        .map(([model]) => model)
        .slice(0, 2);

      if (compatibleModels.length > 0) {
        validation.replacements.models = compatibleModels;
      } else if (queryDomain === "general") {
        // Only provide all models for general queries
        validation.replacements.models = Array.from(
          allowedResources.models,
        ).slice(0, 2);
      } else {
        validation.replacements.models = [];
        console.log(`   ⚠️  No models available for domain: ${queryDomain}`);
      }
    } else {
      // No datasets available, so no models either
      validation.replacements.models = [];
    }
  }

  return { validation, queryDomain };
}

async function saveValidatedRecommendations(datasets, models) {
  const filePath = path.join(__dirname, "models_datasets_names_1.json");
  const data = {
    datasets: mapContractNamesToFiles(datasets),
    models: models,
    timestamp: new Date().toISOString(),
    validation_applied: true,
  };

  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function logValidationResults(validation, allowedResources, queryDomain) {
  console.log("\n🛡️ VALIDATION RESULTS:");
  console.log(
    `   ✅ Valid datasets: ${validation.valid.datasets.join(", ") || "None"}`,
  );
  console.log(
    `   ✅ Valid models: ${validation.valid.models.join(", ") || "None"}`,
  );
  console.log(
    `   ❌ Invalid datasets: ${validation.invalid.datasets.join(", ") || "None"}`,
  );
  console.log(
    `   ❌ Invalid models: ${validation.invalid.models.join(", ") || "None"}`,
  );

  if (
    validation.replacements.datasets.length > 0 ||
    validation.replacements.models.length > 0
  ) {
    console.log(
      `   🔄 Replacements - Datasets: ${validation.replacements.datasets.join(", ") || "None"}`,
    );
    console.log(
      `   🔄 Replacements - Models: ${validation.replacements.models.join(", ") || "None"}`,
    );

    // Add contextual messaging
    if (
      validation.replacements.datasets.length === 0 &&
      validation.replacements.models.length > 0
    ) {
      console.log(
        `   ℹ️  Note: Models available but require ${queryDomain} datasets (currently unavailable)`,
      );
    }
  }
}

function saveWholeResponseToJson(geminiResponse) {
  const filePath = path.join(__dirname, "whole_response.json");
  let existingData = [];

  if (fs.existsSync(filePath)) {
    try {
      const fileContent = fs.readFileSync(filePath, "utf8");
      existingData = JSON.parse(fileContent);
    } catch (err) {
      console.log(
        "⚠️ Could not read existing whole_response.json, creating new array",
      );
    }
  }

  existingData.push({
    timestamp: new Date().toISOString(),
    response: geminiResponse,
  });

  fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
  console.log(`💾 Saved Gemini response to ${filePath}`);
}

// ====================================================================
// MAIN RAG FUNCTION
// ====================================================================

async function generateWithRAG(
  userInput,
  selectedDatasets = [],
  selectedModels = [],
) {
  try {
    // STEP 1: Query RAG API
    console.log("📡 Fetching RAG context...");
    const ragResponse = await axios.post("http://localhost:5000/rag/retrieve", {
      query: userInput,
      selected_datasets: selectedDatasets,
      selected_models: selectedModels,
    });

    const ragContext = ragResponse.data.enhanced_context;
    console.log(`✅ Retrieved RAG context (${ragContext.length} chars)`);

    // STEP 2: Extract allowed resources from RAG
    const allowedResources = extractAllowedResources(ragContext);
    console.log("📋 Allowed resources:");
    console.log(`   Datasets: ${allowedResources.datasets.join(", ")}`);
    console.log(`   Models: ${allowedResources.models.join(", ")}`);

    const enhancedPrompt = `${ragContext}

        USER REQUEST: "${userInput}"

        CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE RULES EXACTLY:

        1.  **Identify Resources:** From the RAG context, identify the most relevant datasets and models for the user's request.
        2.  **Generate BPMN XML:** You MUST create a complete BPMN 2.0 XML diagram that visualizes the workflow using the resources you identified. The diagram MUST be structurally valid with a start event, an end event, and all nodes connected.
        3.  **Format Output:** The final output MUST be a single block of text containing BOTH the resource list AND the BPMN XML, in that order.
        4.  **Dataset Task Matching:** Pay close attention to each dataset's description in the RAG context. Datasets specify their TASK (e.g., "readmission", "diagnosis", "survival analysis"). Only recommend datasets whose task matches the user's query. If a description says "NOT for [X]", do NOT recommend it for [X] queries.
        5.  **Model Name vs Capability:** Do NOT judge a model's capability by its name alone. A model named "mlp_cancer_classifier" or "random_survival_forest" may support multiple tasks including diabetes diagnosis — always check the model's metadata description for its full list of supported modes. If the description says it supports binary diabetes diagnosis classification, you MUST consider it for diabetes diagnosis queries regardless of its name.
        6.  **Race-Split Dataset Rules:** The UCI_*_Readmission.csv datasets (AfricanAmerican, Caucasian, Hispanic, Asian) are ONLY for cross-race/racial/ethnic comparison queries. For general readmission queries like "predict readmission" or "readmission for diabetic patients", use ONLY diabetic_data.csv. Only use race-split datasets when the user explicitly mentions race, racial, cross-race, ethnicity, or specific race names. When using race-split datasets, include ALL 4 and exclude diabetic_data.csv. The BPMN diagram should reflect ONLY the datasets you recommend — do not include datasets you did not select.

        REQUIRED OUTPUT FORMAT (follow EXACTLY):

        - Datasets:
        - [dataset_name_1]
        - Models:
        - [model_name_1.py]

        <bpmn:definitions ...>
          ...
        </bpmn:definitions>

        Do NOT add any other text, explanation, or markdown formatting like \`\`\`xml.`;

    console.log("🤖 Calling Gemini with enhanced prompt (including models)...");
    let geminiResponse = await getChatGPTResponse(enhancedPrompt);

    saveWholeResponseToJson(geminiResponse);

    // STEP 3: Extract recommendations
    const geminiRecommendations = extractGeminiRecommendations(geminiResponse);
    console.log("📊 Gemini recommended:");
    console.log(
      `   Datasets: ${geminiRecommendations.datasets.join(", ") || "None"}`,
    );
    console.log(
      `   Models: ${geminiRecommendations.models.join(", ") || "None"}`,
    );

    // STEP 4: Validate
    const { validation, queryDomain } = validateRecommendations(
      geminiRecommendations,
      allowedResources,
      userInput,
    );

    // STEP 5: Determine final recommendations
    let finalDatasets = validation.valid.datasets;
    let finalModels = validation.valid.models;

    if (
      finalDatasets.length === 0 &&
      validation.replacements.datasets.length > 0
    ) {
      finalDatasets = validation.replacements.datasets;
    }
    if (finalModels.length === 0 && validation.replacements.models.length > 0) {
      finalModels = validation.replacements.models;
    }

    // STEP 5b: Diabetes sub-domain filtering (readmission vs diagnosis)
    const queryLower = userInput.toLowerCase();
    const isReadmissionQuery =
      queryLower.includes("readmission") || queryLower.includes("readmit");
    const isDiagnosisQuery =
      queryLower.includes("diagnosis") ||
      queryLower.includes("diagnos") ||
      queryLower.includes("risk prediction") ||
      queryLower.includes("early-stage");
    const hasDiabetesDatasets = finalDatasets.some(
      (d) =>
        d.toLowerCase().includes("diabetic") ||
        d.toLowerCase().includes("diabetes") ||
        d.toLowerCase().includes("pima") ||
        d.toLowerCase().includes("sylhet") ||
        d.toLowerCase().includes("readmission"),
    );

    if (hasDiabetesDatasets && (isReadmissionQuery || isDiagnosisQuery)) {
      const READMISSION_DATASETS = [
        "diabetic_data.csv",
        "UCI_AfricanAmerican_Readmission.csv",
        "UCI_Caucasian_Readmission.csv",
        "UCI_Hispanic_Readmission.csv",
        "UCI_Asian_Readmission.csv",
      ];
      const DIAGNOSIS_DATASETS = [
        "Pima_Indians_Diabetes_USA.csv",
        "Sylhet_Diabetes_Hospital_Bangladesh.csv",
      ];

      let geminiCorrect = true;

      if (isReadmissionQuery && !isDiagnosisQuery) {
        const hasDiagnosisDS = finalDatasets.some((d) =>
          DIAGNOSIS_DATASETS.includes(d),
        );
        if (hasDiagnosisDS) {
          geminiCorrect = false;
          finalDatasets = finalDatasets.filter(
            (d) => !DIAGNOSIS_DATASETS.includes(d),
          );
          finalModels = finalModels; // keep LSTM for readmission
          console.log(
            `⚠️ FALLBACK: Gemini included diagnosis datasets in readmission query — stripped`,
          );
        }
      } else if (isDiagnosisQuery && !isReadmissionQuery) {
        const hasReadmissionDS = finalDatasets.some((d) =>
          READMISSION_DATASETS.includes(d),
        );
        const hasLSTM = finalModels.some((m) =>
          m.toLowerCase().includes("lstm"),
        );
        if (hasReadmissionDS || hasLSTM) {
          geminiCorrect = false;
          finalDatasets = finalDatasets.filter(
            (d) => !READMISSION_DATASETS.includes(d),
          );
          finalModels = finalModels.filter(
            (m) => !m.toLowerCase().includes("lstm"),
          );
          console.log(
            `⚠️ FALLBACK: Gemini included readmission datasets/LSTM in diagnosis query — stripped`,
          );
        }
      }

      if (geminiCorrect) {
        console.log(
          `✅ Gemini correctly separated readmission vs diagnosis datasets — no fallback needed`,
        );
      }
    }

    // STEP 5c: Race-comparison routing for readmission queries
    const RACE_SPLIT_DATASETS = [
      "UCI_AfricanAmerican_Readmission.csv",
      "UCI_Caucasian_Readmission.csv",
      "UCI_Hispanic_Readmission.csv",
      "UCI_Asian_Readmission.csv",
    ];
    const isRaceComparisonQuery =
      queryLower.includes("race") ||
      queryLower.includes("racial") ||
      queryLower.includes("cross-race") ||
      queryLower.includes("african american") ||
      queryLower.includes("caucasian") ||
      queryLower.includes("hispanic") ||
      queryLower.includes("asian") ||
      queryLower.includes("ethnicit");

    if (isReadmissionQuery && isRaceComparisonQuery) {
      // Race comparison query → ensure all 4 race datasets, remove diabetic_data.csv
      const hasRaceDS = finalDatasets.some((d) => RACE_SPLIT_DATASETS.includes(d));
      if (!hasRaceDS) {
        console.log(`⚠️ FALLBACK: Race comparison query but Gemini didn't select race datasets — injecting all 4`);
        finalDatasets = finalDatasets.filter((d) => d !== "diabetic_data.csv");
        finalDatasets.push(...RACE_SPLIT_DATASETS);
      } else {
        // Gemini picked some race datasets — ensure all 4 are included and drop diabetic_data
        finalDatasets = finalDatasets.filter((d) => d !== "diabetic_data.csv");
        for (const rd of RACE_SPLIT_DATASETS) {
          if (!finalDatasets.includes(rd)) finalDatasets.push(rd);
        }
        console.log(`✅ Race comparison: ensured all 4 race-split datasets present`);
      }
    } else if (isReadmissionQuery && !isRaceComparisonQuery) {
      // Regular readmission query → strip any race datasets Gemini may have included
      const hasRaceDS = finalDatasets.some((d) => RACE_SPLIT_DATASETS.includes(d));
      if (hasRaceDS) {
        finalDatasets = finalDatasets.filter((d) => !RACE_SPLIT_DATASETS.includes(d));
        if (!finalDatasets.includes("diabetic_data.csv")) {
          finalDatasets.push("diabetic_data.csv");
        }
        console.log(`⚠️ FALLBACK: Non-race readmission query but Gemini included race datasets — stripped, using diabetic_data.csv`);
      }
    }

    // STEP 6: Log results
    logValidationResults(validation, allowedResources, queryDomain);

    // STEP 7: Save
    const savedPath = await saveValidatedRecommendations(
      finalDatasets,
      finalModels,
    );
    console.log(`💾 Validated recommendations saved to: ${savedPath}`);

    // NOW validate BPMN (after finalDatasets/finalModels are defined)
    console.log("\n--- 🧐 Searching for and Validating BPMN Diagram ---");

    const responseText = geminiResponse.content || geminiResponse;
    let extractedBpmnXml = null; // Declare outside to make it accessible for semantic validation

    if (typeof responseText !== "string") {
      console.error(
        "--- ❌ BPMN Validation FAILED: LLM response content is not a string. ---",
      );
    } else {
      const bpmnRegex = /(<bpmn:definitions[\s\S]*?<\/bpmn:definitions>)/;
      const match = responseText.match(bpmnRegex);

      if (match && match[1]) {
        extractedBpmnXml = match[1];
        extractedBpmnXml = extractedBpmnXml.replace(/\\n/g, "\n");

        console.log("✅ BPMN Diagram Found. Running validation...");

        const validationResult = await validateBPMN(extractedBpmnXml);

        const saveResult = await bpmnSaver.saveDiagram(
          extractedBpmnXml,
          validationResult.isValid,
          {
            userQuery: userInput,
            recommendedDatasets: finalDatasets,
            recommendedModels: finalModels,
            validationErrors: validationResult.errors || [],
          },
        );
        if (saveResult.success) await bpmnSaver.printSummary();

        if (!validationResult.isValid) {
          console.error("BPMN Validation FAILED: ❌");
          validationResult.errors.forEach((error) =>
            console.error(`  - ${error}`),
          );

          console.log("\n🔧 Attempting automatic correction...");
          const corrector = new BPMNCorrector();
          const correctionResult =
            await corrector.correctBPMN(extractedBpmnXml);

          let revalidation = null;

          if (correctionResult.success) {
            console.log(
              `✅ Correction successful: ${correctionResult.message}`,
            );
            extractedBpmnXml = correctionResult.correctedXml;

            revalidation = await validateBPMN(extractedBpmnXml);
            if (revalidation.isValid) {
              console.log("✅ Corrected diagram is now valid!");

              // Replace the XML in the response
              const responseText = geminiResponse.content || geminiResponse;
              const updatedResponse = responseText.replace(
                /(<bpmn:definitions[\s\S]*?<\/bpmn:definitions>)/,
                extractedBpmnXml,
              );

              geminiResponse =
                typeof geminiResponse === "string"
                  ? updatedResponse
                  : { ...geminiResponse, content: updatedResponse };

              await bpmnSaver.saveDiagram(extractedBpmnXml, true, {
                userQuery: userInput,
                recommendedDatasets: finalDatasets,
                recommendedModels: finalModels,
                corrected: true,
              });
            } else {
              console.log("⚠️ Still has errors after correction");
            }
          } else {
            console.log(
              `❌ Auto-correction failed: ${correctionResult.message}`,
            );

            // FAILSAFE: Ask Gemini to fix it
            console.log(
              "\n🤖 Attempting Gemini-based correction as failsafe...",
            );

            const geminiCorrectionPrompt = `You are a BPMN 2.0 diagram repair expert.

                    INVALID BPMN XML:
                    ${extractedBpmnXml}

                    VALIDATION ERRORS FOUND:
                    ${validationResult.errors.map((err, i) => `${i + 1}. ${err}`).join("\n")}

                    TASK: Fix ONLY the structural errors listed above. Do NOT change:
                    - Task names or labels
                    - Dataset/model references (keep ${finalDatasets.join(", ")} and ${finalModels.join(", ")})
                    - The overall workflow logic

                    CRITICAL RULES FOR FIXING:
                    - Every task must have both incoming AND outgoing flows
                    - If there's a fork gateway (parallelGateway with multiple outgoing), you MUST add a matching join gateway
                    - End event must have incoming flow (from a task or gateway)
                    - Start event must have outgoing flow
                    - All nodes must be reachable from start event
                    - All sequence flows must have valid sourceRef and targetRef
                    - The bpmndi:BPMNDiagram section MUST contain a bpmndi:BPMNShape with dc:Bounds (x, y, width, height) for EVERY process element, and a bpmndi:BPMNEdge with di:waypoint elements for EVERY sequence flow

                    OUTPUT REQUIREMENTS:
                    - Return ONLY the corrected BPMN XML
                    - No explanations, no markdown formatting, no \`\`\`xml tags
                    - Just the raw XML starting with <?xml version="1.0"`;

            const geminiCorrectionResponse = await getChatGPTResponse(
              geminiCorrectionPrompt,
            );
            const geminiResponseText =
              geminiCorrectionResponse.content || geminiCorrectionResponse;

            // Extract corrected XML from Gemini's response
            const geminiBpmnMatch = geminiResponseText.match(
              /(<\?xml[\s\S]*?<\/bpmn:definitions>)/,
            );

            if (geminiBpmnMatch && geminiBpmnMatch[1]) {
              const geminiCorrectedXml = geminiBpmnMatch[1];
              console.log("✅ Gemini returned corrected BPMN. Validating...");

              const geminiRevalidation = await validateBPMN(geminiCorrectedXml);

              if (geminiRevalidation.isValid) {
                console.log("✅ Gemini-corrected diagram is now valid!");
                extractedBpmnXml = geminiCorrectedXml;
                revalidation = geminiRevalidation;

                // Replace the XML in the response
                const responseText = geminiResponse.content || geminiResponse;
                const updatedResponse = responseText.replace(
                  /(<bpmn:definitions[\s\S]*?<\/bpmn:definitions>)/,
                  extractedBpmnXml,
                );

                geminiResponse =
                  typeof geminiResponse === "string"
                    ? updatedResponse
                    : { ...geminiResponse, content: updatedResponse };

                await bpmnSaver.saveDiagram(extractedBpmnXml, true, {
                  userQuery: userInput,
                  recommendedDatasets: finalDatasets,
                  recommendedModels: finalModels,
                  correctedBy: "gemini",
                });
              } else {
                console.log("❌ Gemini correction still has errors:");
                geminiRevalidation.errors.forEach((err) =>
                  console.log(`   - ${err}`),
                );
              }
            } else {
              console.log(
                "❌ Could not extract BPMN from Gemini's correction response",
              );
            }
          }

          // Only return error if still invalid after both correction attempts
          if (!revalidation || !revalidation.isValid) {
            return {
              success: false,
              error:
                "BPMN diagram generation failed. Please try again with a clearer prompt.",
              validation_errors: validationResult.errors,
              recommended_datasets: finalDatasets,
              recommended_models: finalModels,
              rag_used: true,
            };
          }
        }

        console.log(
          "BPMN Validation PASSED: ✅ Diagram is structurally sound.",
        );
      } else {
        console.log(
          "--- 🟡 BPMN Validation SKIPPED: No BPMN diagram found in the LLM response. ---",
        );
      }
    }
    console.log("--- BPMN Validation Check Complete ---\n");

    // ⭐ PHASE 6: SEMANTIC/CONTENT VALIDATION (OUR APPROACH)
    // Only run semantic validation if structurally valid
    if (extractedBpmnXml) {
      console.log("\n--- 🔍 Running Semantic/Content Validation ---");

      // If no datasets were recommended, try to use available datasets from RAG
      let datasetsToValidate = finalDatasets;

      if (
        datasetsToValidate.length === 0 &&
        allowedResources.datasets.length > 0
      ) {
        console.log(
          "⚠️  No datasets recommended by Gemini. Using available datasets from RAG...",
        );

        // Filter datasets by query domain
        const queryDomain2 = detectQueryDomain(userInput);
        const domainMatchedDatasets = Array.from(
          allowedResources.datasetSpecializations.entries(),
        )
          .filter(([dataset, specs]) => checkDomainMatch(queryDomain2, specs))
          .map(([dataset]) => dataset);

        if (domainMatchedDatasets.length > 0) {
          datasetsToValidate = domainMatchedDatasets;
          console.log(
            `   ✅ Found ${datasetsToValidate.length} domain-matched datasets: [${datasetsToValidate.join(", ")}]`,
          );
        } else {
          console.log(
            `   ⚠️  No domain-matched datasets found for: ${queryDomain2}`,
          );
        }
      }

      try {
        // Run semantic validation (even with empty datasets - still validates models)
        const semanticValidation = await validateWorkflow({
          bpmnXml: extractedBpmnXml,
          selectedDatasets: datasetsToValidate,
          selectedModels: finalModels,
          ragContext: ragContext,
          modelCompatibility: MODEL_COMPATIBILITY,
        });

        console.log(`📊 Semantic Validation: ${semanticValidation.status}`);
        console.log(
          `   Errors: ${semanticValidation.errors.length}, Warnings: ${semanticValidation.warnings.length}`,
        );

        let updatedBpmnXml = extractedBpmnXml;
        let finalSemanticValidation = semanticValidation;

        // If there are warnings or errors, run Verifier LLM
        if (
          semanticValidation.warnings.length > 0 ||
          semanticValidation.errors.length > 0
        ) {
          console.log("\n🤖 Running Verifier LLM for confidence check...");

          const verifierResult = await runCompleteVerification(
            semanticValidation,
            ragContext,
            userInput,
          );

          // Apply suggested fixes if high confidence
          if (
            verifierResult.verifier &&
            verifierResult.verifier.confidence > 0.8
          ) {
            console.log(
              `✅ High confidence fixes available (${verifierResult.verifier.confidence.toFixed(2)}). Applying...`,
            );

            // Collect all suggested fixes
            const allFixes = [
              ...semanticValidation.warnings
                .map((w) => w.suggested_fix)
                .filter((f) => f),
              ...(verifierResult.verifier.suggested_fixes || []),
            ];

            if (allFixes.length > 0) {
              updatedBpmnXml = applySuggestedFixes(updatedBpmnXml, allFixes);

              // Re-validate after fixes
              console.log("🔄 Re-validating after applying fixes...");
              const revalidationResult = await validateWorkflow({
                bpmnXml: updatedBpmnXml,
                selectedDatasets: datasetsToValidate,
                selectedModels: finalModels,
                ragContext: ragContext,
                modelCompatibility: MODEL_COMPATIBILITY,
              });

              if (revalidationResult.status === "PASS") {
                console.log(
                  "✅ Semantic validation passed after applying fixes!",
                );
                extractedBpmnXml = updatedBpmnXml;
                finalSemanticValidation = revalidationResult;

                // Update the response with fixed BPMN
                const responseText3 = geminiResponse.content || geminiResponse;
                const updatedResponse = responseText3.replace(
                  /(<bpmn:definitions[\s\S]*?<\/bpmn:definitions>)/,
                  updatedBpmnXml,
                );

                geminiResponse =
                  typeof geminiResponse === "string"
                    ? updatedResponse
                    : { ...geminiResponse, content: updatedResponse };
              } else {
                console.log(
                  `⚠️ Semantic validation still has issues after fixes: ${revalidationResult.status}`,
                );
                finalSemanticValidation = revalidationResult;
              }
            }
          } else {
            console.log(
              `⚠️ Low confidence fixes (${verifierResult.verifier?.confidence || 0}). Manual review recommended.`,
            );
            finalSemanticValidation = verifierResult;
          }
        }

        // Update finalDatasets if we found domain-matched ones
        if (datasetsToValidate.length > 0 && finalDatasets.length === 0) {
          finalDatasets = datasetsToValidate;
          console.log(
            `   📝 Updated finalDatasets: [${finalDatasets.join(", ")}]`,
          );
        }

        // Save with semantic validation metadata
        const saveMetadata = {
          userQuery: userInput,
          recommendedDatasets: datasetsToValidate,
          recommendedModels: finalModels,
          structuralValidation: true,
          semanticValidation: {
            status: finalSemanticValidation.status,
            score: finalSemanticValidation.score,
            errors: finalSemanticValidation.errors.length,
            warnings: finalSemanticValidation.warnings.length,
            verifierConfidence:
              finalSemanticValidation.verifier?.confidence || null,
            datasetsAutoDetected:
              datasetsToValidate.length > 0 &&
              validation.valid.datasets.length === 0,
          },
          corrected: true,
        };

        // Save the final diagram
        await bpmnSaver.saveDiagram(
          extractedBpmnXml,
          finalSemanticValidation.status === "PASS",
          saveMetadata,
        );

        console.log("--- Semantic Validation Complete ---\n");
      } catch (semanticError) {
        console.error(
          "⚠️ Semantic validation error:",
          semanticError.message || semanticError,
        );
        console.log("   Continuing with structurally valid BPMN...");
      }
    } else {
      console.log("--- 🟡 Semantic Validation SKIPPED: No BPMN found ---");
    }

    // Check if we have resources before returning
    if (finalDatasets.length === 0 && finalModels.length === 0) {
      return {
        success: false,
        error:
          "No matching datasets or models found for your query. Available domains: cancer-research only.",
        available_datasets: Array.from(allowedResources.datasets),
        available_models: Array.from(allowedResources.models),
        rag_used: true,
      };
    }

    // STEP 8: Return
    return {
      success: true,
      response: geminiResponse,
      rag_used: true,
      validation: {
        hallucinations_blocked:
          validation.invalid.datasets.length + validation.invalid.models.length,
        policy_compliant: finalDatasets.length + finalModels.length,
        datasets: (() => {
          const mapped = mapContractNamesToFiles(finalDatasets);
          console.log("🔍 MAPPING DEBUG:");
          console.log("   Input (finalDatasets):", finalDatasets);
          console.log("   Output (mapped):", mapped);
          return mapped;
        })(),
        models: finalModels,
      },
    };
  } catch (error) {
    console.error("⚠️ RAG failed:", error.message);

    const result = await getChatGPTResponse(userInput);
    saveWholeResponseToJson(result);

    return {
      success: true,
      response: result,
      rag_used: false,
      fallback: true,
      validation: {
        hallucinations_blocked: 0,
        policy_compliant: 0,
        datasets: [],
        models: [],
      },
    };
  }
}

module.exports = { generateWithRAG };
