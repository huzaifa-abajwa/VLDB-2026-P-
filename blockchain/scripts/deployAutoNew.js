const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { exec } = require("child_process");

const contractDir = path.join(__dirname, "../contracts");

// Maps contract name (inside .sol) → original DB name
// Contract name = filename without "smart-contract-" prefix and without ".sol"
const NAME_MAP = {
  "SEER_Cancer_Registry_of_USA":            "SEER_Cancer_Registry_of_USA",
  "German_Cancer_registry_2020":            "German_Cancer_registry@2020",
  "National_Cancer_Registry_of_Pakistan":   "National_Cancer_Registry_of_Pakistan",
  "UCI_diabetic_dataset":                   "UCI_diabetic_dataset",
  "Sylhet_Diabetes_Hospital_Bangladesh":    "Sylhet_Diabetes_Hospital_Bangladesh",
  "Pima_Indians_Diabetes_USA":              "Pima_Indians_Diabetes_USA",
  "heart_failure_clinical_records_dataset": "heart_failure_clinical_records_dataset",
  "cox_model_2020":                         "cox_model@2020",
  "kaplan_meier_model_2020":                "kaplan_meier_model@2020",
  "xgboost_risk_model_2025":                "xgboost_risk_model@2025",
  "random_survival_forest_2025":            "random_survival_forest@2025",
  "mlp_cancer_classifier_2025":             "mlp_cancer_classifier@2025",
  "lstm_readmission_model_2026":            "lstm_readmission_model@2026",
  "google_Health_Cancer_Prediction_Model":  "google_Health_Cancer_Prediction_Model",
  "UCI_AfricanAmerican_Readmission":        "UCI_AfricanAmerican_Readmission",
  "UCI_Caucasian_Readmission":              "UCI_Caucasian_Readmission",
  "UCI_Hispanic_Readmission":               "UCI_Hispanic_Readmission",
  "UCI_Asian_Readmission":                  "UCI_Asian_Readmission",
};

async function compile() {
  console.log("\x1b[33m%s\x1b[0m", "Compiling contracts...");
  return new Promise((resolve, reject) => {
    exec("npx hardhat compile", (error, stdout, stderr) => {
      if (error) { console.error("Compilation error:", error.message); reject(error); }
      else { console.log(stdout || "Compilation complete"); resolve(); }
    });
  });
}

async function deployContract(fileName) {
  // fileName e.g. "smart-contract-cox_model_2020.sol"
  // contractName = the name inside the .sol file = "cox_model_2020"
  const contractName = fileName.replace("smart-contract-", "").replace(".sol", "");
  const originalName = NAME_MAP[contractName];

  if (!originalName) {
    console.log(`\x1b[90mSkipping (not in name map): ${fileName}\x1b[0m`);
    return null;
  }

  console.log(`\nDeploying: ${originalName} (contract: ${contractName})`);

  // Use contractName (matches `contract X {` inside the .sol file)
  const ContractFactory = await ethers.getContractFactory(contractName);
  const contract = await ContractFactory.deploy();
  await contract.deployed();

  console.log(`\x1b[32m  ✅ ${originalName} → ${contract.address}\x1b[0m`);
  return { originalName, address: contract.address };
}

async function main() {
  console.log("\x1b[34m%s\x1b[0m", "=".repeat(60));
  console.log("\x1b[34m%s\x1b[0m", "  VLDB-2026 Contract Deployment");
  console.log("\x1b[34m%s\x1b[0m", "=".repeat(60));

  await compile();

  const files = fs.readdirSync(contractDir);
  // Only deploy our generated contracts
  const solFiles = files.filter(f => f.endsWith(".sol") && f.startsWith("smart-contract-"));
  console.log(`\nFound ${solFiles.length} smart-contract-*.sol files\n`);

  const results = [];

  for (const file of solFiles) {
    try {
      const result = await deployContract(file);
      if (result) results.push(result);
    } catch (err) {
      console.error(`\x1b[31m  ❌ Failed: ${file}\n     ${err.message}\x1b[0m`);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "\x1b[32m" + "=".repeat(60));
  console.log(`  DONE — ${results.length}/14 contracts deployed`);
  console.log("=".repeat(60) + "\x1b[0m\n");

  results.forEach(({ originalName, address }) => {
    console.log(`  \x1b[36m${originalName}\x1b[0m`);
    console.log(`  \x1b[33m${address}\x1b[0m\n`);
  });

  console.log("\x1b[35m--- JSON for seed script ---\x1b[0m");
  console.log(JSON.stringify(
    results.map(r => ({ name: r.originalName, address: r.address })),
    null, 2
  ));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});