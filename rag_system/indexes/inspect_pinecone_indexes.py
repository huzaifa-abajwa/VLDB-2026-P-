"""
Script to inspect what's actually indexed in your Pinecone indexes
This will show you exactly what asset names and types are stored
"""
import os
import sys
from dotenv import load_dotenv
from pinecone import Pinecone

load_dotenv()

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))

# ===================================================================
# INSPECT XACML POLICIES INDEX
# ===================================================================
print("=" * 80)
print("📊 INSPECTING: xacml-policies index")
print("=" * 80)

xacml_index = pc.Index("xacml-policies")

# Get index stats
stats = xacml_index.describe_index_stats()
print(f"\n📈 Index Stats:")
print(f"   Total vectors: {stats['total_vector_count']}")
print(f"   Dimension: {stats['dimension']}")

# Fetch ALL indexed policies
print(f"\n📋 All Indexed Policies:")
print("=" * 80)

results = xacml_index.query(
    vector=[0.1] * 768,  # Dummy vector to get results
    top_k=50,  # Get more results
    include_metadata=True
)

# Group by asset type
datasets = []
models = []

for idx, match in enumerate(results["matches"], 1):
    asset_name = match["metadata"].get("asset_name", "Unknown")
    source_file = match["metadata"].get("source_file", "Unknown")
    summary = match["metadata"].get("summary", "")
    
    # Determine type from summary
    if summary.startswith("Dataset:"):
        asset_type = "Dataset"
        datasets.append((asset_name, source_file))
    elif summary.startswith("Model:"):
        asset_type = "Model"
        models.append((asset_name, source_file))
    else:
        asset_type = "Unknown"
    
    print(f"\n{idx}. {asset_type}: {asset_name}")
    print(f"   Source: {source_file}")
    
    # Show first 200 chars of summary
    summary_preview = summary.replace('\n', ' ')[:200] + "..."
    print(f"   Summary: {summary_preview}")
    
    # Extract specializations if present
    if "Required specializations:" in summary:
        spec_start = summary.find("Required specializations:")
        spec_part = summary[spec_start:spec_start+150]
        print(f"   {spec_part.strip()}")
    
    print("-" * 80)

# Summary
print("\n" + "=" * 80)
print("📊 SUMMARY")
print("=" * 80)
print(f"\n✅ Datasets found: {len(datasets)}")
for name, source in datasets:
    print(f"   - {name} (from {source})")

print(f"\n✅ Models found: {len(models)}")
for name, source in models:
    print(f"   - {name} (from {source})")

# ===================================================================
# INSPECT SMART CONTRACTS INDEX
# ===================================================================
print("\n\n" + "=" * 80)
print("📊 INSPECTING: smart-contracts index")
print("=" * 80)

contracts_index = pc.Index("smart-contracts")

stats = contracts_index.describe_index_stats()
print(f"\n📈 Index Stats:")
print(f"   Total vectors: {stats['total_vector_count']}")

results = contracts_index.query(
    vector=[0.1] * 768,
    top_k=20,
    include_metadata=True
)

print(f"\n📋 Indexed Smart Contracts:")
print("=" * 80)

for idx, match in enumerate(results["matches"], 1):
    contract_name = match["metadata"].get("contract_name", "Unknown")
    source_file = match["metadata"].get("source_file", "Unknown")

    print(f"{idx}. {contract_name} (from {source_file})")

# ===================================================================
# INSPECT METADATA INDEX
# ===================================================================
print("\n\n" + "=" * 80)
print("📊 INSPECTING: dataset-model-metadata index")
print("=" * 80)

metadata_index = pc.Index("dataset-model-metadata")

stats = metadata_index.describe_index_stats()
print(f"\n📈 Index Stats:")
print(f"   Total vectors: {stats['total_vector_count']}")

results = metadata_index.query(
    vector=[0.1] * 768,
    top_k=20,
    include_metadata=True
)

print(f"\n📋 Indexed Metadata:")
print("=" * 80)

for idx, match in enumerate(results["matches"], 1):
    summary = match["metadata"].get("summary", "")
    
    # Determine if it's dataset or model
    if "Dataset:" in summary:
        asset_type = "Dataset"
    elif "Model:" in summary:
        asset_type = "Model"
    else:
        asset_type = "Unknown"
    
    # Extract name
    lines = summary.split('\n')
    name = lines[0] if lines else "Unknown"
    
    print(f"{idx}. {name}")
    if len(summary) > 100:
        print(f"   Preview: {summary[:100]}...")
    else:
        print(f"   Content: {summary}")
    print("-" * 40)

print("\n" + "=" * 80)
print("✅ Inspection complete!")
print("=" * 80)
