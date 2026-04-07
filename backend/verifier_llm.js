const { getChatGPTResponse } = require('./llm');

/**
 * Verifier LLM for providing confidence judgments and suggested fixes
 * This is a cheaper model that reviews warnings from deterministic validators
 */

/**
 * Generate verifier prompt for LLM review
 * @param {Object} validationResult - Results from deterministic validation
 * @param {string} ragContext - RAG context used for validation
 * @param {string} userQuery - Original user query
 * @returns {string} Formatted prompt for verifier LLM
 */
function generateVerifierPrompt(validationResult, ragContext, userQuery) {
    const warnings = validationResult.warnings || [];
    const errors = validationResult.errors || [];
    
    let prompt = `You are a verification assistant for a healthcare workflow validation system.

CONTEXT:
- User Query: "${userQuery}"
- RAG Context: ${ragContext.substring(0, 500)}...
- Validation Status: ${validationResult.status}
- Score: ${validationResult.score}

VALIDATION ISSUES TO REVIEW:
`;

    if (warnings.length > 0) {
        prompt += `\nWARNINGS (${warnings.length}):\n`;
        warnings.forEach((warning, index) => {
            prompt += `${index + 1}. ${warning.message}\n`;
            if (warning.suggested_fix) {
                prompt += `   Suggested Fix: ${warning.suggested_fix.action} (${warning.suggested_fix.from} → ${warning.suggested_fix.to})\n`;
            }
        });
    }

    if (errors.length > 0) {
        prompt += `\nERRORS (${errors.length}):\n`;
        errors.forEach((error, index) => {
            prompt += `${index + 1}. ${error.message}\n`;
        });
    }

    prompt += `\nTASK:
1. Review each warning/error and determine if the suggested fix is appropriate
2. Rate your confidence in the validation (0-1)
3. Provide concrete fix recommendations
4. Identify any invented/hallucinated entities

REQUIRED JSON RESPONSE FORMAT:
{
  "pass": boolean,
  "confidence": number (0-1),
  "invented_entities": [array of strings],
  "issues": [array of issue descriptions],
  "suggested_fixes": [
    {
      "action": "remap_column|remove_column|replace_model|verify_model",
      "from": "original_value",
      "to": "suggested_value",
      "rationale": "explanation",
      "confidence": number (0-1)
    }
  ]
}

EXAMPLES:
- For column "time_to_event" not found but "survival_days" exists: suggest remap with high confidence
- For model "unknown_model" not in compatibility list: suggest verification or replacement
- For completely invalid entities: mark as invented and suggest removal

Respond with ONLY the JSON object, no other text.`;

    return prompt;
}

/**
 * Parse verifier LLM response
 * @param {string} response - Raw response from verifier LLM
 * @returns {Object} Parsed verification results
 */
function parseVerifierResponse(response) {
    try {
        // Extract JSON from response (in case there's extra text)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate required fields
        const requiredFields = ['pass', 'confidence', 'invented_entities', 'issues', 'suggested_fixes'];
        for (const field of requiredFields) {
            if (!(field in parsed)) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        return {
            success: true,
            data: parsed
        };
    } catch (error) {
        console.error('Failed to parse verifier response:', error.message);
        console.error('Raw response:', response);
        
        // Return fallback response
        return {
            success: false,
            data: {
                pass: false,
                confidence: 0.0,
                invented_entities: [],
                issues: ['Failed to parse verifier response'],
                suggested_fixes: []
            }
        };
    }
}

/**
 * Run verifier LLM on validation results
 * @param {Object} validationResult - Results from deterministic validation
 * @param {string} ragContext - RAG context used for validation
 * @param {string} userQuery - Original user query
 * @returns {Promise<Object>} Verifier LLM results
 */
async function runVerifierLLM(validationResult, ragContext, userQuery) {
    console.log('🤖 Running Verifier LLM...');
    
    try {
        // Generate verifier prompt
        const prompt = generateVerifierPrompt(validationResult, ragContext, userQuery);
        
        // Call LLM (using the same function as main LLM)
        const response = await getChatGPTResponse(prompt);
        
        // Parse response
        const parsed = parseVerifierResponse(response.content || response);
        
        if (parsed.success) {
            console.log('✅ Verifier LLM completed successfully');
            console.log(`   Confidence: ${parsed.data.confidence}`);
            console.log(`   Pass: ${parsed.data.pass}`);
            console.log(`   Invented entities: ${parsed.data.invented_entities.length}`);
            console.log(`   Suggested fixes: ${parsed.data.suggested_fixes.length}`);
        } else {
            console.log('⚠️ Verifier LLM failed, using fallback response');
        }
        
        return parsed;
        
    } catch (error) {
        console.error('❌ Verifier LLM error:', error.message);
        
        // Return fallback response
        return {
            success: false,
            data: {
                pass: false,
                confidence: 0.0,
                invented_entities: [],
                issues: [`Verifier LLM error: ${error.message}`],
                suggested_fixes: []
            }
        };
    }
}

/**
 * Apply verifier LLM suggestions to validation results
 * @param {Object} validationResult - Original validation results
 * @param {Object} verifierResult - Verifier LLM results
 * @returns {Object} Enhanced validation results with verifier input
 */
function applyVerifierSuggestions(validationResult, verifierResult) {
    const enhanced = {
        ...validationResult,
        verifier: {
            confidence: verifierResult.data.confidence,
            pass: verifierResult.data.pass,
            invented_entities: verifierResult.data.invented_entities,
            issues: verifierResult.data.issues,
            suggested_fixes: verifierResult.data.suggested_fixes
        }
    };
    
    // Update status based on verifier confidence
    if (verifierResult.data.confidence < 0.5) {
        enhanced.status = 'FAIL';
        enhanced.score = 0.0;
    } else if (verifierResult.data.confidence < 0.8) {
        enhanced.status = 'REVIEW';
        enhanced.score = Math.min(enhanced.score, verifierResult.data.confidence);
    }
    
    // Add verifier suggestions to existing suggestions
    if (verifierResult.data.suggested_fixes.length > 0) {
        enhanced.suggestions = [
            ...(enhanced.suggestions || []),
            ...verifierResult.data.suggested_fixes
        ];
    }
    
    return enhanced;
}

/**
 * Main function to run complete verification pipeline
 * @param {Object} validationResult - Results from deterministic validation
 * @param {string} ragContext - RAG context used for validation
 * @param {string} userQuery - Original user query
 * @returns {Promise<Object>} Complete verification results
 */
async function runCompleteVerification(validationResult, ragContext, userQuery) {
    console.log('🔍 Starting complete verification pipeline...');
    
    // Only run verifier LLM if there are warnings or errors
    if (validationResult.warnings.length === 0 && validationResult.errors.length === 0) {
        console.log('✅ No issues to verify, skipping verifier LLM');
        return validationResult;
    }
    
    // Run verifier LLM
    const verifierResult = await runVerifierLLM(validationResult, ragContext, userQuery);
    
    // Apply verifier suggestions
    const enhancedResult = applyVerifierSuggestions(validationResult, verifierResult);
    
    console.log(`🎯 Verification complete: ${enhancedResult.status} (confidence: ${verifierResult.data.confidence})`);
    
    return enhancedResult;
}

module.exports = {
    generateVerifierPrompt,
    parseVerifierResponse,
    runVerifierLLM,
    applyVerifierSuggestions,
    runCompleteVerification
};

