// src/components/WorkflowPage.js

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/workflowpage.css";
import Web3 from "web3";
import Layout from "./Layout";
import BpmnModeler from "bpmn-js/lib/Modeler";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
const sha256 = require("js-sha256");
const ethers = require("ethers");

const DISPLAY_NAMES = {
  // Models
  "cox_model@2020.py": "Cox Proportional Hazards",
  "kaplan_meier_model@2020.py": "Kaplan-Meier Estimator",
  "xgboost_risk_model@2025.py": "XGBoost",
  "random_survival_forest@2025.py": "Random Survival Forest",
  "mlp_cancer_classifier@2025.py": "Multi-Layer Perceptron (MLP)",
  "lstm_readmission_model@2026.py": "Bidirectional LSTM",
  "google_Health_Cancer_Prediction_Model.py": "Logistic Regression",
  // Datasets
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

const generateDynamicBpmn = (datasets, models) => {
  const ns =
    'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
  let elements = [];
  let flows = [];
  let shapes = [];
  let edges = [];
  let flowId = 1;
  const f = () => `flow_${flowId++}`;
  let y0 = 200; // center y

  // Start event
  elements.push(
    `<bpmn:startEvent id="start" name="Start"><bpmn:outgoing>${f()}</bpmn:outgoing></bpmn:startEvent>`,
  );
  shapes.push(
    `<bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="180" y="${y0 - 18}" width="36" height="36" /></bpmndi:BPMNShape>`,
  );

  let prevId = "start";
  let prevX = 216;
  let lastFlowId = `flow_${flowId - 1}`;

  // Dataset tasks
  if (datasets.length === 1) {
    const tid = "loadDS_0";
    const lbl = displayName(datasets[0]);
    const tx = prevX + 80;
    elements.push(
      `<bpmn:task id="${tid}" name="Load ${lbl}"><bpmn:incoming>${lastFlowId}</bpmn:incoming><bpmn:outgoing>${f()}</bpmn:outgoing></bpmn:task>`,
    );
    flows.push(
      `<bpmn:sequenceFlow id="${lastFlowId}" sourceRef="${prevId}" targetRef="${tid}" />`,
    );
    shapes.push(
      `<bpmndi:BPMNShape id="${tid}_di" bpmnElement="${tid}"><dc:Bounds x="${tx}" y="${y0 - 40}" width="160" height="80" /></bpmndi:BPMNShape>`,
    );
    edges.push(
      `<bpmndi:BPMNEdge id="${lastFlowId}_di" bpmnElement="${lastFlowId}"><di:waypoint x="${prevX}" y="${y0}" /><di:waypoint x="${tx}" y="${y0}" /></bpmndi:BPMNEdge>`,
    );
    prevId = tid;
    prevX = tx + 160;
    lastFlowId = `flow_${flowId - 1}`;
  } else if (datasets.length > 1) {
    // Fork
    const forkId = "dsFork";
    const fx = prevX + 80;
    elements.push(
      `<bpmn:parallelGateway id="${forkId}"><bpmn:incoming>${lastFlowId}</bpmn:incoming>${datasets.map((_, i) => `<bpmn:outgoing>${f()}</bpmn:outgoing>`).join("")}</bpmn:parallelGateway>`,
    );
    flows.push(
      `<bpmn:sequenceFlow id="${lastFlowId}" sourceRef="${prevId}" targetRef="${forkId}" />`,
    );
    shapes.push(
      `<bpmndi:BPMNShape id="${forkId}_di" bpmnElement="${forkId}"><dc:Bounds x="${fx}" y="${y0 - 25}" width="50" height="50" /></bpmndi:BPMNShape>`,
    );
    edges.push(
      `<bpmndi:BPMNEdge id="${lastFlowId}_di" bpmnElement="${lastFlowId}"><di:waypoint x="${prevX}" y="${y0}" /><di:waypoint x="${fx}" y="${y0}" /></bpmndi:BPMNEdge>`,
    );

    const taskX = fx + 100;
    const spacing = 100;
    const startY = y0 - ((datasets.length - 1) * spacing) / 2;
    const joinId = "dsJoin";
    const dsForkFlows = [];

    // Reset flowId tracking for fork outgoing
    const forkOutStart = flowId - datasets.length;

    datasets.forEach((ds, i) => {
      const tid = `loadDS_${i}`;
      const ty = startY + i * spacing;
      const outFlow = f();
      const inFlow = `flow_${forkOutStart + i}`;
      elements.push(
        `<bpmn:task id="${tid}" name="Load ${displayName(ds)}"><bpmn:incoming>${inFlow}</bpmn:incoming><bpmn:outgoing>${outFlow}</bpmn:outgoing></bpmn:task>`,
      );
      flows.push(
        `<bpmn:sequenceFlow id="${inFlow}" sourceRef="${forkId}" targetRef="${tid}" />`,
      );
      dsForkFlows.push(
        `<bpmn:sequenceFlow id="${outFlow}" sourceRef="${tid}" targetRef="${joinId}" />`,
      );
      shapes.push(
        `<bpmndi:BPMNShape id="${tid}_di" bpmnElement="${tid}"><dc:Bounds x="${taskX}" y="${ty - 40}" width="160" height="80" /></bpmndi:BPMNShape>`,
      );
      edges.push(
        `<bpmndi:BPMNEdge id="${inFlow}_di" bpmnElement="${inFlow}"><di:waypoint x="${fx + 50}" y="${y0}" /><di:waypoint x="${taskX}" y="${ty}" /></bpmndi:BPMNEdge>`,
      );
      edges.push(
        `<bpmndi:BPMNEdge id="${outFlow}_di" bpmnElement="${outFlow}"><di:waypoint x="${taskX + 160}" y="${ty}" /><di:waypoint x="${taskX + 210}" y="${y0}" /></bpmndi:BPMNEdge>`,
      );
    });

    // Join
    const jx = taskX + 210;
    elements.push(
      `<bpmn:parallelGateway id="${joinId}"><${datasets.map((_, i) => `bpmn:incoming>flow_${flowId - datasets.length + i}</bpmn:incoming><`).join("")}bpmn:outgoing>${f()}</bpmn:outgoing></bpmn:parallelGateway>`,
    );
    flows.push(...dsForkFlows);
    shapes.push(
      `<bpmndi:BPMNShape id="${joinId}_di" bpmnElement="${joinId}"><dc:Bounds x="${jx}" y="${y0 - 25}" width="50" height="50" /></bpmndi:BPMNShape>`,
    );
    prevId = joinId;
    prevX = jx + 50;
    lastFlowId = `flow_${flowId - 1}`;
  }

  // Model tasks — same pattern
  if (models.length === 1) {
    const tid = "runModel_0";
    const lbl = displayName(models[0]);
    const tx = prevX + 80;
    elements.push(
      `<bpmn:task id="${tid}" name="Run ${lbl}"><bpmn:incoming>${lastFlowId}</bpmn:incoming><bpmn:outgoing>${f()}</bpmn:outgoing></bpmn:task>`,
    );
    flows.push(
      `<bpmn:sequenceFlow id="${lastFlowId}" sourceRef="${prevId}" targetRef="${tid}" />`,
    );
    shapes.push(
      `<bpmndi:BPMNShape id="${tid}_di" bpmnElement="${tid}"><dc:Bounds x="${tx}" y="${y0 - 40}" width="160" height="80" /></bpmndi:BPMNShape>`,
    );
    edges.push(
      `<bpmndi:BPMNEdge id="${lastFlowId}_di" bpmnElement="${lastFlowId}"><di:waypoint x="${prevX}" y="${y0}" /><di:waypoint x="${tx}" y="${y0}" /></bpmndi:BPMNEdge>`,
    );
    prevId = tid;
    prevX = tx + 160;
    lastFlowId = `flow_${flowId - 1}`;
  } else if (models.length > 1) {
    const forkId = "mdlFork";
    const fx = prevX + 80;
    elements.push(
      `<bpmn:parallelGateway id="${forkId}"><bpmn:incoming>${lastFlowId}</bpmn:incoming>${models.map(() => `<bpmn:outgoing>${f()}</bpmn:outgoing>`).join("")}</bpmn:parallelGateway>`,
    );
    flows.push(
      `<bpmn:sequenceFlow id="${lastFlowId}" sourceRef="${prevId}" targetRef="${forkId}" />`,
    );
    shapes.push(
      `<bpmndi:BPMNShape id="${forkId}_di" bpmnElement="${forkId}"><dc:Bounds x="${fx}" y="${y0 - 25}" width="50" height="50" /></bpmndi:BPMNShape>`,
    );
    edges.push(
      `<bpmndi:BPMNEdge id="${lastFlowId}_di" bpmnElement="${lastFlowId}"><di:waypoint x="${prevX}" y="${y0}" /><di:waypoint x="${fx}" y="${y0}" /></bpmndi:BPMNEdge>`,
    );

    const taskX = fx + 100;
    const spacing = 100;
    const startY = y0 - ((models.length - 1) * spacing) / 2;
    const joinId = "mdlJoin";
    const mdlForkFlows = [];
    const forkOutStart = flowId - models.length;

    models.forEach((mdl, i) => {
      const tid = `runModel_${i}`;
      const ty = startY + i * spacing;
      const outFlow = f();
      const inFlow = `flow_${forkOutStart + i}`;
      elements.push(
        `<bpmn:task id="${tid}" name="Run ${displayName(mdl)}"><bpmn:incoming>${inFlow}</bpmn:incoming><bpmn:outgoing>${outFlow}</bpmn:outgoing></bpmn:task>`,
      );
      flows.push(
        `<bpmn:sequenceFlow id="${inFlow}" sourceRef="${forkId}" targetRef="${tid}" />`,
      );
      mdlForkFlows.push(
        `<bpmn:sequenceFlow id="${outFlow}" sourceRef="${tid}" targetRef="${joinId}" />`,
      );
      shapes.push(
        `<bpmndi:BPMNShape id="${tid}_di" bpmnElement="${tid}"><dc:Bounds x="${taskX}" y="${ty - 40}" width="160" height="80" /></bpmndi:BPMNShape>`,
      );
      edges.push(
        `<bpmndi:BPMNEdge id="${inFlow}_di" bpmnElement="${inFlow}"><di:waypoint x="${fx + 50}" y="${y0}" /><di:waypoint x="${taskX}" y="${ty}" /></bpmndi:BPMNEdge>`,
      );
      edges.push(
        `<bpmndi:BPMNEdge id="${outFlow}_di" bpmnElement="${outFlow}"><di:waypoint x="${taskX + 160}" y="${ty}" /><di:waypoint x="${taskX + 210}" y="${y0}" /></bpmndi:BPMNEdge>`,
      );
    });

    const jx = taskX + 210;
    elements.push(
      `<bpmn:parallelGateway id="${joinId}"><${models.map((_, i) => `bpmn:incoming>flow_${flowId - models.length + i}</bpmn:incoming><`).join("")}bpmn:outgoing>${f()}</bpmn:outgoing></bpmn:parallelGateway>`,
    );
    flows.push(...mdlForkFlows);
    shapes.push(
      `<bpmndi:BPMNShape id="${joinId}_di" bpmnElement="${joinId}"><dc:Bounds x="${jx}" y="${y0 - 25}" width="50" height="50" /></bpmndi:BPMNShape>`,
    );
    prevId = joinId;
    prevX = jx + 50;
    lastFlowId = `flow_${flowId - 1}`;
  }

  // End event
  const endX = prevX + 80;
  elements.push(
    `<bpmn:endEvent id="end" name="End"><bpmn:incoming>${lastFlowId}</bpmn:incoming></bpmn:endEvent>`,
  );
  flows.push(
    `<bpmn:sequenceFlow id="${lastFlowId}" sourceRef="${prevId}" targetRef="end" />`,
  );
  shapes.push(
    `<bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="${endX}" y="${y0 - 18}" width="36" height="36" /></bpmndi:BPMNShape>`,
  );
  edges.push(
    `<bpmndi:BPMNEdge id="${lastFlowId}_di" bpmnElement="${lastFlowId}"><di:waypoint x="${prevX}" y="${y0}" /><di:waypoint x="${endX}" y="${y0}" /></bpmndi:BPMNEdge>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${ns} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="dynamicProcess" isExecutable="false">
    ${elements.join("\n    ")}
    ${flows.join("\n    ")}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="dynamicProcess">
      ${shapes.join("\n      ")}
      ${edges.join("\n      ")}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
};

const NODE_URL =
  "REDACTED";
const web3 = new Web3(NODE_URL);

const WorkflowPage = () => {
  const [inputValue, setInputValue] = useState("");
  const [selectedDatasets, setSelectedDatasets] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [selectedComputationalResource, setSelectedComputationalResource] =
    useState("Oracle ML");
  const [fileDetails, setFileDetails] = useState([]);
  const [notification, setNotification] = useState("");
  const [error, setError] = useState(null);
  const [terms, setTerms] = useState([]);
  const [termResponses, setTermResponses] = useState({});
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [currentDataset, setCurrentDataset] = useState(null);
  const [currentDatasetType, setCurrentDatasetType] = useState(""); // New state variable
  const [pdfDatasets, setPdfDatasets] = useState([]);
  const [ipynbModels, setIpynbModels] = useState([]);
  const [datasetAgreementTitle, setDatasetAgreementTitle] = useState("");
  const [datasetAgreementGeneral, setDatasetAgreementGeneral] = useState("");
  const navigate = useNavigate();
  const [workflowError, setWorkflowError] = useState(null);

  const bpmnRef = useRef(null);
  const modelerRef = useRef(null);

  const [modalQueue, setModalQueue] = useState([]);
  const [currentModalIndex, setCurrentModalIndex] = useState(0);

  const [userDetails, setUserDetails] = useState({
    doctorId: "",
    hospitalId: "",
    specialization: "",
    location: "",
    grantId: "",
    experienceYears: "",
    personRole: "",
    designation: "",
    fromNetworks: "",
    department: "",
    certifications: "",
    researchFocus: "",
    authorizedBy: "",
  });

  const [llmSelectedDatasets, setllmSelectedDatasets] = useState([]);
  const [llmSelectedModels, setllmSelectedModels] = useState([]);

  useEffect(() => {
    // Read datasets and models selected by LLM from localStorage
    const datasets =
      JSON.parse(localStorage.getItem("llmSelectedDatasets")) || [];
    const models = JSON.parse(localStorage.getItem("llmSelectedModels")) || [];
    setllmSelectedDatasets(datasets);
    setllmSelectedModels(models);

    // Auto-populate selections so user doesn't have to re-select manually
    if (datasets.length > 0) {
      setSelectedDatasets((prev) => {
        const merged = [...new Set([...prev, ...datasets])];
        return merged;
      });
    }
    if (models.length > 0) {
      setSelectedModels((prev) => {
        const merged = [...new Set([...prev, ...models])];
        return merged;
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    modelerRef.current = new BpmnModeler({
      container: bpmnRef.current,
      height: 600,
      width: "100%",
      keyboard: {
        bindTo: document,
      },
    });

    const timer = setTimeout(() => {
      if (!cancelled) {
        requestAnimationFrame(() => {
          if (!cancelled) updateBPMN();
        });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (modelerRef.current) {
        modelerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (!modelerRef.current) return;
    try {
      modelerRef.current.get("canvas");
      updateBPMN();
    } catch (e) {
      // Canvas not ready yet — initial mount will handle it
    }
  }, [selectedModels, selectedDatasets]);

  useEffect(() => {
    async function fetchDatasets() {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/getAllDatasets`,
        );
        const datasets = response.data;
        console.log("data is : ", datasets);
        const pdfs = datasets.filter(
          (dataset) =>
            dataset.endsWith(".pdf") ||
            dataset.endsWith(".xlsx") ||
            dataset.endsWith(".csv"),
        );
        const ipynbs = datasets.filter(
          (dataset) => dataset.endsWith(".ipynb") || dataset.endsWith(".py"),
        );
        setPdfDatasets(pdfs);
        setIpynbModels(ipynbs);
      } catch (error) {
        console.error("Error fetching datasets:", error);
      }
    }

    fetchDatasets();
  }, []);

  const updateBPMN = async () => {
    // Use current selections (either from LLM auto-populate or manual changes)
    const datasets =
      selectedDatasets.length > 0
        ? selectedDatasets
        : JSON.parse(localStorage.getItem("llmSelectedDatasets") || "[]");
    const models =
      selectedModels.length > 0
        ? selectedModels
        : JSON.parse(localStorage.getItem("llmSelectedModels") || "[]");

    if (datasets.length === 0 && models.length === 0) {
      try {
        const response = await fetch("/default_diagram.xml");
        const xml = await response.text();
        await modelerRef.current.importXML(xml);
        modelerRef.current.get("canvas").zoom("fit-viewport");
      } catch (err) {
        console.error("Error loading default diagram:", err);
      }
      return;
    }

    try {
      const xml = generateDynamicBpmn(datasets, models);
      await modelerRef.current.importXML(xml);
      modelerRef.current.get("canvas").zoom("fit-viewport");
      console.log(
        "✅ Dynamic BPMN loaded with",
        datasets.length,
        "datasets,",
        models.length,
        "models",
      );
    } catch (err) {
      console.error("Error loading dynamic BPMN:", err);
    }
  };

  function removeFileExtension(filename) {
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return filename;
    } else {
      return filename.substring(0, lastDotIndex);
    }
  }

  const updateFileUrl = (fileName, fileUrl) => {
    setFileDetails((prevDetails) =>
      prevDetails.map((file) =>
        file.fileName === fileName
          ? { ...file, details: { ...file.details, fileUrl } }
          : file,
      ),
    );
  };

  const updateFileTxnHash = (fileName, txnHash) => {
    setFileDetails((prevDetails) =>
      prevDetails.map((file) =>
        file.fileName === fileName
          ? { ...file, details: { ...file.details, txnHash } }
          : file,
      ),
    );
  };

  const updateFileTxnResult = (fileName, txnRawResult) => {
    setFileDetails((prevDetails) =>
      prevDetails.map((file) =>
        file.fileName === fileName
          ? { ...file, details: { ...file.details, txnRawResult } }
          : file,
      ),
    );
  };

  const getUserSecretDetails = async () => {
    try {
      const authToken = localStorage.getItem("authToken");
      if (!authToken) {
        throw new Error("Authentication token not found. Please log in.");
      }
      const credentials = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/individuals/${inputValue}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      return credentials.data;
    } catch (error) {
      console.log(error);
      return null;
    }
  };

  const getPolicyDetails = async (fileName, flag) => {
    try {
      let response = "";
      response = await axios.get(
        `${process.env.REACT_APP_API_URL}/getPolicy/${removeFileExtension(fileName)}`,
      );

      if (response.status !== 200) {
        throw new Error("Policy not found");
      }
      const { newContractAddress, abi, argv, permissionFunction, terms } =
        response.data;

      if (flag) {
        if (terms.datasetAgreementTitle) {
          setDatasetAgreementTitle(terms.datasetAgreementTitle);
        }
        if (terms.datasetAgreementGeneral) {
          setDatasetAgreementGeneral(terms.datasetAgreementGeneral);
        }

        const termsArray = Object.entries(terms)
          .filter(([key]) => key.startsWith("term"))
          .map(([key, value]) => ({ term: key, description: value }));

        setTerms(termsArray);
        setTermResponses((prevResponses) => ({
          ...prevResponses,
          [fileName]: new Array(termsArray.length).fill(null),
        }));
        setCurrentDataset(fileName);
        setShowTermsModal(true);
      }

      return response.data;
    } catch (error) {
      console.error("Error fetching policy:", error);
      throw error;
    }
  };

  const callSmartContractWithtxn = async (
    contractAddress,
    contractABI,
    functionName,
    args,
  ) => {
    try {
      console.log("args are : ", args);
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const web3 = new Web3(window.ethereum);
      const contract = new web3.eth.Contract(contractABI, contractAddress);
      const accounts = await web3.eth.getAccounts();
      const fromAccount = accounts[0];
      const method = contract.methods[functionName](...args);
      const gas = await method.estimateGas({ from: fromAccount });
      const result = await method.send({ from: fromAccount, gas });
      console.log(result);
      return result;
    } catch (error) {
      console.error("Error calling contract function:", error);
      throw error;
    }
  };

  const getSignedDetails = async (argv, termArr) => {
    try {
      let authToken = getAuthToken();
      const signedCredentials = await axios.get(
        `${process.env.REACT_APP_API_URL}/getSignedDetails/${inputValue}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            Argv: argv,
            terms: termArr,
          },
        },
      );
      const individualDetails = signedCredentials.data.individualDetails;
      const detailsArray = Object.values(individualDetails);

      console.log("Signed details array:", detailsArray);
      console.log("Signature:", signedCredentials.data.signature);
      detailsArray.push(signedCredentials.data.signature);
      return detailsArray;
    } catch (error) {
      console.error("Error in retrieving signed details: ", error);
    }
  };

  const handleInputChange = (event) => {
    setInputValue(event.target.value);
  };

  function getAuthToken() {
    return localStorage.getItem("authToken");
  }

  const handleDatasetSelect = async (event) => {
    const value = event.target.value;
    if (!selectedDatasets.includes(value)) {
      setSelectedDatasets([...selectedDatasets, value]);
      setCurrentDatasetType("dataset"); // Set currentDatasetType to 'dataset'
      // await getPolicyDetails(value, true);
    }
  };

  const handleModelSelect = async (event) => {
    const value = event.target.value;
    if (!selectedModels.includes(value)) {
      setSelectedModels([...selectedModels, value]);
      setCurrentDatasetType("model"); // Set currentDatasetType to 'model'
      // await getPolicyDetails(value, true);
    }
  };

  const newhandleDatasetSelect = async (name) => {
    await getPolicyDetails(name, true);
  };

  const newhandleModelSelect = async (name) => {
    await getPolicyDetails(name, true);
  };

  const handleComputationalResourceSelect = (event) => {
    setSelectedComputationalResource(event.target.value);
  };

  const removeDataset = (dataset) => {
    setSelectedDatasets(selectedDatasets.filter((d) => d !== dataset));
  };

  const removeModel = (model) => {
    setSelectedModels(selectedModels.filter((m) => m !== model));
  };

  const handleTermResponse = (termDescription, index, response) => {
    const updatedResponses = { ...termResponses };
    let finalResponse = response + ":" + sha256(termDescription);
    updatedResponses[currentDataset][index] = finalResponse;
    setTermResponses(updatedResponses);
  };

  const handleTermsSubmit = async () => {
    setShowTermsModal(false);
    setCurrentDataset(null);
    setCurrentDatasetType(""); // Reset currentDatasetType
    console.log("Terms responses: ", termResponses);
    setShowTermsModal(false);
    await proceedToNextModal();
  };

  // New function to handle modal close and remove selection
  const handleModalClose = async () => {
    setShowTermsModal(false);
    if (currentDatasetType === "dataset") {
      setSelectedDatasets(selectedDatasets.filter((d) => d !== currentDataset));
    } else if (currentDatasetType === "model") {
      setSelectedModels(selectedModels.filter((m) => m !== currentDataset));
    }
    setCurrentDataset(null);
    setCurrentDatasetType("");
  };

  const fileDetailsHandler = (
    fileName,
    newContractAddress,
    abi,
    argv,
    mypermissionFunction,
  ) => {
    const details = {
      address: newContractAddress,
      permissionFunction: mypermissionFunction,
      arguments: argv,
      terms: termResponses[fileName], // Add terms to file details
      contractAbi: abi,
      signedDetails: "",
      fileUrl: "",
      txnHash: "",
      blockHash: "",
      txnRawResult: "",
    };
    setFileDetails((prevDetails) => [...prevDetails, { fileName, details }]);
  };

  const updateSignedDetails = (fileName, signedDetails) => {
    setFileDetails((prevDetails) =>
      prevDetails.map((file) =>
        file.fileName === fileName
          ? { ...file, details: { ...file.details, signedDetails } }
          : file,
      ),
    );
  };

  const callSmartContractWithTxn = async (
    contractAddress,
    contractABI,
    functionName,
    args,
  ) => {
    return { success: true, decision: true };
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const processNextModal = async (fileName) => {
    try {
      const response = await getPolicyDetails(fileName, true);
      // The getPolicyDetails function will set up the modal content
      setCurrentDataset(fileName);
      setShowTermsModal(true);
    } catch (error) {
      console.error("Error processing modal:", error);
      // Handle error (e.g., skip to the next item)
      proceedToNextModal();
    }
  };

  const proceedToNextModal = async () => {
    const nextIndex = currentModalIndex + 1;
    if (nextIndex < modalQueue.length) {
      setCurrentModalIndex(nextIndex);
      await processNextModal(modalQueue[nextIndex]);
    } else {
      // All modals have been processed, proceed with submission
      setShowTermsModal(false);
      // Your submission logic here
    }
  };

  const handleTermsFinalSubmit = async () => {
    // Combine datasets and models into a single queue
    const combinedQueue = [...selectedDatasets, ...selectedModels];
    setModalQueue(combinedQueue);
    setCurrentModalIndex(0);

    // Start processing the first item in the queue
    if (combinedQueue.length > 0) {
      await processNextModal(combinedQueue[0]);
    }
  };

  const handleSubmit = async () => {
    // Clear previous notifications and errors at the start of a new submission
    setNotification("");
    setError(null);
    setWorkflowError(null);
    if (
      !inputValue ||
      (selectedDatasets.length === 0 && selectedModels.length === 0) ||
      !selectedComputationalResource
    ) {
      setError(
        "Username, Datasets, Models, and Computational Resource must be selected.",
      );
      return;
    }
    setError(null);
    setWorkflowError(null);

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== "0xaa36a7") {
      // 0xaa36a7 = Sepolia
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    }

    try {
      setFileDetails([]);
      let userCreds = await getUserSecretDetails();
      if (userCreds == null) {
        throw new Error("Authentication token not found. Please log in.");
      } else {
        const {
          doctorId,
          hospitalId,
          specialization,
          accessRights,
          location,
          grantId,
          experienceYears,
          personRole,
          designation,
          fromNetworks,
          department,
          certifications,
          researchFocus,
          authorizedBy,
        } = userCreds;
        setUserDetails({
          doctorId,
          hospitalId,
          specialization,
          location,
          grantId,
          experienceYears,
          personRole,
          designation,
          fromNetworks,
          department,
          certifications,
          researchFocus,
          authorizedBy,
        });
      }

      for (const fileName of [...selectedDatasets, ...selectedModels]) {
        let { newContractAddress, abi, argv, permissionFunction } =
          await getPolicyDetails(fileName, false);
        fileDetailsHandler(
          fileName,
          newContractAddress,
          abi,
          argv,
          permissionFunction,
        );

        await sleep(4000);

        let termArr = [];
        let responses = termResponses[fileName];
        if (responses) {
          let terms = Object.values(responses);
          console.log("Terms: ", terms);
          for (let i = 0; i < terms.length; i++) {
            termArr.push(terms[i]);
          }
        }
        let finalArr = [];
        let signedArgv = await getSignedDetails(argv, termArr);
        console.log(
          "Signed argv with the term responses & conditions are : ",
          signedArgv,
        );
        let signedArgvCopy = signedArgv.slice();
        updateSignedDetails(fileName, signedArgvCopy);
        const Signature = signedArgv.pop();
        finalArr.push(signedArgv);

        finalArr.unshift(fileName);

        if (responses) {
          let sortedIndices = Object.keys(responses).sort((a, b) => a - b);

          sortedIndices.forEach((index) => {
            finalArr.push(responses[index]);
          });
        }
        finalArr.push(Signature);

        const receipt = await callSmartContractWithtxn(
          newContractAddress,
          abi,
          permissionFunction,
          finalArr,
        );
        console.log("receipt for txn: ");
        console.log(receipt);

        let txnResult = web3.eth.abi.decodeParameter(
          "string",
          receipt.logs[0].data,
        );

        updateFileUrl(
          fileName,
          `https://sepolia.etherscan.io/address/${newContractAddress}`,
        );
        updateFileTxnHash(fileName, receipt.transactionHash);
        updateFileTxnResult(fileName, txnResult);

        const segments = txnResult.split("--");
        console.log("segments are : ", segments);

        let decision = segments[0].trim();
        console.log("decision is ", decision);
        decision = decision.split(":")[1].trim();
        if (decision === "true") {
          setNotification(
            `Smart Contract's Access Policy's Result for ${fileName} is Permit`,
          );
        } else {
          setNotification(
            `Smart Contract's Access Policy's Result for ${fileName} is Denied`,
          );
          throw new Error(
            `WorkFlow failed by the smart contract for the file: ${fileName}`,
          );
        }
      }
      await sleep(5000);
      console.log("Selected files are : ", [
        ...selectedDatasets,
        ...selectedModels,
      ]);
      for (const fileName of [...selectedDatasets, ...selectedModels]) {
        await window.ethereum.request({ method: "eth_requestAccounts" });
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const publicKeyAddress = await signer.getAddress();
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/files/${fileName.toLowerCase()}`,
          {
            headers: {
              Authorization: `Bearer ${getAuthToken()}`,
              PublicKey: publicKeyAddress,
              docID: inputValue,
              datasetID: fileName,
            },
            responseType: "blob",
          },
        );

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      setNotification("Workflow satisfied");

      // Check if both a model and a dataset are selected
      if (selectedModels.length > 0 && selectedDatasets.length > 0) {
        // Store data in localStorage
        // Clear the selected models and datasets when changing workflows
        if (
          localStorage.getItem("selectedModels") ||
          localStorage.getItem("selectedDatasets")
        ) {
          localStorage.removeItem("selectedModels");
          localStorage.removeItem("selectedDatasets");
        }
        localStorage.setItem("selectedModels", JSON.stringify(selectedModels));
        localStorage.setItem(
          "selectedDatasets",
          JSON.stringify(selectedDatasets),
        );

        const url = `${window.location.origin}/workflowmanipulation`;

        // Open the URL in a new tab
        window.open(url, "_blank");
      } else {
        setWorkflowError("Workflow manipulation conditions not met");
      }
    } catch (error) {
      setNotification("Workflow Not Satisfied!");
      console.error(error);
    }
  };

  return (
    <Layout>
      <div className="WorkflowPageContainer">
        {/* Display LLM selected models and datasets */}
        {(llmSelectedDatasets.length > 0 || llmSelectedModels.length > 0) && (
          <div className="llm-selected-items">
            {llmSelectedDatasets.length > 0 && (
              <div className="selected-section">
                <h3>LLM Suggested Datasets</h3>
                <div className="selected-datasets">
                  {llmSelectedDatasets.map((dataset, index) => (
                    <span key={index} className="dataset-chip">
                      {dataset}{" "}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {llmSelectedModels.length > 0 && (
              <div className="selected-section">
                <h3>LLM Suggested Models</h3>
                <div className="selected-models">
                  {llmSelectedModels.map((model, index) => (
                    <span key={index} className="dataset-chip">
                      {model}{" "}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <section className="user-details">
          <h2>User Details</h2>
          <div className="details-grid">
            <div>
              <strong>Doctor ID:</strong> {userDetails.doctorId}
            </div>
            <div>
              <strong>Hospital ID:</strong> {userDetails.hospitalId}
            </div>
            <div>
              <strong>Specialization:</strong> {userDetails.specialization}
            </div>
            <div>
              <strong>Location:</strong> {userDetails.location}
            </div>
            <div>
              <strong>Grant ID:</strong> {userDetails.grantId}
            </div>
            <div>
              <strong>Experience Years:</strong> {userDetails.experienceYears}
            </div>
            <div>
              <strong>Person Role:</strong> {userDetails.personRole}
            </div>
            <div>
              <strong>Designation:</strong> {userDetails.designation}
            </div>
            <div>
              <strong>From Networks:</strong> {userDetails.fromNetworks}
            </div>
            <div>
              <strong>Department:</strong> {userDetails.department}
            </div>
            <div>
              <strong>Certifications:</strong> {userDetails.certifications}
            </div>
            <div>
              <strong>Research Focus:</strong> {userDetails.researchFocus}
            </div>
            <div>
              <strong>Authorized By:</strong> {userDetails.authorizedBy}
            </div>
            <div>
              <strong>PDF Datasets:</strong> {pdfDatasets.length}
            </div>
            <div>
              <strong>ML Models:</strong> {ipynbModels.length}
            </div>
          </div>
        </section>
        <section className="workflow-select-container">
          <div className="input-group">
            <label htmlFor="username" className="input-label">
              Username:
            </label>
            <input
              type="text"
              id="username"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="Enter your username"
              className="input-field"
            />
          </div>

          {/* Computational Resource Selection */}
          <div className="input-group">
            <label htmlFor="computational-resource" className="input-label">
              Computational Resource:
            </label>
            <div
              className="input-field"
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "default",
              }}
            >
              Oracle ML
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="models" className="input-label">
              Available Models:
            </label>
            <select
              id="models"
              multiple
              value={selectedModels}
              onChange={handleModelSelect}
              className="input-field"
            >
              {ipynbModels.map((model, index) => (
                <option key={index} value={model}>
                  {displayName(model)}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label htmlFor="datasets" className="input-label">
              Available Datasets:
            </label>
            <select
              id="datasets"
              multiple
              value={selectedDatasets}
              onChange={handleDatasetSelect}
              className="input-field"
            >
              {pdfDatasets.map((dataset, index) => (
                <option key={index} value={dataset}>
                  {displayName(dataset)}
                </option>
              ))}
            </select>
          </div>

          <div className="selected-items">
            <div className="selected-section">
              <h3>Selected Datasets</h3>
              <div className="selected-datasets">
                {selectedDatasets.map((dataset, index) => (
                  <span key={index} className="dataset-chip">
                    <span onClick={() => newhandleDatasetSelect(dataset)}>
                      {displayName(dataset)}{" "}
                    </span>
                    <button onClick={() => removeDataset(dataset)}>×</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="selected-section">
              <h3>Selected Models</h3>
              <div className="selected-models">
                {selectedModels.map((model, index) => (
                  <span key={index} className="dataset-chip">
                    <div onClick={() => newhandleModelSelect(model)}>
                      {displayName(model)}{" "}
                    </div>
                    <button onClick={() => removeModel(model)}>×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Add BPMN Diagram Container here */}
          <div
            className="bpmn-diagram-container"
            style={{ marginTop: "20px", marginBottom: "20px" }}
          >
            <div
              ref={bpmnRef}
              style={{
                width: "100%",
                height: "600px",
                border: "1px solid #ccc",
                borderRadius: "8px",
              }}
            ></div>
          </div>

          <button className="submit-button" onClick={handleTermsFinalSubmit}>
            Accept Policies
          </button>

          <button className="submit-button" onClick={handleSubmit}>
            Submit
          </button>
        </section>

        {/* Summary Section for Computational Resource */}
        {selectedComputationalResource && (
          <section className="computational-resource-summary">
            <h2>Selected Computational Resource</h2>
            <p>{selectedComputationalResource}</p>
          </section>
        )}

        {/* File Details */}
        {fileDetails.map((file, index) => (
          <div key={index} className="file-details">
            <h3>File: {file.fileName}</h3>
            <p>
              <strong>Contract Address:</strong> {file.details.address}
            </p>
            <p>
              <strong>Permission Function:</strong>{" "}
              {file.details.permissionFunction}
            </p>
            <p>
              <strong>Arguments:</strong> {file.details.arguments}
            </p>
            <p>
              <strong>Terms And Conditions:</strong>{" "}
            </p>
            <div className="terms-results">
              {file.details.terms &&
                file.details.terms.map((term, idx) => (
                  <p key={idx} className="term-result">
                    {term.split(":")[0]}: {term.split(":")[1]}
                  </p>
                ))}
            </div>
            <p className="signed-details">
              <strong>
                Signed Details from Trusted Authorized Organization:
              </strong>{" "}
              {JSON.stringify(file.details.signedDetails)}
            </p>
            {file.details.fileUrl && (
              <p>
                <strong>Transaction URL:</strong>{" "}
                <a
                  href={file.details.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {file.details.fileUrl}
                </a>
              </p>
            )}
            {file.details.txnHash && (
              <p>
                <strong>Transaction Hash:</strong> {file.details.txnHash}
              </p>
            )}
            {file.details.txnRawResult && (
              <p>
                <strong>Transaction Event Result:</strong>{" "}
                {file.details.txnRawResult}
              </p>
            )}
          </div>
        ))}

        {/* Notifications */}
        {notification && <p className="notification-message">{notification}</p>}
        {error && <p className="notification-message error-message">{error}</p>}
        {workflowError && (
          <p className="notification-message error-message">{workflowError}</p>
        )}

        {/* Terms Modal */}
        {showTermsModal && (
          <div className="terms-modal">
            <div className="terms-modal-content">
              {/* Close Button */}
              <button
                className="modal-close-button"
                onClick={handleModalClose}
                aria-label="Close"
              >
                &times;
              </button>

              <h2>DATA USAGE AGREEMENT</h2>
              <p className="terms-intro">
                <strong>{datasetAgreementTitle}</strong>
                <br />
                {datasetAgreementGeneral}
                <br />
                To access the following file, you need to comply with the file
                data usage agreement below:
              </p>
              {terms.map((term, index) => (
                <div key={index} className="term">
                  <p>{term.description}</p>
                  <button
                    className={`button-yes ${
                      termResponses[currentDataset] &&
                      termResponses[currentDataset][index]?.startsWith("yes")
                        ? "selected"
                        : ""
                    }`}
                    onClick={() =>
                      handleTermResponse(term.description, index, "yes")
                    }
                  >
                    Yes
                  </button>
                  <button
                    className={`button-no ${
                      termResponses[currentDataset] &&
                      termResponses[currentDataset][index]?.startsWith("no")
                        ? "selected"
                        : ""
                    }`}
                    onClick={() =>
                      handleTermResponse(term.description, index, "no")
                    }
                  >
                    No
                  </button>
                </div>
              ))}
              <button
                onClick={handleTermsSubmit}
                disabled={termResponses[currentDataset]?.includes(null)}
                className="modal-submit-button"
              >
                Submit Responses
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default WorkflowPage;
