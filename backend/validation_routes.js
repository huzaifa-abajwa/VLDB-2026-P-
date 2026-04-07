const express = require('express');
const { validateWorkflow, applySuggestedFixes } = require('./validator');
const { runCompleteVerification } = require('./verifier_llm');
const { executeDryRun } = require('./dry_run_executor');

const router = express.Router();

/**
 * Apply suggested fixes to validation results
 */
router.post('/apply-fixes', async (req, res) => {
    try {
        const { fixes, validationResult } = req.body;
        
        console.log('🔧 Applying fixes:', fixes.length);
        
        // Apply fixes to BPMN XML if available
        let updatedBpmnXml = validationResult.bpmnXml || '';
        let updatedValidationResult = { ...validationResult };
        
        for (const fix of fixes) {
            console.log(`  Applying fix: ${fix.action} (${fix.from} → ${fix.to})`);
            
            switch (fix.action) {
                case 'remap_column':
                    // Update BPMN XML with column remapping
                    updatedBpmnXml = updatedBpmnXml.replace(
                        new RegExp(`\\b${fix.from}\\b`, 'g'),
                        fix.to
                    );
                    console.log(`    ✅ Column remapped: ${fix.from} → ${fix.to}`);
                    break;
                    
                case 'replace_model':
                    // Update BPMN XML with model replacement
                    updatedBpmnXml = updatedBpmnXml.replace(
                        new RegExp(`\\b${fix.from}\\b`, 'g'),
                        fix.to
                    );
                    console.log(`    ✅ Model replaced: ${fix.from} → ${fix.to}`);
                    break;
                    
                case 'remove_column':
                    // Remove column references from BPMN XML
                    updatedBpmnXml = updatedBpmnXml.replace(
                        new RegExp(`\\b${fix.from}\\b`, 'g'),
                        ''
                    );
                    console.log(`    ✅ Column removed: ${fix.from}`);
                    break;
                    
                case 'verify_model':
                    console.log(`    ℹ️ Model verification needed: ${fix.from}`);
                    break;
                    
                default:
                    console.log(`    ⚠️ Unknown fix action: ${fix.action}`);
            }
        }
        
        // Update validation result
        updatedValidationResult.bpmnXml = updatedBpmnXml;
        updatedValidationResult.fixesApplied = fixes;
        updatedValidationResult.fixTimestamp = new Date().toISOString();
        
        // Re-validate if BPMN XML was updated
        if (updatedBpmnXml !== validationResult.bpmnXml) {
            console.log('🔄 Re-validating after fixes...');
            
            // Extract datasets and models from the updated validation result
            const selectedDatasets = validationResult.selectedDatasets || [];
            const selectedModels = validationResult.selectedModels || [];
            const ragContext = validationResult.ragContext || '';
            const modelCompatibility = validationResult.modelCompatibility || {};
            
            // Re-run validation
            const revalidationInitial = await validateWorkflow({
                bpmnXml: updatedBpmnXml,
                selectedDatasets,
                selectedModels,
                ragContext,
                modelCompatibility
            });
            
            const revalidationResult = await runCompleteVerification(
                revalidationInitial,
                ragContext,
                validationResult.userQuery || ''
            );
            
            // Merge results
            updatedValidationResult = {
                ...updatedValidationResult,
                ...revalidationResult,
                previousResult: validationResult
            };
            
            console.log(`✅ Re-validation complete: ${updatedValidationResult.status}`);
        }
        
        res.json({
            success: true,
            updatedResult: updatedValidationResult,
            fixesApplied: fixes.length,
            message: `Applied ${fixes.length} fix${fixes.length > 1 ? 'es' : ''} successfully`
        });
        
    } catch (error) {
        console.error('❌ Error applying fixes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Validate workflow with enhanced validation
 */
router.post('/validate-workflow', async (req, res) => {
    try {
        const { bpmnXml, selectedDatasets, selectedModels, ragContext, modelCompatibility, userQuery } = req.body;
        
        console.log('🔍 Validating workflow...');
        console.log(`  Datasets: ${selectedDatasets.join(', ')}`);
        console.log(`  Models: ${selectedModels.join(', ')}`);
        
        // First run deterministic validation
        const initialValidation = await validateWorkflow({
            bpmnXml,
            selectedDatasets,
            selectedModels,
            ragContext,
            modelCompatibility
        });
        
        // Then run complete verification pipeline (includes Verifier LLM if needed)
        const validationResult = await runCompleteVerification(
            initialValidation,
            ragContext,
            userQuery
        );
        
        // Add metadata
        validationResult.bpmnXml = bpmnXml;
        validationResult.selectedDatasets = selectedDatasets;
        validationResult.selectedModels = selectedModels;
        validationResult.ragContext = ragContext;
        validationResult.modelCompatibility = modelCompatibility;
        validationResult.userQuery = userQuery;
        validationResult.timestamp = new Date().toISOString();
        
        res.json({
            success: true,
            validationResult
        });
        
    } catch (error) {
        console.error('❌ Validation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Execute a safe dry-run of the BPMN
 */
router.post('/dry-run', async (req, res) => {
    try {
        const { bpmnXml } = req.body;
        if (!bpmnXml) {
            return res.status(400).json({ success: false, error: 'bpmnXml is required' });
        }
        const result = await executeDryRun(bpmnXml);
        res.json({ success: true, result });
    } catch (error) {
        console.error('❌ Dry-run error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get validation status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        status: 'Validation service running',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;

