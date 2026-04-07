import json
import os

import torch
from dotenv import load_dotenv
from pinecone import Pinecone
from transformers import AutoModel, AutoTokenizer

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
metadata_index = pc.Index("dataset-model-metadata")

tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base")
model = AutoModel.from_pretrained("microsoft/codebert-base")


def text_to_vector(text):
    tokens = tokenizer(
        text, return_tensors="pt", padding=True, truncation=True, max_length=512
    )
    with torch.no_grad():
        outputs = model(**tokens)
    return outputs.last_hidden_state.mean(dim=1).squeeze().tolist()


def create_model_summary(model_dict):
    """Enhanced model description"""
    summary = f"""Model: {model_dict['model_name']}

    Type: {model_dict.get('description', 'Analysis model')}
    Version: {model_dict.get('version', '1.0')}
    Author: {model_dict.get('author', 'Unknown')}
    Input: {model_dict.get('input', {}).get('description', 'Dataset files')}
    Output: {model_dict.get('output', {}).get('description', 'Analysis results')}
    Usage: {model_dict.get('usage', 'Command line execution')}
    """
    return summary

def create_dataset_summary(dataset_dict):
    """Create a descriptive summary for a dataset."""
    attributes_str = '\\n- '.join(dataset_dict.get('attributes', ['No attributes listed']))
    summary = f"""Dataset: {dataset_dict['name']}

    Description: {dataset_dict.get('description', 'No description available.')}
    File Path: {dataset_dict.get('file_path', 'N/A')}

    Attributes:
    - {attributes_str}
    """
    return summary


def index_metadata():
    """Index both dataset and model metadata."""
    
    vectors_to_upsert = []
    
    # ===================================================================
    # NEW: Section to index datasets
    # ===================================================================
    dataset_json_path = os.path.join(os.path.dirname(__file__), "../../backend/dataset.json")
    print(f"📁 Reading datasets from: {dataset_json_path}")
    
    if os.path.exists(dataset_json_path):
        with open(dataset_json_path, "r") as f:
            dataset_data = json.load(f)
        
        datasets_list = dataset_data.get("datasets", [])
        print(f"📊 Found {len(datasets_list)} datasets to index")

        for dataset_obj in datasets_list:
            dataset_name = dataset_obj.get("name", "Unknown")
            print(f"   Indexing: {dataset_name}")

            summary = create_dataset_summary(dataset_obj)
            vector = text_to_vector(summary)

            metadata = {
                "name": dataset_name,
                "type": "dataset",
                "summary": summary,
                "description": dataset_obj.get("description", ""),
            }

            vectors_to_upsert.append({
                "id": f"dataset-{dataset_name}",
                "values": vector,
                "metadata": metadata,
            })
    else:
        print(f"❌ Warning: dataset.json not found at {dataset_json_path}")


    # ===================================================================
    # Existing section to index models
    # ===================================================================
    model_json_path = os.path.join(os.path.dirname(__file__), "../../backend/model.json")
    print(f"\n📁 Reading models from: {model_json_path}")

    if os.path.exists(model_json_path):
        with open(model_json_path, "r") as f:
            data = json.load(f)

        models_list = data.get("models", [])
        print(f"📊 Found {len(models_list)} models to index")

        for model_obj in models_list:
            model_name = model_obj.get("model_name", "Unknown")
            print(f"   Indexing: {model_name}")

            summary = create_model_summary(model_obj)
            vector = text_to_vector(summary)

            metadata = {
                "name": model_name,
                "type": "model",
                "summary": summary,
                "description": model_obj.get("description", ""),
                "version": model_obj.get("version", "1.0"),
                "author": model_obj.get("author", "Unknown"),
            }

            vectors_to_upsert.append({
                "id": f"model-{model_name}",
                "values": vector,
                "metadata": metadata,
            })
    else:
        print(f"❌ Error: model.json not found at {model_json_path}")


    # ===================================================================
    # Combined upsert to Pinecone
    # ===================================================================
    if vectors_to_upsert:
        metadata_index.upsert(
            vectors=[(v["id"], v["values"], v["metadata"]) for v in vectors_to_upsert]
        )
        print(f"\n🎉 Successfully indexed {len(vectors_to_upsert)} total items (datasets and models)!")

        print("\n✅ Indexed items:")
        for v in vectors_to_upsert:
            item_type = v['metadata']['type']
            item_name = v['metadata']['name']
            print(f"   - [{item_type.upper()}] {item_name}")
    else:
        print("❌ No items to index!")


if __name__ == "__main__":
    index_metadata()