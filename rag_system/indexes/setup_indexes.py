import os
import time

from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

DELETE_FIRST = True

RAG_INDEXES = {
    "xacml-policies": {
        "dimension": 768,
        "metric": "cosine",
        "description": "XACML policy rules",
    },
    "smart-contracts": {
        "dimension": 768,
        "metric": "cosine",
        "description": "Solidity contracts",
    },
    "dataset-model-metadata": {
        "dimension": 768,
        "metric": "cosine",
        "description": "Dataset/model metadata",
    },
}


def setup_rag_indexes():
    existing = pc.list_indexes().names()
    print(f"📊 Existing indexes: {existing}")

    if DELETE_FIRST:
        print("\n🔥 Deletion flag is ON. Clearing specified indexes...")
        indexes_to_delete = ["xacml-policies", "smart-contracts", "dataset-model-metadata"]
        for index_name in indexes_to_delete:
            if index_name in existing:
                print(f"   - Deleting index: {index_name}")
                pc.delete_index(index_name)
            else:
                print(f"   - Index {index_name} not found, skipping deletion.")

        # Wait for deletions to complete
        time.sleep(5)
        existing = pc.list_indexes().names()  # Refresh the list of existing indexes
        print("🔥 Indexes cleared.")

    for index_name, config in RAG_INDEXES.items():
        if index_name not in existing:
            print(f"Creating: {index_name}")
            pc.create_index(
                name=index_name,
                dimension=config["dimension"],
                metric=config["metric"],
                spec=ServerlessSpec(cloud="aws", region="us-east-1"),
            )
            print(f"✓ Created {index_name}")
        else:
            print(f"✓ {index_name} already exists")

    return {name: pc.Index(name) for name in RAG_INDEXES.keys()}


if __name__ == "__main__":
    setup_rag_indexes()
    print("\n🎉 RAG indexes ready!")
