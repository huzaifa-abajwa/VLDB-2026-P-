const fs = require('fs');
const path = require('path');

// ====================================================================
// ENHANCED VALIDATION LAYER WITH COLUMN MATCHING AND FUZZY SIMILARITY
// ====================================================================

/**
 * Enhanced cosine similarity calculation for fuzzy column matching
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(str1, str2) {
    // Convert to lowercase and split into words
    const words1 = str1.toLowerCase().split(/[_\s-]+/);
    const words2 = str2.toLowerCase().split(/[_\s-]+/);
    
    // Add semantic word mappings for better matching
    const semanticMappings = {
        'time': ['survival', 'duration', 'period', 'rfstime', 'follow', 'up'],
        'event': ['death', 'outcome', 'flag', 'status', 'indicator'],
        'survival': ['time', 'duration', 'period', 'rfstime', 'follow', 'up'],
        'days': ['time', 'duration', 'period', 'rfstime'],
        'flag': ['event', 'outcome', 'indicator', 'status'],
        'death': ['event', 'outcome', 'flag', 'status'],
        'rfstime': ['survival', 'time', 'duration', 'follow', 'up', 'period'],
        'status': ['event', 'flag', 'indicator', 'outcome'],
        'indicator': ['status', 'flag', 'event', 'outcome'],
        'follow': ['time', 'survival', 'rfstime', 'up'],
        'up': ['follow', 'time', 'survival', 'rfstime']
    };
    
    // Expand words with semantic equivalents
    const expandWords = (words) => {
        const expanded = [...words];
        words.forEach(word => {
            if (semanticMappings[word]) {
                expanded.push(...semanticMappings[word]);
            }
        });
        return expanded;
    };
    
    const expandedWords1 = expandWords(words1);
    const expandedWords2 = expandWords(words2);
    
    // Create word frequency vectors
    const vector1 = {};
    const vector2 = {};
    
    // Count word frequencies
    expandedWords1.forEach(word => {
        if (word.length > 0) {
            vector1[word] = (vector1[word] || 0) + 1;
        }
    });
    
    expandedWords2.forEach(word => {
        if (word.length > 0) {
            vector2[word] = (vector2[word] || 0) + 1;
        }
    });
    
    // Get all unique words
    const allWords = new Set([...Object.keys(vector1), ...Object.keys(vector2)]);
    
    // Calculate dot product and magnitudes
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;
    
    for (const word of allWords) {
        const freq1 = vector1[word] || 0;
        const freq2 = vector2[word] || 0;
        
        dotProduct += freq1 * freq2;
        magnitude1 += freq1 * freq1;
        magnitude2 += freq2 * freq2;
    }
    
    // Calculate cosine similarity
    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }
    
    let baseSimilarity = dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
    
    // Special handling for common column name patterns - boost similarity
    const str1Lower = str1.toLowerCase();
    const str2Lower = str2.toLowerCase();
    
    // Direct pattern matches for common survival/time columns
    if ((str1Lower.includes('survival') || str1Lower.includes('time') || str1Lower.includes('follow')) &&
        (str2Lower.includes('rfstime') || str2Lower.includes('survival') || str2Lower.includes('time'))) {
        // Boost similarity for time-related columns
        baseSimilarity = Math.min(1.0, baseSimilarity + 0.3);
    }
    
    // Direct pattern matches for event/status columns
    if ((str1Lower.includes('event') || str1Lower.includes('indicator') || str1Lower.includes('status')) &&
        (str2Lower.includes('status') || str2Lower.includes('event') || str2Lower.includes('flag'))) {
        // Boost similarity for event-related columns
        baseSimilarity = Math.min(1.0, baseSimilarity + 0.3);
    }
    
    return baseSimilarity;
}

/**
 * Find the best matching column for a given column name
 * @param {string} targetColumn - Column name to match
 * @param {Array} availableColumns - Array of available column names
 * @param {number} threshold - Minimum similarity threshold (default: 0.4)
 * @returns {Object} Match result with similarity score and suggested column
 */
function findBestColumnMatch(targetColumn, availableColumns, threshold = 0.4) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const column of availableColumns) {
        const score = cosineSimilarity(targetColumn, column);
        
        if (score > bestScore) {
            bestScore = score;
            bestMatch = column;
        }
    }
    
    return {
        found: bestScore >= threshold,
        suggestedColumn: bestMatch,
        similarity: bestScore,
        threshold: threshold
    };
}

/**
 * Extract column information from RAG metadata
 * @param {string} ragContext - RAG context containing metadata
 * @returns {Object} Extracted column information by dataset
 */
function extractColumnMetadata(ragContext) {
    const columnMetadata = {};
    
    // Pattern to match dataset metadata blocks - more flexible matching
    const datasetPattern = /Dataset:\s*([^\n—]+)[\s\S]*?Columns:\s*([^\n]+)/gi;
    let match;
    
    while ((match = datasetPattern.exec(ragContext)) !== null) {
        let datasetName = match[1].trim().split('—')[0].trim(); // Remove policy info
        const columnsText = match[2].trim();
        
        // Parse columns (format: "column1 (type), column2 (type), ...")
        const columns = columnsText.split(',').map(col => {
            const trimmed = col.trim();
            const nameMatch = trimmed.match(/^([^(]+)/);
            return nameMatch ? nameMatch[1].trim() : trimmed;
        }).filter(col => col.length > 0);
        
        // Store with original name
        columnMetadata[datasetName] = columns;
        
        // Also store with .csv extension if not present (for compatibility)
        if (!datasetName.endsWith('.csv')) {
            columnMetadata[datasetName + '.csv'] = columns;
        }
        
        // Also store without .csv extension if present (for reverse compatibility)
        if (datasetName.endsWith('.csv')) {
            const nameWithoutExt = datasetName.replace(/\.csv$/, '');
            columnMetadata[nameWithoutExt] = columns;
        }
    }
    
    // Fallback: if no columns found, try to extract from the context directly
    if (Object.keys(columnMetadata).length === 0) {
        const columnsMatch = ragContext.match(/Columns:\s*([^\n]+)/i);
        if (columnsMatch) {
            const columnsText = columnsMatch[1].trim();
            const columns = columnsText.split(',').map(col => {
                const trimmed = col.trim();
                const nameMatch = trimmed.match(/^([^(]+)/);
                return nameMatch ? nameMatch[1].trim() : trimmed;
            }).filter(col => col.length > 0);
            
            // Try to find dataset name
            const datasetMatch = ragContext.match(/Dataset:\s*([^\n—]+)/i);
            const datasetName = datasetMatch ? datasetMatch[1].trim().split('—')[0].trim() : 'BreastCancer_v2';
            columnMetadata[datasetName] = columns;
        }
    }
    
    return columnMetadata;
}

/**
 * Validate BPMN workflow against dataset schemas
 * @param {string} bpmnXml - BPMN XML content
 * @param {Object} columnMetadata - Column metadata by dataset
 * @param {Array} selectedDatasets - Selected datasets
 * @returns {Object} Validation results
 */
function validateBPMNColumns(bpmnXml, columnMetadata, selectedDatasets) {
    const validation = {
        status: 'PASS',
        score: 1.0,
        errors: [],
        warnings: [],
        suggestions: []
    };
    
    // Extract column references from BPMN XML
    const columnReferences = extractColumnReferencesFromBPMN(bpmnXml);
    
    for (const dataset of selectedDatasets) {
        const availableColumns = columnMetadata[dataset] || [];
        
        for (const columnRef of columnReferences) {
            const exactMatch = availableColumns.includes(columnRef);
            
            if (!exactMatch) {
                // Increased threshold from 0.3 to 0.4 for better accuracy
                const fuzzyMatch = findBestColumnMatch(columnRef, availableColumns, 0.4);
                
                if (fuzzyMatch.found) {
                    // Warning: fuzzy match found
                    validation.warnings.push({
                        id: 'W_COL_FUZZY',
                        dataset: dataset,
                        column: columnRef,
                        suggested: fuzzyMatch.suggestedColumn,
                        similarity: fuzzyMatch.similarity,
                        message: `Column '${columnRef}' not found in ${dataset}. Closest match: '${fuzzyMatch.suggestedColumn}' (sim=${fuzzyMatch.similarity.toFixed(2)})`,
                        suggested_fix: {
                            action: 'remap_column',
                            from: columnRef,
                            to: fuzzyMatch.suggestedColumn,
                            confidence: fuzzyMatch.similarity
                        }
                    });
                    
                    // Lower the score for warnings
                    validation.score = Math.min(validation.score, 0.8);
                    validation.status = 'REVIEW';
                } else {
                    // Error: no match found
                    validation.errors.push({
                        id: 'E_COL_MISSING',
                        dataset: dataset,
                        column: columnRef,
                        message: `Column '${columnRef}' not found in ${dataset} and no similar columns found`,
                        suggested_fix: {
                            action: 'remove_column',
                            column: columnRef,
                            reason: 'Column does not exist in dataset'
                        }
                    });
                    
                    validation.score = 0.0;
                    validation.status = 'FAIL';
                }
            }
        }
    }
    
    return validation;
}

/**
 * Extract column references from BPMN XML
 * @param {string} bpmnXml - BPMN XML content
 * @returns {Array} Array of column names referenced in the BPMN
 */
function extractColumnReferencesFromBPMN(bpmnXml) {
    const columns = new Set();
    
    // IMPROVED: More precise exclusions (only structural BPMN elements)
    const excludedKeywords = [
        'Model', 'Dataset', 'Task', 'Event', 'Gateway', 'Flow',
        'Definitions', 'Process', 'Diagram', 'Plane', 'Collaboration'
    ];
    
    // Extract from documentation tags
    const docPattern = /<bpmn:documentation[^>]*>([\s\S]*?)<\/bpmn:documentation>/g;
    let match;
    
    while ((match = docPattern.exec(bpmnXml)) !== null) {
        const docText = match[1];
        
        // Extract "Inputs: col1, col2, col3" patterns
        const inputMatch = docText.match(/Inputs?:\s*([^\n<]+)/i);
        if (inputMatch) {
            const cols = inputMatch[1].split(/[,\s]+/)
                .map(c => c.trim())
                .filter(c => c.length > 1 && /^[a-zA-Z_]/.test(c));
            cols.forEach(c => columns.add(c));
        }
        
        // Extract "Columns: col1, col2" patterns
        const colMatch = docText.match(/Columns?:\s*([^\n<]+)/i);
        if (colMatch) {
            const cols = colMatch[1].split(/[,\s]+/)
                .map(c => c.trim())
                .filter(c => c.length > 1 && /^[a-zA-Z_]/.test(c));
            cols.forEach(c => columns.add(c));
        }
    }
    
    // Filter out excluded keywords
    const validColumns = Array.from(columns).filter(col => 
        !excludedKeywords.some(keyword => 
            col.toLowerCase().includes(keyword.toLowerCase())
        )
    );
    
    console.log(`   📋 Extracted ${validColumns.length} column references: [${validColumns.join(', ')}]`);
    return validColumns;
}

/**
 * Validate model compatibility with datasets
 * @param {Array} selectedModels - Selected models
 * @param {Array} selectedDatasets - Selected datasets
 * @param {Object} modelCompatibility - Model compatibility mapping
 * @returns {Object} Model validation results
 */
function validateModelCompatibility(selectedModels, selectedDatasets, modelCompatibility) {
    const validation = {
        status: 'PASS',
        score: 1.0,
        errors: [],
        warnings: [],
        suggestions: []
    };
    
    for (const model of selectedModels) {
        const compatibility = modelCompatibility[model];
        
        if (!compatibility) {
            validation.warnings.push({
                id: 'W_MODEL_UNKNOWN',
                model: model,
                message: `Model '${model}' not found in compatibility database`,
                suggested_fix: {
                    action: 'verify_model',
                    model: model
                }
            });
            validation.status = 'REVIEW';
            continue;
        }
        
        // Check if model is compatible with any selected dataset
        const compatibleDatasets = compatibility.compatible_datasets || [];
        const hasCompatibleDataset = selectedDatasets.some(dataset => 
            compatibleDatasets.includes(dataset)
        );
        
        if (!hasCompatibleDataset && selectedDatasets.length > 0) {
            validation.errors.push({
                id: 'E_MODEL_INCOMPATIBLE',
                model: model,
                datasets: selectedDatasets,
                compatible_datasets: compatibleDatasets,
                message: `Model '${model}' is not compatible with selected datasets`,
                suggested_fix: {
                    action: 'replace_model',
                    model: model,
                    suggested_models: Object.keys(modelCompatibility).filter(m => 
                        modelCompatibility[m].compatible_datasets.some(ds => 
                            selectedDatasets.includes(ds)
                        )
                    )
                }
            });
            validation.score = 0.0;
            validation.status = 'FAIL';
        }
    }
    
    return validation;
}

/**
 * Main validation function that combines all validation checks
 * @param {Object} params - Validation parameters
 * @returns {Object} Complete validation results
 */
function validateWorkflow(params) {
    const {
        bpmnXml,
        selectedDatasets,
        selectedModels,
        ragContext,
        modelCompatibility
    } = params;
    
    console.log('🔍 Starting comprehensive workflow validation...');
    
    // Extract column metadata from RAG context
    const columnMetadata = extractColumnMetadata(ragContext);
    console.log('📊 Extracted column metadata for datasets:', Object.keys(columnMetadata));
    
    // Validate BPMN columns
    const columnValidation = validateBPMNColumns(bpmnXml, columnMetadata, selectedDatasets);
    console.log('📋 Column validation:', columnValidation.status);
    
    // Validate model compatibility
    const modelValidation = validateModelCompatibility(selectedModels, selectedDatasets, modelCompatibility);
    console.log('🤖 Model validation:', modelValidation.status);
    
    // Combine validation results
    const combinedValidation = {
        status: 'PASS',
        score: 1.0,
        errors: [...columnValidation.errors, ...modelValidation.errors],
        warnings: [...columnValidation.warnings, ...modelValidation.warnings],
        suggestions: [...columnValidation.suggestions, ...modelValidation.suggestions],
        details: {
            column_validation: columnValidation,
            model_validation: modelValidation
        }
    };
    
    // Determine overall status
    if (combinedValidation.errors.length > 0) {
        combinedValidation.status = 'FAIL';
        combinedValidation.score = 0.0;
    } else if (combinedValidation.warnings.length > 0) {
        combinedValidation.status = 'REVIEW';
        combinedValidation.score = Math.min(columnValidation.score, modelValidation.score);
    }
    
    console.log(`✅ Validation complete: ${combinedValidation.status} (score: ${combinedValidation.score.toFixed(2)})`);
    console.log(`   Errors: ${combinedValidation.errors.length}, Warnings: ${combinedValidation.warnings.length}`);
    
    return combinedValidation;
}

/**
 * Apply suggested fixes to BPMN XML
 * @param {string} bpmnXml - Original BPMN XML
 * @param {Array} suggestions - Array of suggested fixes
 * @returns {string} Updated BPMN XML
 */
function applySuggestedFixes(bpmnXml, suggestions) {
    let updatedXml = bpmnXml;
    
    for (const suggestion of suggestions) {
        // Handle both formats:
        // 1. suggestion.suggested_fix (from warnings/errors)
        // 2. suggestion directly (from verifier LLM)
        const fix = suggestion.suggested_fix || suggestion;
        
        if (fix && fix.action === 'remap_column') {
            const from = fix.from || suggestion.from;
            const to = fix.to || suggestion.to;
            
            if (from && to) {
                // Replace column references in the BPMN XML
                // Use word boundaries to avoid partial matches
                updatedXml = updatedXml.replace(
                    new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 
                    to
                );
                console.log(`🔄 Applied column remap: ${from} → ${to}`);
            }
        } else if (fix && fix.action === 'remove_column') {
            const column = fix.column || suggestion.from;
            if (column) {
                // Remove column references
                updatedXml = updatedXml.replace(
                    new RegExp(`\\b${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
                    ''
                );
                console.log(`🔄 Removed column: ${column}`);
            }
        }
    }
    
    return updatedXml;
}

module.exports = {
    cosineSimilarity,
    findBestColumnMatch,
    extractColumnMetadata,
    validateBPMNColumns,
    validateModelCompatibility,
    validateWorkflow,
    applySuggestedFixes,
    extractColumnReferencesFromBPMN
};

