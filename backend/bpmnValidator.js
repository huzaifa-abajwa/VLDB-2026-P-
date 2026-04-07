const xml2js = require("xml2js");

// --- Semantic Validation Data ---
const VALID_RESOURCES = {
  datasets: {
    SEER_Cancer_Registry: {
      keywords: ["seer", "cancer registr", "cancer data", "lung cancer"],
    },
    German_Cancer_Registry: { keywords: ["german", "cancer registr"] },
    National_Cancer_Registry_of_Pakistan: {
      keywords: ["pakistan", "national", "cancer registr"],
    },
    BreastCancer_v2: { keywords: ["breast", "breast cancer"] },
    diabetic_data: { keywords: ["diabetic", "diabetes", "readmission"] },
    UCI_AfricanAmerican_Readmission: {
      keywords: ["african american", "african-american", "readmission"],
    },
    UCI_Caucasian_Readmission: {
      keywords: ["caucasian", "white", "readmission"],
    },
    UCI_Hispanic_Readmission: {
      keywords: ["hispanic", "latino", "readmission"],
    },
    UCI_Asian_Readmission: { keywords: ["asian", "readmission"] },
  },
  models: {
    "cox_model@2020.py": { keywords: ["cox", "proportional hazards"] },
    "kaplan_meier_model@2020.py": {
      keywords: ["kaplan-meier", "kaplan", "meier", "survival curve"],
    },
    "google_Health_Cancer_Prediction_Model.py": {
      keywords: ["google", "logistic regression", "prediction"],
    },
    DeepSurv_Cancer_Prediction_Model: { keywords: ["deepsurv"] },
    "xgboost_risk_model@2025.py": {
      keywords: ["xgboost", "risk", "readmission", "diabetic", "diabetes"],
    },
    "random_survival_forest@2025.py": {
      keywords: [
        "random",
        "survival",
        "forest",
        "rsf",
        "readmission",
        "diabetic",
        "diabetes",
      ],
    },
    "mlp_cancer_classifier@2025.py": {
      keywords: [
        "mlp",
        "neural",
        "classifier",
        "readmission",
        "diabetic",
        "diabetes",
      ],
    },
    "lstm_readmission_model@2026.py": {
      keywords: [
        "lstm",
        "readmission",
        "recurrent",
        "rnn",
        "neural",
        "temporal",
      ],
    },
  },
};

async function parseXml(xmlString) {
  const parser = new xml2js.Parser({ explicitArray: false });
  return await parser.parseStringPromise(xmlString);
}

// --- Semantic Check Function ---
function checkResourceExists(taskName, resourceType) {
  const lowerName = taskName.toLowerCase();
  const resources = VALID_RESOURCES[resourceType];

  for (const resourceFile in resources) {
    if (lowerName.includes(resourceFile.toLowerCase())) {
      return true; // Direct match
    }
    for (const keyword of resources[resourceFile].keywords) {
      if (lowerName.includes(keyword)) {
        return true; // Keyword match
      }
    }
  }
  return false;
}

async function validateBPMN(xmlString) {
  const errors = [];
  let parsedXml;

  try {
    parsedXml = await parseXml(xmlString);
  } catch (err) {
    return { isValid: false, errors: [`XML Parsing Error: ${err.message}`] };
  }

  const process = parsedXml["bpmn:definitions"]["bpmn:process"];
  if (!process) {
    return { isValid: false, errors: ["No process found in BPMN diagram."] };
  }

  const elements = [];
  const elementTypes = [
    "bpmn:startEvent",
    "bpmn:endEvent",
    "bpmn:task",
    "bpmn:userTask",
    "bpmn:scriptTask",
    "bpmn:serviceTask",
    "bpmn:exclusiveGateway",
    "bpmn:parallelGateway",
  ];
  elementTypes.forEach((type) => {
    if (process[type]) {
      const processElements = Array.isArray(process[type])
        ? process[type]
        : [process[type]];
      elements.push(
        ...processElements.map((el) => ({ ...el, elementType: type })),
      );
    }
  });

  const sequenceFlows = process["bpmn:sequenceFlow"]
    ? Array.isArray(process["bpmn:sequenceFlow"])
      ? process["bpmn:sequenceFlow"]
      : [process["bpmn:sequenceFlow"]]
    : [];
  const sourceRefs = new Set(sequenceFlows.map((sf) => sf.$.sourceRef));
  const targetRefs = new Set(sequenceFlows.map((sf) => sf.$.targetRef));

  // Rules 1 & 2: Start/End Events
  const startEvents = elements.filter(
    (el) => el.elementType === "bpmn:startEvent",
  );
  if (startEvents.length !== 1)
    errors.push(
      `Structural Error: BPMN must have exactly one start event. Found ${startEvents.length}.`,
    );
  const endEvents = elements.filter((el) => el.elementType === "bpmn:endEvent");
  if (endEvents.length === 0)
    errors.push("Structural Error: BPMN must have at least one end event.");

  // Rule 3: Orphan/Dead-End Check
  elements.forEach((element) => {
    const id = element.$.id;
    if (element.elementType !== "bpmn:startEvent" && !targetRefs.has(id))
      errors.push(
        `Structural Error: Node "${element.$.name || id}" is an orphan (no incoming flow).`,
      );
    if (element.elementType !== "bpmn:endEvent" && !sourceRefs.has(id))
      errors.push(
        `Structural Error: Node "${element.$.name || id}" is a dead end (no outgoing flow).`,
      );
  });

  const tasks = elements.filter(
    (el) =>
      el.elementType === "bpmn:task" ||
      el.elementType === "bpmn:userTask" ||
      el.elementType === "bpmn:scriptTask" ||
      el.elementType === "bpmn:serviceTask",
  );

  // Rule 4: Gateway Balance Check
  const parallelGateways = elements.filter(
    (el) => el.elementType === "bpmn:parallelGateway",
  );
  console.log(`Found ${parallelGateways.length} parallel gateways`);

  parallelGateways.forEach((gateway) => {
    const outgoing = sequenceFlows.filter(
      (sf) => sf.$.sourceRef === gateway.$.id,
    );
    const incoming = sequenceFlows.filter(
      (sf) => sf.$.targetRef === gateway.$.id,
    );

    if (outgoing.length > 1 && incoming.length === 1) {
      const hasJoin = parallelGateways.some((gw) => {
        const gwIncoming = sequenceFlows.filter(
          (sf) => sf.$.targetRef === gw.$.id,
        );
        return gwIncoming.length > 1 && gw.$.id !== gateway.$.id;
      });

      if (!hasJoin) {
        errors.push(
          `Gateway "${gateway.$.name || gateway.$.id}" forks into ${outgoing.length} paths but has no join gateway.`,
        );
      }
    }
  });

  // Rule 5: Path Completeness (all nodes reachable from start)
  function isReachable(startId, targetId, flows) {
    if (startId === targetId) return true;
    const visited = new Set();
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      flows
        .filter((f) => f.$.sourceRef === current)
        .forEach((f) => queue.push(f.$.targetRef));
    }
    return false;
  }

  if (startEvents.length > 0) {
    const startId = startEvents[0].$.id;
    elements.forEach((element) => {
      if (
        element.$.id !== startId &&
        !isReachable(startId, element.$.id, sequenceFlows)
      ) {
        errors.push(
          `Node "${element.$.name || element.$.id}" is not reachable from start event.`,
        );
      }
    });
  }

  // --- Rule 6: UPDATED Semantic Check ---
  tasks.forEach((task) => {
    const taskName = task.$.name || "";
    const lowerName = taskName.toLowerCase();

    // Skip generic processing tasks
    const genericTasks = [
      "preprocess",
      "filter",
      "select",
      "split",
      "combine",
      "output",
      "generate",
      "save",
      "review",
      "analyze",
      "visualize",
      "plot",
      "compare",
      "prepare",
      "apply",
      "assess",
      "verify",
      "validate",
    ];
    if (genericTasks.some((kw) => lowerName.includes(kw))) {
      return; // Skip validation for processing tasks
    }

    const isDatasetTask = ["access", "load", "registry"].some((kw) =>
      lowerName.includes(kw),
    );
    const isModelTask =
      lowerName.includes(".py") ||
      (["execute", "run"].some((kw) => lowerName.includes(kw)) &&
        !isDatasetTask);

    if (isDatasetTask && !lowerName.includes("compliant")) {
      // Skip "Access Compliant Datasets"
      if (!checkResourceExists(taskName, "datasets")) {
        errors.push(
          `Semantic Warning: Task "${taskName}" appears to reference a non-existent dataset.`,
        );
      }
    } else if (isModelTask) {
      if (!checkResourceExists(taskName, "models")) {
        errors.push(
          `Semantic Warning: Task "${taskName}" appears to reference a non-existent model.`,
        );
      }
    }
  });

  // Rule 7: BPMNDiagram must contain visual layout (BPMNShape elements)
  const diagram = parsedXml["bpmn:definitions"]["bpmndi:BPMNDiagram"];
  if (diagram) {
    const plane = diagram["bpmndi:BPMNPlane"];
    const shapes = plane ? plane["bpmndi:BPMNShape"] : null;
    const shapeCount = shapes ? (Array.isArray(shapes) ? shapes.length : 1) : 0;
    if (shapeCount === 0) {
      errors.push(
        "Layout Error: BPMNDiagram section is empty (no BPMNShape elements). Diagram will not render visually.",
      );
    }
  } else {
    errors.push(
      "Layout Error: No BPMNDiagram section found. Diagram will not render visually.",
    );
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
}

module.exports = { validateBPMN };
