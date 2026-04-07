import os
import re

import torch
from dotenv import load_dotenv
from pinecone import Pinecone
from transformers import AutoModel, AutoTokenizer

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
contract_index = pc.Index("smart-contracts")

tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base")
model = AutoModel.from_pretrained("microsoft/codebert-base")


def text_to_vector(text):
    tokens = tokenizer(
        text, return_tensors="pt", padding=True, truncation=True, max_length=512
    )
    with torch.no_grad():
        outputs = model(**tokens)
    return outputs.last_hidden_state.mean(dim=1).squeeze().tolist()


def parse_solidity_contract(sol_path):
    """Extract key info from Solidity smart contract"""
    with open(sol_path, "r") as f:
        code = f.read()

    contract_data = {
        "contract_name": "",
        "required_params": [],
        "policy_fields": [],
        "evaluate_logic": "",
    }

    # Extract contract name
    contract_match = re.search(r"contract\s+(\w+)", code)
    if contract_match:
        contract_data["contract_name"] = contract_match.group(1)

    # Extract getPolicy return value (required fields)
    policy_match = re.search(r'return\s+"([^"]+)"', code)
    if policy_match:
        contract_data["required_params"] = policy_match.group(1).split(",")

    # Extract datasetPolicies mapping
    policy_fields = re.findall(r'datasetPolicies\["(\w+)"\]\s*=\s*"([^"]+)"', code)
    contract_data["policy_fields"] = policy_fields

    # Extract evaluate function logic (simplified)
    evaluate_match = re.search(r"function evaluate\((.*?)\)", code, re.DOTALL)
    if evaluate_match:
        contract_data["evaluate_logic"] = evaluate_match.group(1)

    return contract_data


def create_contract_summary(contract_data, filename):
    """Create natural language summary"""
    summary = f"""Smart Contract: {contract_data['contract_name']} ({filename})

Required Input Parameters: {', '.join(contract_data['required_params'])}

Policy Constraints:
"""

    for field, value in contract_data["policy_fields"]:
        summary += f"- {field}: {value}\n"

    summary += f"\nThis contract enforces access control for datasets. "
    summary += f"Users must provide: {', '.join(contract_data['required_params'])}. "
    summary += (
        f"The evaluate() function verifies these parameters against stored policies."
    )

    return summary


def index_all_smart_contracts():
    """Index all deployed smart contracts"""
    contract_dir = "../../blockchain/contracts"

    ALLOWED_ASSETS = {
        "smart-contract-SEER_Cancer_Registry_of_USA",
        "smart-contract-German_Cancer_registry_2020",
        "smart-contract-National_Cancer_Registry_of_Pakistan",
        "smart-contract-UCI_diabetic_dataset",
        "smart-contract-Sylhet_Diabetes_Hospital_Bangladesh",
        "smart-contract-Pima_Indians_Diabetes_USA",
        "smart-contract-heart_failure_clinical_records_dataset",
        "smart-contract-google_Health_Cancer_Prediction_Model",
        "smart-contract-cox_model_2020",
        "smart-contract-kaplan_meier_model_2020",
        "smart-contract-xgboost_risk_model_2025",
        "smart-contract-random_survival_forest_2025",
        "smart-contract-mlp_cancer_classifier_2025",
        "smart-contract-lstm_readmission_model_2026",
        "smart-contract-UCI_AfricanAmerican_Readmission",
        "smart-contract-UCI_Caucasian_Readmission",
        "smart-contract-UCI_Hispanic_Readmission",
        "smart-contract-UCI_Asian_Readmission",
    }

    if not os.path.exists(contract_dir):
        print(f"Directory not found: {contract_dir}")
        return

    vectors_to_upsert = []

    for filename in os.listdir(contract_dir):
        if filename.endswith(".sol"):

            # This block will check if the file is on our whitelist
            asset_name_from_file = os.path.splitext(filename)[0]
            if asset_name_from_file not in ALLOWED_ASSETS:
                print(f"   - ⚠️  Skipping legacy contract: {filename}")
                continue  # This command skips the rest of the loop for this file

            filepath = os.path.join(contract_dir, filename)

            print(f"Processing: {filename}")

            contract_data = parse_solidity_contract(filepath)
            summary = create_contract_summary(contract_data, filename)

            vector = text_to_vector(summary)

            metadata = {
                "contract_name": contract_data["contract_name"],
                "source_file": filename,
                "required_params": ",".join(contract_data["required_params"]),
                "summary": summary,
                "type": "smart_contract",
            }

            vectors_to_upsert.append(
                {
                    "id": f"contract-{contract_data['contract_name']}",
                    "values": vector,
                    "metadata": metadata,
                }
            )

    if vectors_to_upsert:
        contract_index.upsert(
            vectors=[(v["id"], v["values"], v["metadata"]) for v in vectors_to_upsert]
        )
        print(f"\n🎉 Indexed {len(vectors_to_upsert)} smart contracts!")


if __name__ == "__main__":
    index_all_smart_contracts()
