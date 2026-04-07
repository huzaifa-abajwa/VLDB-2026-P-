# VLDB-2026-P-

A platform for governance-aware, policy-compliant healthcare data analytics. Users describe analytical goals in plain English, and the system generates executable workflows — with every data access verified on-chain via smart contracts and XACML policies.

**Paper:** *Demo: Governance-Aware Generation of Policy-Compliant Data Analytics Workflows* (VLDB 2026)

**Supervisors:** Dr. Basit Shafiq (LUMS), Dr. Jaideep Vaidya (Rutgers)

**Authors:** Huzaifa Ahmad, Ibrahim Murtaza, Muhammad Ali Hassan

---

## What It Does

1. **Decentralized Access Control** — Ethereum smart contracts enforce XACML attribute-based policies. Every access request is verified on-chain and immutably logged.
2. **LLM-Powered Workflow Generation** — Users type natural language queries (e.g., *"analyze cancer survival by age group"*). A RAG-augmented LLM (Gemini 2.5 Pro) generates policy-compliant BPMN workflows.
3. **Automated Model Execution** — The platform runs ML models (survival analysis, readmission prediction, cross-race comparison) and returns results with visualizations.
4. **Multi-Layer Validation** — A hybrid RAG + programmatic validation pipeline ensures 0% hallucination and 100% policy compliance in generated workflows.

---

## Deployed Website

**URL:** `https://84.235.241.150`

> On first visit, your browser will warn about a self-signed SSL certificate. Accept the warning to proceed. You must also accept the certificate for the backend at `https://84.235.241.150:3001/getAllDatasets`.

### Prerequisites

- **MetaMask** browser extension installed and connected to the **Sepolia testnet**
- Use one of the test accounts below (new signups cannot pass blockchain verification without pre-seeded credentials)

### Test Accounts

| Username | Password | Access |
|----------|----------|--------|
| `admin` | `*********` | SEER Cancer Registry (USA) — Cox, Kaplan-Meier, XGBoost, RSF, MLP |
| `ibr123` | `123` | German + Pakistani Cancer Registries — Cox, Kaplan-Meier, XGBoost, RSF, MLP |
| `mike123` | `123` | UCI Diabetes Readmission + 4 race-split datasets — XGBoost, RSF, MLP, LSTM |
| `priya123` | `123` | Sylhet + Pima Diabetes — XGBoost, RSF, MLP |
| `sarah123` | `123` | Heart Failure Clinical Records — Logistic Regression |

### Step-by-Step Usage

1. **Login** — Enter credentials from the table above.

2. **LLM Page** — Type a natural language query describing your analysis goal. Examples:
   - *"Compare cancer survival rates between German and Pakistani registries using Cox and Kaplan-Meier"*
   - *"Predict hospital readmission across racial groups using XGBoost"*
   - *"Analyze diabetes diagnosis using Pima Indians dataset with MLP"*

   The LLM suggests appropriate datasets and models based on your query and permissions.

3. **Workflow Page** — Review the generated BPMN workflow diagram. Your credentials are displayed and verified against smart contracts on Sepolia. You must:
   - Click **Accept Policies** to agree to the data use terms
   - Click **Submit** to trigger on-chain verification via MetaMask
   - Confirm the transaction in MetaMask

4. **Workflow Manipulation** — After verification succeeds:
   - Select datasets and models from the approved list
   - Optionally apply filters (age range, grade, etc.) for cancer datasets
   - Click **Run Workflow** to execute the model
   - View results: metrics tables, survival curves, probability plots, cross-race comparisons

### Notes

- **Cross-race mode** activates automatically when multiple race-split UCI datasets are selected with `mike123`. Training the LSTM on all 4 races can take 15–25 minutes on the server.
- **Cancer survival models** (Cox, Kaplan-Meier) support filter-based subgroup analysis (age, grade, race).
- Each user can only access datasets/models their `grantId` is authorized for. Unauthorized combinations will be denied by the smart contract.

### Sample Prompts (UCI Diabetes Readmission — login as `mike123`)

**Cross-race comparison (uses 4 race-split CSVs):**
- *"Compare readmission probability across racial groups using XGBoost"*
- *"Analyze how readmission rates differ between African American and Caucasian patients using MLP"*
- *"Use LSTM to predict readmission across all racial subgroups"*

**Standard readmission prediction (uses UCI diabetic dataset):**
- *"Predict hospital readmission for diabetic patients using XGBoost"*
- *"Classify readmission risk with MLP on the UCI diabetes dataset"*
- *"Use LSTM to model sequential readmission patterns in diabetic patients"*

> **Tip:** Cross-race mode activates when the LLM selects multiple race-split datasets (e.g., `UCI_AfricanAmerican_Readmission`, `UCI_Caucasian_Readmission`). Standard mode activates when only `UCI_diabetic_dataset` is selected. The LLM decides which datasets to use based on your prompt wording.

---

## Architecture

```
React Frontend → Node.js/Express Backend → Flask RAG API
                       ↓                        ↓
              MongoDB Atlas              Pinecone Vector DB
              Ethereum Sepolia           (CodeBERT embeddings)
              (18 Smart Contracts)
```

### Tech Stack

- **Frontend:** React.js, BPMN.js
- **Backend:** Node.js, Express, Web3.js
- **RAG Pipeline:** Flask, Pinecone, Gemini 2.5 Pro (via OpenRouter)
- **Blockchain:** Solidity, Hardhat, Ethereum Sepolia testnet
- **ML Models:** Python (scikit-survival, lifelines, TensorFlow/Keras, XGBoost)
- **Database:** MongoDB Atlas
- **Access Control:** XACML attribute-based policies compiled into smart contracts

### Datasets

| Dataset | Records | Domain |
|---------|---------|--------|
| SEER Cancer Registry (USA) | 430,796 | Cancer survival |
| German Cancer Registry | 686 | Cancer survival |
| National Cancer Registry of Pakistan | 686 | Cancer survival |
| UCI 130-US Hospitals Diabetes | 101,766 | Readmission prediction |
| Sylhet Diabetes Hospital (Bangladesh) | 251 | Diabetes diagnosis |
| Pima Indians Diabetes (USA) | 768 | Diabetes diagnosis |
| UCI Race-Split Readmission (4 files) | ~98K total | Cross-race readmission |

### Models

| Model | Type | Domains |
|-------|------|---------|
| Cox Proportional Hazards | Survival | Cancer |
| Kaplan-Meier Estimator | Survival | Cancer |
| XGBoost | Classification | Cancer, readmission, diagnosis, cross-race |
| Random Survival Forest | Survival/Classification | Cancer, diagnosis |
| MLP | Classification | Cancer, readmission, diagnosis, cross-race |
| Bidirectional LSTM | Sequential classification | Readmission, cross-race |
| Logistic Regression | Classification | Cancer |

---

