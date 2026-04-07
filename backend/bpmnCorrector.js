const xml2js = require("xml2js");

/**
 * Rule-Based BPMN Corrector
 * Fixes the most common error: Disconnected End Event (85% of errors)
 *
 * Error Pattern:
 * - Last task has no outgoing flow (dead-end)
 * - End event has no incoming flow (orphan)
 *
 * Fix:
 * - Add sequence flow connecting dead-end task to orphan end event
 */

class BPMNCorrector {
  constructor() {
    this.parser = new xml2js.Parser({ explicitArray: false });
    this.builder = new xml2js.Builder({
      xmldec: { version: "1.0", encoding: "UTF-8" },
      renderOpts: { pretty: true, indent: "  " },
    });
  }

  /**
   * Parse BPMN XML string to JavaScript object
   */
  async parseXml(xmlString) {
    try {
      return await this.parser.parseStringPromise(xmlString);
    } catch (err) {
      throw new Error(`XML Parsing Error: ${err.message}`);
    }
  }

  /**
   * Convert JavaScript object back to XML string
   */
  buildXml(xmlObj) {
    return this.builder.buildObject(xmlObj);
  }

  /**
   * Extract all elements and sequence flows from BPMN
   */
  extractBPMNElements(process) {
    const elements = [];
    const elementTypes = [
      "bpmn:startEvent",
      "bpmn:endEvent",
      "bpmn:task",
      "bpmn:userTask",
      "bpmn:scriptTask",
      "bpmn:serviceTask",
      "bpmn:exclusiveGateway",
      "bpmn:parallelGateway",
    ];

    elementTypes.forEach((type) => {
      if (process[type]) {
        const processElements = Array.isArray(process[type])
          ? process[type]
          : [process[type]];
        elements.push(
          ...processElements.map((el) => ({
            ...el,
            elementType: type,
          })),
        );
      }
    });

    const sequenceFlows = process["bpmn:sequenceFlow"]
      ? Array.isArray(process["bpmn:sequenceFlow"])
        ? process["bpmn:sequenceFlow"]
        : [process["bpmn:sequenceFlow"]]
      : [];

    return { elements, sequenceFlows };
  }

  /**
   * Find dead-end tasks (no outgoing flow) and orphan end events (no incoming flow)
   */
  findDisconnectedElements(elements, sequenceFlows) {
    const sourceRefs = new Set(sequenceFlows.map((sf) => sf.$.sourceRef));
    const targetRefs = new Set(sequenceFlows.map((sf) => sf.$.targetRef));

    // Find dead-end tasks (not end events, no outgoing flow)
    const deadEndTasks = elements.filter(
      (el) => el.elementType !== "bpmn:endEvent" && !sourceRefs.has(el.$.id),
    );

    // Find orphan end events (no incoming flow)
    const orphanEndEvents = elements.filter(
      (el) => el.elementType === "bpmn:endEvent" && !targetRefs.has(el.$.id),
    );

    return { deadEndTasks, orphanEndEvents };
  }

  /**
   * Generate unique ID for new sequence flow
   */
  generateSequenceFlowId(existingFlows) {
    let maxId = 0;
    existingFlows.forEach((flow) => {
      const match = flow.$.id.match(/SequenceFlow_(\d+)/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1]));
      }
    });
    return `SequenceFlow_${maxId + 1}`;
  }

  /**
   * Update task to add outgoing flow reference
   */
  addOutgoingToTask(process, taskId, flowId) {
    const taskTypes = [
      "bpmn:task",
      "bpmn:userTask",
      "bpmn:scriptTask",
      "bpmn:serviceTask",
      "bpmn:manualTask",
    ];

    for (const taskType of taskTypes) {
      if (process[taskType]) {
        const tasks = Array.isArray(process[taskType])
          ? process[taskType]
          : [process[taskType]];
        const task = tasks.find((t) => t.$.id === taskId);

        if (task) {
          // Add outgoing tag
          if (!task["bpmn:outgoing"]) {
            task["bpmn:outgoing"] = flowId;
          } else if (Array.isArray(task["bpmn:outgoing"])) {
            task["bpmn:outgoing"].push(flowId);
          } else {
            task["bpmn:outgoing"] = [task["bpmn:outgoing"], flowId];
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Update end event to add incoming flow reference
   */
  addIncomingToEndEvent(process, endEventId, flowId) {
    if (process["bpmn:endEvent"]) {
      const endEvents = Array.isArray(process["bpmn:endEvent"])
        ? process["bpmn:endEvent"]
        : [process["bpmn:endEvent"]];
      const endEvent = endEvents.find((e) => e.$.id === endEventId);

      if (endEvent) {
        // Add incoming tag
        if (!endEvent["bpmn:incoming"]) {
          endEvent["bpmn:incoming"] = flowId;
        } else if (Array.isArray(endEvent["bpmn:incoming"])) {
          endEvent["bpmn:incoming"].push(flowId);
        } else {
          endEvent["bpmn:incoming"] = [endEvent["bpmn:incoming"], flowId];
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Add visual diagram edge for the new sequence flow
   */
  addDiagramEdge(parsedXml, flowId, sourceId, targetId) {
    const diagram = parsedXml["bpmn:definitions"]["bpmndi:BPMNDiagram"];
    if (!diagram) return false;

    const plane = diagram["bpmndi:BPMNPlane"];
    if (!plane) return false;

    // Find source and target shapes to calculate waypoints
    const shapes = plane["bpmndi:BPMNShape"];
    const shapeArray = Array.isArray(shapes) ? shapes : shapes ? [shapes] : [];

    const sourceShape = shapeArray.find((s) => s.$?.bpmnElement === sourceId);
    const targetShape = shapeArray.find((s) => s.$?.bpmnElement === targetId);

    if (sourceShape && targetShape) {
      const sourceBounds = sourceShape["dc:Bounds"];
      const targetBounds = targetShape["dc:Bounds"];

      if (sourceBounds && targetBounds) {
        // Calculate waypoints (right edge of source to left edge of target)
        const sourceX =
          parseFloat(sourceBounds.$.x) + parseFloat(sourceBounds.$.width);
        const sourceY =
          parseFloat(sourceBounds.$.y) + parseFloat(sourceBounds.$.height) / 2;
        const targetX = parseFloat(targetBounds.$.x);
        const targetY =
          parseFloat(targetBounds.$.y) + parseFloat(targetBounds.$.height) / 2;

        // Create edge
        const newEdge = {
          $: {
            id: `${flowId}_di`,
            bpmnElement: flowId,
          },
          "di:waypoint": [
            { $: { x: sourceX.toString(), y: sourceY.toString() } },
            { $: { x: targetX.toString(), y: targetY.toString() } },
          ],
        };

        // Add to plane
        if (!plane["bpmndi:BPMNEdge"]) {
          plane["bpmndi:BPMNEdge"] = [];
        }
        if (!Array.isArray(plane["bpmndi:BPMNEdge"])) {
          plane["bpmndi:BPMNEdge"] = [plane["bpmndi:BPMNEdge"]];
        }
        plane["bpmndi:BPMNEdge"].push(newEdge);

        console.log(`   ✅ Added visual edge: ${sourceId} → ${targetId}`);
        return true;
      }
    }

    console.log(`   ⚠️  Could not add visual edge (shapes not found)`);
    return false;
  }

  /**
   * Main correction method for disconnected end events
   */
  correctDisconnectedEndEvent(parsedXml) {
    const process = parsedXml["bpmn:definitions"]["bpmn:process"];
    if (!process) {
      return { success: false, message: "No process found in BPMN diagram" };
    }

    const { elements, sequenceFlows } = this.extractBPMNElements(process);
    const { deadEndTasks, orphanEndEvents } = this.findDisconnectedElements(
      elements,
      sequenceFlows,
    );

    console.log(`\n🔧 CORRECTOR ANALYSIS:`);
    console.log(`   Dead-end tasks: ${deadEndTasks.length}`);
    console.log(`   Orphan end events: ${orphanEndEvents.length}`);

    // Simple case: exactly 1 dead-end task and 1 orphan end event
    if (deadEndTasks.length === 1 && orphanEndEvents.length === 1) {
      const deadEnd = deadEndTasks[0];
      const orphanEnd = orphanEndEvents[0];

      console.log(`   ✅ Simple case detected`);
      console.log(
        `   Connecting: "${deadEnd.$.name || deadEnd.$.id}" → "${orphanEnd.$.name || orphanEnd.$.id}"`,
      );

      // Create new sequence flow
      const newFlowId = this.generateSequenceFlowId(sequenceFlows);
      const newFlow = {
        $: {
          id: newFlowId,
          sourceRef: deadEnd.$.id,
          targetRef: orphanEnd.$.id,
        },
      };

      // Add to sequence flows
      if (!process["bpmn:sequenceFlow"]) {
        process["bpmn:sequenceFlow"] = [];
      }
      if (!Array.isArray(process["bpmn:sequenceFlow"])) {
        process["bpmn:sequenceFlow"] = [process["bpmn:sequenceFlow"]];
      }
      process["bpmn:sequenceFlow"].push(newFlow);

      // Add outgoing to dead-end task
      this.addOutgoingToTask(process, deadEnd.$.id, newFlowId);

      // Add incoming to orphan end event
      this.addIncomingToEndEvent(process, orphanEnd.$.id, newFlowId);

      // Add visual diagram edge
      this.addDiagramEdge(parsedXml, newFlowId, deadEnd.$.id, orphanEnd.$.id);

      return {
        success: true,
        message: `Connected dead-end task "${deadEnd.$.name}" to end event "${orphanEnd.$.name}"`,
        correction: {
          type: "disconnected_end_event",
          sourceTask: deadEnd.$.name || deadEnd.$.id,
          targetEvent: orphanEnd.$.name || orphanEnd.$.id,
          newFlowId: newFlowId,
        },
      };
    }

    // Multiple dead-ends or orphans - more complex
    if (deadEndTasks.length > 1 || orphanEndEvents.length > 1) {
      console.log(`   ⚠️  Complex case: Multiple dead-ends or orphans`);
      return {
        success: false,
        message: `Complex error: ${deadEndTasks.length} dead-end tasks and ${orphanEndEvents.length} orphan end events. Requires manual inspection.`,
        details: {
          deadEndTasks: deadEndTasks.map((t) => t.$.name || t.$.id),
          orphanEndEvents: orphanEndEvents.map((e) => e.$.name || e.$.id),
        },
      };
    }

    // No disconnected elements found
    return {
      success: false,
      message:
        "No disconnected end event error found. Diagram may have a different error type.",
    };
  }

  /**
   * Auto-generate BPMNDiagram layout when shapes are missing
   * Creates a simple left-to-right layout based on BFS traversal from start event
   */
  correctEmptyDiagram(parsedXml) {
    const process = parsedXml["bpmn:definitions"]["bpmn:process"];
    if (!process) {
      return { success: false, message: "No process found" };
    }

    const { elements, sequenceFlows } = this.extractBPMNElements(process);

    // Check if diagram is actually empty
    const diagram = parsedXml["bpmn:definitions"]["bpmndi:BPMNDiagram"];
    if (!diagram) {
      return { success: false, message: "No BPMNDiagram element found" };
    }

    const plane = diagram["bpmndi:BPMNPlane"];
    if (!plane) {
      return { success: false, message: "No BPMNPlane element found" };
    }

    const existingShapes = plane["bpmndi:BPMNShape"];
    const shapeCount = existingShapes
      ? Array.isArray(existingShapes)
        ? existingShapes.length
        : 1
      : 0;
    if (shapeCount > 0) {
      return { success: false, message: "Diagram already has shapes" };
    }

    console.log(
      `\n🔧 AUTO-LAYOUT: Generating visual layout for ${elements.length} elements...`,
    );

    // BFS traversal from start event to determine column positions
    const startEvent = elements.find(
      (el) => el.elementType === "bpmn:startEvent",
    );
    if (!startEvent) {
      return { success: false, message: "No start event found for layout" };
    }

    // Build adjacency list
    const adjacency = {};
    sequenceFlows.forEach((sf) => {
      if (!adjacency[sf.$.sourceRef]) adjacency[sf.$.sourceRef] = [];
      adjacency[sf.$.sourceRef].push(sf.$.targetRef);
    });

    // BFS to assign columns
    const columns = {};
    const visited = new Set();
    const queue = [{ id: startEvent.$.id, col: 0 }];
    const columnElements = {}; // col -> [ids]

    while (queue.length > 0) {
      const { id, col } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      columns[id] = col;

      if (!columnElements[col]) columnElements[col] = [];
      columnElements[col].push(id);

      const targets = adjacency[id] || [];
      targets.forEach((targetId) => {
        if (!visited.has(targetId)) {
          queue.push({ id: targetId, col: col + 1 });
        }
      });
    }

    // Generate shapes with positions
    const X_SPACING = 200;
    const Y_SPACING = 120;
    const X_OFFSET = 100;
    const Y_OFFSET = 100;

    const shapes = [];
    const elementPositions = {};

    elements.forEach((el) => {
      const col = columns[el.$.id];
      if (col === undefined) return; // unreachable element

      const row = columnElements[col].indexOf(el.$.id);
      const isEvent =
        el.elementType === "bpmn:startEvent" ||
        el.elementType === "bpmn:endEvent";
      const isGateway = el.elementType.includes("Gateway");

      const width = isEvent ? 36 : isGateway ? 50 : 100;
      const height = isEvent ? 36 : isGateway ? 50 : 80;

      const x = X_OFFSET + col * X_SPACING;
      const y = Y_OFFSET + row * Y_SPACING;

      elementPositions[el.$.id] = { x, y, width, height };

      shapes.push({
        $: {
          id: `${el.$.id}_di`,
          bpmnElement: el.$.id,
        },
        "dc:Bounds": {
          $: {
            x: x.toString(),
            y: y.toString(),
            width: width.toString(),
            height: height.toString(),
          },
        },
      });
    });

    // Generate edges with waypoints
    const edges = [];
    sequenceFlows.forEach((sf) => {
      const sourcePos = elementPositions[sf.$.sourceRef];
      const targetPos = elementPositions[sf.$.targetRef];

      if (sourcePos && targetPos) {
        const sourceX = sourcePos.x + sourcePos.width;
        const sourceY = sourcePos.y + sourcePos.height / 2;
        const targetX = targetPos.x;
        const targetY = targetPos.y + targetPos.height / 2;

        edges.push({
          $: {
            id: `${sf.$.id}_di`,
            bpmnElement: sf.$.id,
          },
          "di:waypoint": [
            { $: { x: sourceX.toString(), y: sourceY.toString() } },
            { $: { x: targetX.toString(), y: targetY.toString() } },
          ],
        });
      }
    });

    // Set shapes and edges on the plane
    plane["bpmndi:BPMNShape"] = shapes;
    plane["bpmndi:BPMNEdge"] = edges;

    console.log(
      `   ✅ Generated ${shapes.length} shapes and ${edges.length} edges`,
    );

    return {
      success: true,
      message: `Auto-generated layout: ${shapes.length} shapes, ${edges.length} edges`,
    };
  }

  /**
   * Main entry point: Correct BPMN diagram
   */
  async correctBPMN(xmlString) {
    try {
      // Parse XML
      const parsedXml = await this.parseXml(xmlString);

      // First: check for empty diagram (missing visual layout)
      const layoutResult = this.correctEmptyDiagram(parsedXml);
      if (layoutResult.success) {
        console.log(`✅ Layout correction: ${layoutResult.message}`);
      }

      // Then: attempt structural correction
      const result = this.correctDisconnectedEndEvent(parsedXml);

      if (result.success || layoutResult.success) {
        // Build corrected XML
        const correctedXml = this.buildXml(parsedXml);
        return {
          success: true,
          correctedXml: correctedXml,
          message: [
            layoutResult.success ? layoutResult.message : null,
            result.success ? result.message : null,
          ]
            .filter(Boolean)
            .join("; "),
          correction: result.correction || { type: "empty_diagram_layout" },
        };
      } else {
        return {
          success: false,
          message: result.message,
          details: result.details,
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `Correction failed: ${err.message}`,
      };
    }
  }

  /**
   * Batch correct multiple diagrams
   */
  async correctBatch(xmlStrings) {
    const results = [];
    for (let i = 0; i < xmlStrings.length; i++) {
      console.log(`\n📝 Processing diagram ${i + 1}/${xmlStrings.length}...`);
      const result = await this.correctBPMN(xmlStrings[i]);
      results.push(result);
    }
    return results;
  }
}

module.exports = BPMNCorrector;
