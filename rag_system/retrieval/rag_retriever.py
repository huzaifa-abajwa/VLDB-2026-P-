import os

import torch
from dotenv import load_dotenv
from pinecone import Pinecone
from transformers import AutoModel, AutoTokenizer

load_dotenv()


class RAGRetriever:
    def __init__(self):
        pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

        self.indexes = {
            "xacml": pc.Index("xacml-policies"),
            "contracts": pc.Index("smart-contracts"),
            "metadata": pc.Index("dataset-model-metadata"),
        }

        self.tokenizer = AutoTokenizer.from_pretrained("microsoft/codebert-base")
        self.model = AutoModel.from_pretrained("microsoft/codebert-base")

    def text_to_vector(self, text):
        tokens = self.tokenizer(
            text, return_tensors="pt", padding=True, truncation=True, max_length=512
        )
        with torch.no_grad():
            outputs = self.model(**tokens)
        return outputs.last_hidden_state.mean(dim=1).squeeze().tolist()

    def retrieve_policy_context(
        self, selected_datasets, top_k=20, user_query=""
    ):  # Increase to 20 to ensure we get ALL assets
        """Retrieve XACML policies for BOTH datasets and models"""

        # SINGLE QUERY: Fetch all policies with high top_k to get everything
        # This ensures we get all 9 assets (3 datasets + 5 models)
        query = "healthcare dataset model cancer diabetes cardiology registry SEER German Pakistani diabetic readmission Cox Kaplan XGBoost Survival"
        vector = self.text_to_vector(query)

        all_results = self.indexes["xacml"].query(
            vector=vector, top_k=20, include_metadata=True
        )

        # Separate datasets and models based on summary prefix
        dataset_matches = []
        model_matches = []
        
        for match in all_results["matches"]:
            summary = match["metadata"].get("summary", "")
            if summary.startswith("Dataset:"):
                dataset_matches.append(match)
            elif summary.startswith("Model:"):
                model_matches.append(match)

        # Combine with datasets first (prioritize them)
        unique_results = dataset_matches + model_matches

        # DEBUG: Print what was retrieved
        print(f"\n🔍 RAG Query Results:")
        print(f"   Total query returned: {len(all_results['matches'])} results")
        print(f"   Datasets found: {len(dataset_matches)}")
        print(f"   Models found: {len(model_matches)}")
        print(f"   Total unique results: {len(unique_results)}")
        
        # Show dataset names specifically
        if dataset_matches:
            print(f"   📊 Dataset policies retrieved:")
            for match in dataset_matches:
                asset_name = match["metadata"].get("asset_name", "Unknown")
                print(f"      - {asset_name}")
        
        for match in unique_results:
            asset_name = match["metadata"].get("asset_name", "Unknown")
            summary_preview = match["metadata"]["summary"][:50].replace('\n', ' ')
            print(f"   - {asset_name}: {summary_preview}...")

        context = "\n\n".join(
            [match["metadata"]["summary"] for match in unique_results]
        )

        return context or "No specific policy constraints found."

    def retrieve_contract_logic(self, selected_datasets, top_k=2, user_query=""):
        """Retrieve smart contract requirements"""
        if selected_datasets:
            query = f"Smart contract requirements for: {', '.join(selected_datasets)}"
        elif user_query:
            query = f"Smart contract for: {user_query}"
        else:
            query = "Healthcare smart contract requirements"

        vector = self.text_to_vector(query)

        results = self.indexes["contracts"].query(
            vector=vector, top_k=top_k, include_metadata=True
        )

        # Lower threshold from 0.6 to 0.3
        context = "\n\n".join(
            [
                match["metadata"]["summary"]
                for match in results["matches"]
                if match["score"] > 0.3  # Changed from 0.6
            ]
        )

        return context or "No smart contract constraints found."

    def retrieve_metadata_context(self, selected_datasets, selected_models):
        """Retrieve dataset and model metadata"""
        query = f"Metadata for datasets {', '.join(selected_datasets)} and models {', '.join(selected_models)}"
        vector = self.text_to_vector(query)

        # INCREASE top_k to get ALL models (not just 1)
        top_k = max(
            5, len(selected_datasets) + len(selected_models)
        )  # Changed from max(1, ...)

        results = self.indexes["metadata"].query(
            vector=vector,
            top_k=top_k,
            include_metadata=True,
        )

        context = "\n\n".join(
            [match["metadata"]["summary"] for match in results["matches"]]
        )

        return context

    def retrieve_all_context(self, user_query, selected_datasets, selected_models):
        """Main method: retrieve ALL relevant context"""
        print("🔎 Retrieving context from RAG indexes...")

        contexts = {
            "policy": self.retrieve_policy_context(
                selected_datasets, user_query=user_query
            ),
            "contract": self.retrieve_contract_logic(
                selected_datasets, user_query=user_query
            ),
            "metadata": self.retrieve_metadata_context(
                selected_datasets, selected_models
            ),
        }

        # Extract dataset names from policies for strict enforcement
        policy_text = contexts["policy"]
        available_datasets = []

        # Split by double newlines to get individual policy blocks
        policy_blocks = policy_text.split("\n\n")

        for block in policy_blocks:
            lines = block.split("\n")
            if lines and lines[0].strip().startswith("Dataset:"):
                # Extract dataset name from first line
                ds_name = lines[0].replace("Dataset:", "").strip()
                if ds_name:
                    available_datasets.append(ds_name)

        available_datasets_str = (
            ", ".join(available_datasets) if available_datasets else "None available"
        )

        enriched_prompt = f"""You are a healthcare workflow generator with STRICT policy enforcement.

    === AVAILABLE DATASETS (from access control policies) ===
    {available_datasets_str}

    === POLICY CONSTRAINTS ===
    {contexts['policy']}

    === SMART CONTRACT REQUIREMENTS ===
    {contexts['contract']}

    === METADATA ===
    {contexts['metadata']}

    === USER REQUEST ===
    {user_query}

    CRITICAL RULES:
    1. From the METADATA context, recommend ALL datasets AND ALL models that are compatible with the user's request. Do NOT pick just one of each - list every dataset and model that matches the query domain.
    2. Ensure your recommendations strictly adhere to the rules described in the POLICY CONSTRAINTS. For example, match the query domain (e.g., 'cancer') to the policy's required specialization.
    3. If the user specifies a dataset (e.g., "SEER data"), you MUST use that dataset if it is available and policy-compliant.
    4. If no available datasets match the required specialization for the user's query, you MUST respond with: "No policy-compliant datasets available for this request." and do not generate a BPMN.

    REQUIRED OUTPUT FORMAT:
    - Datasets: [list ALL compatible datasets from: {available_datasets_str}]
    - Models: [ALL appropriate models]
    - Explanation: [why these comply with policies]
    - BPMN workflow XML
    
    IMPORTANT: List ALL compatible datasets and models, not just the single most relevant ones. If multiple datasets/models match the query domain, include all of them.

    If no datasets match the query's required specialization, respond with: "No policy-compliant datasets available for this request."
    """

        return enriched_prompt


if __name__ == "__main__":
    retriever = RAGRetriever()

    # Test case 1: Survival analysis query
    prompt = retriever.retrieve_all_context(
        user_query="Analyze breast cancer survival by age and treatment",
        selected_datasets=[],  # Let it auto-select
        selected_models=[],
    )

    print("=" * 80)
    print("TEST: Survival Analysis Query")
    print("=" * 80)
    print(prompt)
    print("\n")

    # Test case 2: Kaplan-Meier query
    prompt2 = retriever.retrieve_all_context(
        user_query="Create a Kaplan-Meier survival analysis for lung cancer patients",
        selected_datasets=[],
        selected_models=[],
    )

    print("=" * 80)
    print("TEST: Kaplan-Meier Query")
    print("=" * 80)
    print(prompt2)