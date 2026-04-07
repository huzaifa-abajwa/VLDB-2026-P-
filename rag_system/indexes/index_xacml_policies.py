# rag_system/indexes/index_xacml_policies.py
import os
import xml.etree.ElementTree as ET

import torch
from dotenv import load_dotenv
from pinecone import Pinecone
from transformers import AutoModel, AutoTokenizer

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
xacml_index = pc.Index("xacml-policies")

tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base")
model = AutoModel.from_pretrained("microsoft/codebert-base")


def text_to_vector(text):
    tokens = tokenizer(
        text, return_tensors="pt", padding=True, truncation=True, max_length=512
    )
    with torch.no_grad():
        outputs = model(**tokens)
    return outputs.last_hidden_state.mean(dim=1).squeeze().tolist()


def parse_xacml_policy(xml_path):
    """Extract structured info from XACML policy XML"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    ns = {"xacml": "urn:oasis:names:tc:xacml:3.0:core:schema:wd-17"}

    policy_data = {
        "policy_id": root.attrib.get("PolicyId", "unknown"),
        "attributes": {},
    }

    # Extract all attribute values
    for match in root.findall(".//xacml:Match", ns):
        attr_value_elem = match.find(".//xacml:AttributeValue", ns)
        attr_designator = match.find(".//xacml:AttributeDesignator", ns)

        if attr_value_elem is not None and attr_designator is not None:
            attr_id = attr_designator.attrib.get("AttributeId", "unknown")
            attr_value = attr_value_elem.text

            if attr_id not in policy_data["attributes"]:
                policy_data["attributes"][attr_id] = []
            policy_data["attributes"][attr_id].append(attr_value)

    return policy_data


def create_natural_language_summary(policy_data, asset_name):
    """Convert policy to human-readable text for embedding"""
    attrs = policy_data["attributes"]

    # Explicit lists of known models and datasets
    KNOWN_MODELS = {
        "cox_model@2020",
        "kaplan_meier_model@2020",
        "xgboost_risk_model@2025",
        "random_survival_forest@2025",
        "mlp_cancer_classifier@2025",
        "google_Health_Cancer_Prediction_Model",
        "lstm_readmission_model@2026",
    }

    KNOWN_DATASETS = {
        "SEER_Cancer_Registry_of_USA",
        "German_Cancer_registry@2020",
        "National_Cancer_Registry_of_Pakistan",
        "UCI_diabetic_dataset",
        "Sylhet_Diabetes_Hospital_Bangladesh",
        "Pima_Indians_Diabetes_USA",
        "heart_failure_clinical_records_dataset",
        "UCI_AfricanAmerican_Readmission",
        "UCI_Caucasian_Readmission",
        "UCI_Hispanic_Readmission",
        "UCI_Asian_Readmission",
    }

    # Determine asset type with explicit checks first
    if asset_name in KNOWN_MODELS:
        is_model = True
    elif asset_name in KNOWN_DATASETS:
        is_model = False
    else:
        # Fallback to heuristic detection
        is_model = (
            "model" in asset_name.lower()
            or asset_name.endswith(".py")
            or asset_name.endswith("_model")
        )

    asset_type = "Model" if is_model else "Dataset"

    summary = f"""{asset_type}: {asset_name}

    Access Requirements:
    """

    for attr_name, values in attrs.items():
        summary += f"- {attr_name}: {', '.join(values)}\n"

    summary += (
        f"\nThis policy controls access to the {asset_name} {asset_type.lower()}. "
    )

    if "personRole" in attrs:
        summary += f"Authorized roles include: {', '.join(attrs['personRole'])}. "
    if "specialization" in attrs:
        summary += f"Required specializations: {', '.join(attrs['specialization'])}. "
    if "department" in attrs:
        summary += f"Authorized departments: {', '.join(attrs['department'])}."

    return summary


def index_all_xacml_policies():
    """Index all XACML policies from CORRECT directories"""

    # ADD backend/new_uploads to the search paths
    policy_dirs = [
        "../../XACML",
        "../../blockchain/policies",
        "../../backend/uploads",
        # "../../backend/new_uploads",
    ]

    ALLOWED_ASSETS = {
        "SEER_Cancer_Registry_of_USA",
        "German_Cancer_registry@2020",
        "National_Cancer_Registry_of_Pakistan",
        "UCI_diabetic_dataset",
        "Sylhet_Diabetes_Hospital_Bangladesh",
        "Pima_Indians_Diabetes_USA",
        "heart_failure_clinical_records_dataset",
        "google_Health_Cancer_Prediction_Model",
        "cox_model@2020",
        "kaplan_meier_model@2020",
        "xgboost_risk_model@2025",
        "random_survival_forest@2025",
        "mlp_cancer_classifier@2025",
        "lstm_readmission_model@2026",
        "UCI_AfricanAmerican_Readmission",
        "UCI_Caucasian_Readmission",
        "UCI_Hispanic_Readmission",
        "UCI_Asian_Readmission",
    }

    vectors_to_upsert = []

    for policy_dir in policy_dirs:
        abs_path = os.path.abspath(policy_dir)
        print(f"\nChecking directory: {abs_path}")

        if not os.path.exists(policy_dir):
            print(f"⚠️ Directory not found: {policy_dir}")
            continue

        print(f"✓ Directory found: {policy_dir}")

        xml_files = [f for f in os.listdir(policy_dir) if f.endswith(".xml")]
        print(f"   Found {len(xml_files)} XML files")

        for filename in xml_files:
            asset_name_from_file = os.path.splitext(filename)[0]
            if asset_name_from_file not in ALLOWED_ASSETS:
                print(f"   - ⚠️  Skipping legacy policy: {filename}")
                continue  # This command skips the rest of the loop for this file
            filepath = os.path.join(policy_dir, filename)
            asset_name = (
                filename.replace(".xml", "")
                .replace("Dataset", "")
                .replace("policy", "")
            )

            print(f"   Processing: {filename}")

            try:
                policy_data = parse_xacml_policy(filepath)
                summary = create_natural_language_summary(policy_data, asset_name)

                vector = text_to_vector(summary)

                metadata = {
                    "asset_name": asset_name,
                    "policy_id": policy_data["policy_id"],
                    "source_file": filename,
                    "summary": summary,
                    "attributes": str(policy_data["attributes"]),
                    "type": "xacml_policy",
                }

                vectors_to_upsert.append(
                    {
                        "id": f"policy-{asset_name}-{policy_data['policy_id']}",
                        "values": vector,
                        "metadata": metadata,
                    }
                )
                print(f"   ✓ Processed: {filename}")
            except Exception as e:
                print(f"   ✗ Error processing {filename}: {e}")

    # Upsert to Pinecone
    if vectors_to_upsert:
        batch_size = 100
        for i in range(0, len(vectors_to_upsert), batch_size):
            batch = vectors_to_upsert[i : i + batch_size]
            xacml_index.upsert(
                vectors=[(v["id"], v["values"], v["metadata"]) for v in batch]
            )
            print(f"\n✓ Indexed batch {i//batch_size + 1}")

        print(f"\n🎉 Indexed {len(vectors_to_upsert)} XACML policies!")
    else:
        print(f"\n⚠️ No XACML policies found to index!")


if __name__ == "__main__":
    index_all_xacml_policies()
