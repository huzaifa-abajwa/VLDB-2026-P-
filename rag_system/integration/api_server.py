# rag_system/integration/api_server.py
import os
import sys

from flask import Flask, jsonify, request

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from retrieval.rag_retriever import RAGRetriever

app = Flask(__name__)
retriever = RAGRetriever()


@app.route("/get_context", methods=["POST"])
def get_context():
    """Original endpoint - keep for backward compatibility"""
    data = request.json

    context = retriever.retrieve_all_context(
        user_query=data["user_query"],
        selected_datasets=data.get("selected_datasets", []),
        selected_models=data.get("selected_models", []),
    )

    return jsonify({"success": True, "context": context})


@app.route("/rag/retrieve", methods=["POST"])
def rag_retrieve():
    """NEW endpoint that matches llm_rag.js expectations"""
    data = request.json

    context = retriever.retrieve_all_context(
        user_query=data.get("query", ""),
        selected_datasets=data.get("selected_datasets", []),
        selected_models=data.get("selected_models", []),
    )

    return jsonify({
        "success": True,
        "enhanced_context": context  # Match expected response format
    })


if __name__ == "__main__":
    # Suppress TensorFlow warnings
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
    os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

    print("🚀 Starting Flask RAG API on port 5000...")
    print("📍 Endpoints:")
    print("   - POST /get_context (legacy)")
    print("   - POST /rag/retrieve (new)")
    
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=False,
    )