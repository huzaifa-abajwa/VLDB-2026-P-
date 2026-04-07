import os

from dotenv import load_dotenv
from pinecone import Pinecone

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
index = pc.Index("xacml-policies")

# Get index stats
stats = index.describe_index_stats()
print(f"📊 Index Stats:")
print(f"   Total vectors: {stats['total_vector_count']}")
print(f"   Dimension: {stats['dimension']}")

# Fetch some sample vectors to see what's indexed
print(f"\n📋 Sample indexed policies:")
results = index.query(
    vector=[0.1] * 768, top_k=10, include_metadata=True  # Dummy vector
)

for match in results["matches"]:
    dataset_name = match["metadata"].get("dataset_name", "Unknown")
    source_file = match["metadata"].get("source_file", "Unknown")
    summary = match["metadata"].get("summary", "No summary available.")
    
    print(f"   - {dataset_name} (from {source_file})")
    clean_summary = summary.strip().replace('\n', ' ')
    print(f"     Summary: {clean_summary}")
    print("-" * 20)