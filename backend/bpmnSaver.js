const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/**
 * BPMN Diagram Saver with Automatic Folder Management
 * 
 * This module automatically saves all BPMN diagrams (both valid and invalid)
 * into separate folders for later analysis and training purposes.
 */

class BPMNSaver {
    constructor(baseDir = null) {
        // If no baseDir provided, use backend directory
        this.baseDir = baseDir || path.join(__dirname, 'saved_bpmn_diagrams');
        this.goodDiagramsDir = path.join(this.baseDir, 'valid_diagrams');
        this.badDiagramsDir = path.join(this.baseDir, 'invalid_diagrams');
        this.metadataDir = path.join(this.baseDir, 'metadata');
        
        // Initialize folders on instantiation
        this.initializeFolders();
    }

    /**
     * Create the folder structure if it doesn't exist
     */
    initializeFolders() {
        const folders = [
            this.baseDir,
            this.goodDiagramsDir,
            this.badDiagramsDir,
            this.metadataDir
        ];

        folders.forEach(folder => {
            if (!fsSync.existsSync(folder)) {
                fsSync.mkdirSync(folder, { recursive: true });
                console.log(`📁 Created folder: ${folder}`);
            }
        });
    }

    /**
     * Generate a unique filename with timestamp
     * @param {boolean} isValid - Whether the diagram passed validation
     * @param {string} userQuery - The user's original query
     * @returns {string} - Sanitized filename
     */
    generateFilename(isValid, userQuery = '') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const prefix = isValid ? 'valid' : 'invalid';
        
        // Sanitize query for filename (first 50 chars, remove special chars)
        let sanitizedQuery = '';
        if (userQuery) {
            sanitizedQuery = userQuery
                .substring(0, 50)
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, '_');
            sanitizedQuery = '_' + sanitizedQuery;
        }

        return `${prefix}_${timestamp}${sanitizedQuery}.xml`;
    }

    /**
     * Save a BPMN diagram to the appropriate folder
     * @param {string} bpmnXml - The BPMN XML content
     * @param {boolean} isValid - Whether the diagram passed validation
     * @param {Object} metadata - Additional metadata about the diagram
     * @returns {Promise<Object>} - Object containing file paths and status
     */
    async saveDiagram(bpmnXml, isValid, metadata = {}) {
        try {
            const filename = this.generateFilename(isValid, metadata.userQuery);
            const targetDir = isValid ? this.goodDiagramsDir : this.badDiagramsDir;
            const diagramPath = path.join(targetDir, filename);

            // Save the BPMN XML
            await fs.writeFile(diagramPath, bpmnXml, 'utf8');
            console.log(`💾 Saved ${isValid ? 'VALID' : 'INVALID'} diagram: ${filename}`);

            // Save metadata
            const metadataFilename = filename.replace('.xml', '_metadata.json');
            const metadataPath = path.join(this.metadataDir, metadataFilename);
            
            const fullMetadata = {
                timestamp: new Date().toISOString(),
                isValid: isValid,
                filename: filename,
                diagramPath: diagramPath,
                ...metadata
            };

            await fs.writeFile(metadataPath, JSON.stringify(fullMetadata, null, 2), 'utf8');
            console.log(`📋 Saved metadata: ${metadataFilename}`);

            return {
                success: true,
                isValid: isValid,
                diagramPath: diagramPath,
                metadataPath: metadataPath,
                filename: filename
            };

        } catch (error) {
            console.error('❌ Error saving BPMN diagram:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get statistics about saved diagrams
     * @returns {Promise<Object>} - Statistics about saved diagrams
     */
    async getStatistics() {
        try {
            const validFiles = await fs.readdir(this.goodDiagramsDir);
            const invalidFiles = await fs.readdir(this.badDiagramsDir);

            const validCount = validFiles.filter(f => f.endsWith('.xml')).length;
            const invalidCount = invalidFiles.filter(f => f.endsWith('.xml')).length;

            return {
                totalDiagrams: validCount + invalidCount,
                validDiagrams: validCount,
                invalidDiagrams: invalidCount,
                validPercentage: validCount > 0 ? ((validCount / (validCount + invalidCount)) * 100).toFixed(2) : 0,
                goodDiagramsPath: this.goodDiagramsDir,
                badDiagramsPath: this.badDiagramsDir
            };
        } catch (error) {
            console.error('❌ Error getting statistics:', error);
            return null;
        }
    }

    /**
     * Get list of all saved diagrams
     * @param {string} type - 'valid', 'invalid', or 'all'
     * @returns {Promise<Array>} - Array of diagram information
     */
    async listDiagrams(type = 'all') {
        const diagrams = [];

        try {
            if (type === 'valid' || type === 'all') {
                const validFiles = await fs.readdir(this.goodDiagramsDir);
                const validXmls = validFiles.filter(f => f.endsWith('.xml'));
                
                for (const file of validXmls) {
                    diagrams.push({
                        type: 'valid',
                        filename: file,
                        path: path.join(this.goodDiagramsDir, file),
                        metadataPath: path.join(this.metadataDir, file.replace('.xml', '_metadata.json'))
                    });
                }
            }

            if (type === 'invalid' || type === 'all') {
                const invalidFiles = await fs.readdir(this.badDiagramsDir);
                const invalidXmls = invalidFiles.filter(f => f.endsWith('.xml'));
                
                for (const file of invalidXmls) {
                    diagrams.push({
                        type: 'invalid',
                        filename: file,
                        path: path.join(this.badDiagramsDir, file),
                        metadataPath: path.join(this.metadataDir, file.replace('.xml', '_metadata.json'))
                    });
                }
            }

            return diagrams;
        } catch (error) {
            console.error('❌ Error listing diagrams:', error);
            return [];
        }
    }

    /**
     * Print a summary of saved diagrams
     */
    async printSummary() {
        const stats = await this.getStatistics();
        
        if (stats) {
            console.log('\n' + '='.repeat(60));
            console.log('📊 BPMN DIAGRAM COLLECTION SUMMARY');
            console.log('='.repeat(60));
            console.log(`Total Diagrams Collected: ${stats.totalDiagrams}`);
            console.log(`✅ Valid Diagrams: ${stats.validDiagrams}`);
            console.log(`❌ Invalid Diagrams: ${stats.invalidDiagrams}`);
            console.log(`Success Rate: ${stats.validPercentage}%`);
            console.log(`\nValid Diagrams Location: ${stats.goodDiagramsPath}`);
            console.log(`Invalid Diagrams Location: ${stats.badDiagramsPath}`);
            console.log('='.repeat(60) + '\n');
        }
    }
}

module.exports = BPMNSaver;

