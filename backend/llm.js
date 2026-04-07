require('dotenv').config();

const axios = require("axios");
const fs = require("fs");
// const { OpenAI } = require("openai");
const path = require('path');


// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY, 
// });

const modelJsonPath = "./model.json";
const datasetJsonPath = "./dataset.json";

const MAX_RETRIES = 3;
const RETRY_DELAY = 3000;

function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const jsonData = JSON.parse(data);
    return JSON.stringify(jsonData, null, 2);
  } catch (error) {
    console.error(`Error reading the JSON file at ${filePath}:`, error);
    return null;
  }
}

// async function getChatGPTResponse(prompt, retries = 0) {
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [
//         {
//           role: "user",
//           content: prompt,
//         },
//       ],
//     });

//     return response.choices[0].message;
//   } catch (error) {
//     if (error.response && error.response.status === 429 && retries < MAX_RETRIES) {
//       console.log(
//         `Rate limit hit. Retrying in ${RETRY_DELAY / 1000
//         } seconds... (Attempt ${retries + 1}/${MAX_RETRIES})`
//       );
//       await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
//       return getChatGPTResponse(prompt, retries + 1);
//     } else {
//       console.error("Error fetching response from ChatGPT:", error);
//       return "Error occurred while fetching the response.";
//     }
//   }
// }

async function getChatGPTResponse(prompt, retries = 0) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "google/gemini-2.5-pro", // Updated to Gemini 2.5 Pro
        messages: [
          {
            role: "user",
            content: prompt, // Assuming prompt is a string, as per your original code
          },
        ],
        temperature: 0,
        max_tokens: 66000, // Set to a safe max output token limit; adjust based on OpenRouter's Gemini 2.5 Pro specs
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000', // Optional for OpenRouter leaderboards
          'X-Title': process.env.SITE_NAME || 'BPMN Generator', // Optional for OpenRouter leaderboards
        },
      }
    );

    // console.log("API Response received successfully from Gemini 2.5 Pro");
    // return response.data.choices[0].message;

    // Check if the response contains the expected data
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      console.log("API Response received successfully from Gemini 2.5 Pro");
      return response.data.choices[0].message;
    } else {
      console.error("API returned unexpected structure:", JSON.stringify(response.data, null, 2));
      throw new Error("Invalid response structure from API.");
    }
  } catch (error) {
    console.error("API Error Details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });

    if (error.response && error.response.status === 429 && retries < MAX_RETRIES) {
      console.log(
        `Rate limit hit. Retrying in ${RETRY_DELAY / 1000} seconds... (Attempt ${retries + 1}/${MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return getChatGPTResponse(prompt, retries + 1);
    } else {
      console.error("Error fetching response from Gemini 2.5 Pro via OpenRouter:", error.response?.data || error.message);
      return {
        content: "Error occurred while fetching the response.",
        error: true,
      };
    }
  }
}

const frontendPublicPath = path.join(__dirname, '../hugging/public');
function saveBPMNtoXML(content) {
  const regex = /\*\*(.*?)\*\*\s*```xml\n([\s\S]*?)```/g;


  // Delete BPMN XML files in the backend directory
  const localDirectory = __dirname;
  fs.readdirSync(localDirectory).forEach(file => {
    if (file.endsWith('.xml')) {
      const filePath = path.join(localDirectory, file);
      fs.unlinkSync(filePath);
      console.log(`Deleted BPMN XML file in backend directory: ${filePath}`);
    }
  });

  // Delete BPMN XML files in the frontend public directory
  fs.readdirSync(frontendPublicPath).forEach(file => {
    if (file.endsWith('.xml')) {
      const filePath = path.join(frontendPublicPath, file);
      fs.unlinkSync(filePath);
      console.log(`Deleted BPMN XML file in frontend public directory: ${filePath}`);
    }
  });

  let match;

  // Find all XML code blocks in the content
  while ((match = regex.exec(content)) !== null) {
    const scenarioDescription = match[1].trim();
    const xmlData = match[2].trim();
    console.log(scenarioDescription)

    // Generate a filename based on the scenario description
    const filename = scenarioDescription.toLowerCase().replace(/\s+/g, '_') + '.xml';

    // Remove any invalid characters from filename
    const safeFilename = filename.replace(/[^a-z0-9_\-\.]/gi, '');

    // Define the full path for the local file
    const localFilePath = path.join(__dirname, safeFilename);

    // Save the XML data to the local file
    fs.writeFileSync(localFilePath, xmlData);
    console.log(`BPMN XML saved to ${localFilePath}`);

    // Define the destination path in the frontend's public folder
    const destinationPath = path.join(frontendPublicPath, safeFilename);

    try {
      // Copy the file to the frontend's public folder
      fs.copyFileSync(localFilePath, destinationPath);
      console.log(`BPMN XML copied to ${destinationPath}`);
    } catch (error) {
      console.error(`Error copying file to frontend public folder: ${error}`);
    }
  }
}

function saveWholeResponseToJson(content) {
  const jsonFilePath = 'whole_response.json';
  let existingResponses = [];

  // Check if the file exists and has valid content
  if (fs.existsSync(jsonFilePath)) {
    try {
      const fileData = fs.readFileSync(jsonFilePath, 'utf8');
      existingResponses = JSON.parse(fileData); // Load existing responses

      // Ensure existing responses are an array
      if (!Array.isArray(existingResponses)) {
        existingResponses = []; // If it's not an array, reset to an empty array
      }
    } catch (error) {
      console.error("Error parsing JSON. Resetting the response array.", error);
      existingResponses = [];
    }
  }

  // Add new content
  existingResponses.push(content);

  // Save back to the file
  fs.writeFileSync(jsonFilePath, JSON.stringify(existingResponses, null, 2));
  console.log(`Whole response saved to ${jsonFilePath}`);
}

function extractAndSaveModelDatasetNames(responseContent) {
  const datasets = [];
  const models = [];

  // Remove markdown bold markers from each line and trim whitespace
  const lines = responseContent.split('\n').map(line => line.replace(/\*\*/g, '').trim());

  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('- Datasets:')) {
      currentSection = 'datasets';
      continue;
    } else if (line.startsWith('- Models:')) {
      currentSection = 'models';
      continue;
    } else if (line.startsWith('- ')) {
      // It's an item under the current section
      if (currentSection) {
        const item = line.substring(2).trim();
        if (currentSection === 'datasets') {
          datasets.push(item);
        } else if (currentSection === 'models') {
          models.push(item);
        }
      }
    } else {
      // Reset section when the line doesn't match
      currentSection = null;
    }
  }

  const result = { datasets, models };
  const filePath = 'models_datasets_names_1.json';
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  console.log(`Models and Datasets saved to ${filePath}`);
}



async function promptUserForInput(input) {
  const startTime = Date.now(); // Start time
  console.log("the input is : ", input)
  const modelJsonDataString = readJsonFile(modelJsonPath);
  const datasetJsonDataString = readJsonFile(datasetJsonPath);

  if (modelJsonDataString && datasetJsonDataString) {
    console.log("here!!")
    const customPromptBefore = `
        We have developed a platform where access control policies for a dataset or model are compared against a user's credentials and verified using a deployed smart contract. Users can also define workflows using plain English, and you will help us translate them into BPMN code. 
        Here is the information you will use:
        
        Datasets:
        ${datasetJsonDataString}
        
        Models:
        ${modelJsonDataString}
        
        The user's provided workflow is:
        `;

    const customPromptAfter = `
        ------
        Your task is to interpret the workflow, list the **Datasets** and **Models** separately using their actual names identified from the user's workflow, and then generate **BPMN (in XML)** diagrams for different numbers of datasets and models, using their actual names in the diagrams.
        
        **Instructions:**
        
        1. **List Datasets and Models**: Start by listing the **Datasets** and **Models** identified from the user's workflow, using their actual names, formatted as follows:
        
        - Datasets:
            - [list all relevant datasets here]
        
        - Models:
            - [list all relevant models here]
        
        2. Use Actual Names in Diagrams:

If there is only one dataset or model: Show it in its own box labeled with its actual name.
If there are exactly two datasets or models that must be combined into one box (due to a single task element in the flow): Use a combined label such as "cox_model@2020.py/kaplan_meier_model@2020.py" for two models, or a similar format for two datasets.
Otherwise, if space allows or the flow requires separate tasks for each resource, create separate boxes for each dataset/model.
        
        3. **Generate BPMN Diagrams**: Generate separate BPMN diagrams for the following scenarios:
            - **Default Diagram**: No datasets or models selected.
            - **Single Model and Single Dataset**.
            - **Single Model and Multiple Datasets**.
            - **Multiple Models and Single Dataset**.
            - **Multiple Models and Multiple Datasets**.
            - **Single Model and Single Dataset with filter**.
            - **Single Model and Multiple Datasets with filter**.
            - **Multiple Models and Single Dataset with filter**.
            - **Multiple Models and Multiple Datasets with filter**.
            - **Single Model and Single Dataset with 2 filters**.
            - **Single Model and Multiple Datasets with 2 filters**.
            - **Multiple Models and Single Dataset with 2 filters**.
            - **Multiple Models and Multiple Datasets with 2 filters**.
            - **Single Model and Single Dataset with 3 filters**.
            - **Single Model and Multiple Datasets with 3 filters**.
            - **Multiple Models and Single Dataset with 3 filters**.
            - **Multiple Models and Multiple Datasets with 3 filters**.
        
        4. **Output Format**: Each BPMN diagram should be outputted in a separate XML code block, preceded by a heading indicating the scenario it represents. Use the following format:
        
        **[Scenario Description]**
        
        \`\`\`xml
        [Your BPMN XML code here]
        \`\`\`
        
        **Rules for BPMN Diagram Generation:**
        
        - **Single Model and Single Dataset**: Generate a simple linear flow.
        - **Multiple Datasets**: Use parallel gateways to process datasets simultaneously.
        - **Multiple Models**: Use appropriate sequencing or parallelism based on the workflow.
        - **With Filter**: Use a filter object that represents data being filtered for stratification. Filter is applied on each dataset before the model is applied.
        - **Model Feeding into Another Model**: Represent this as a sequence flow from one model task to the next.
        
        Your response should contain **only the lists and the BPMN XML diagrams** as per the format specified.
        
        **Note:**
        - Use the actual names of datasets and models when listing them at the start.
        - Use generic names (dataset1, model1, etc.) in the BPMN diagrams.
        
        ---
        
        Use this and the provided rules as a baseline to generate the BPMN code:
                    
                    
                    1. **If the workflow involves a single dataset and a single model**: Generate a simple linear flow with tasks corresponding to the dataset and model. This is what it may look like:
        <?xml version="1.0" encoding="UTF-8"?>
        <bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                            xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                            xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                            id="Definitions_2"
                            targetNamespace="http://bpmn.io/schema/bpmn">
            <bpmn:process id="Process_2" isExecutable="false">
            <!-- Start Event -->
            <bpmn:startEvent id="StartEvent_2" name="Start">
                <bpmn:outgoing>SequenceFlow_9</bpmn:outgoing>
            </bpmn:startEvent>
        
            <!-- Task: Run Logistic Regression -->
            <bpmn:task id="Task_RunLogisticRegression" name="Run Logistic Regression">
                <bpmn:incoming>SequenceFlow_9</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_10</bpmn:outgoing>
            </bpmn:task>
        
            <!-- Task: Generate Output -->
            <bpmn:task id="Task_GenerateOutput" name="Generate Output">
                <bpmn:incoming>SequenceFlow_10</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_11</bpmn:outgoing>
            </bpmn:task>
        
            <!-- End Event -->
            <bpmn:endEvent id="EndEvent_2" name="End">
                <bpmn:incoming>SequenceFlow_11</bpmn:incoming>
            </bpmn:endEvent>
        
            <!-- Sequence Flows -->
            <bpmn:sequenceFlow id="SequenceFlow_9" sourceRef="StartEvent_2" targetRef="Task_RunLogisticRegression" />
            <bpmn:sequenceFlow id="SequenceFlow_10" sourceRef="Task_RunLogisticRegression" targetRef="Task_GenerateOutput" />
            <bpmn:sequenceFlow id="SequenceFlow_11" sourceRef="Task_GenerateOutput" targetRef="EndEvent_2" />
            </bpmn:process>
        
            <!-- BPMN Diagram Information -->
            <bpmndi:BPMNDiagram id="BPMNDiagram_2">
            <bpmndi:BPMNPlane id="BPMNPlane_2" bpmnElement="Process_2">
                <!-- Start Event Shape -->
                <bpmndi:BPMNShape id="StartEvent_2_di" bpmnElement="StartEvent_2">
                <dc:Bounds x="100" y="100" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Run Logistic Regression Shape -->
                <bpmndi:BPMNShape id="Task_RunLogisticRegression_di" bpmnElement="Task_RunLogisticRegression">
                <dc:Bounds x="200" y="90" width="150" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Generate Output Shape -->
                <bpmndi:BPMNShape id="Task_GenerateOutput_di" bpmnElement="Task_GenerateOutput">
                <dc:Bounds x="400" y="90" width="150" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- End Event Shape -->
                <bpmndi:BPMNShape id="EndEvent_2_di" bpmnElement="EndEvent_2">
                <dc:Bounds x="600" y="118" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- Sequence Flow: Start to Run Logistic Regression -->
                <bpmndi:BPMNEdge id="SequenceFlow_9_di" bpmnElement="SequenceFlow_9">
                <di:waypoint x="136" y="118" />
                <di:waypoint x="200" y="130" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Run Logistic Regression to Generate Output -->
                <bpmndi:BPMNEdge id="SequenceFlow_10_di" bpmnElement="SequenceFlow_10">
                <di:waypoint x="350" y="130" />
                <di:waypoint x="400" y="130" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Generate Output to End -->
                <bpmndi:BPMNEdge id="SequenceFlow_11_di" bpmnElement="SequenceFlow_11">
                <di:waypoint x="550" y="130" />
                <di:waypoint x="600" y="136" />
                </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
            </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        
                    2. **If the workflow involves multiple datasets**: Create a parallel gateway that processes each dataset simultaneously and joins them for further steps.
                    3. **If the workflow involves multiple datasets and one model**: Use a parallel gateway to process each dataset, followed by a single task for the model after all datasets are processed. This is what it may look like:
        
                    <?xml version="1.0" encoding="UTF-8"?>
        <bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                            xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                            xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                            id="Definitions_1"
                            targetNamespace="http://bpmn.io/schema/bpmn">
            <bpmn:process id="Process_1" isExecutable="false">
            <!-- Start Event -->
            <bpmn:startEvent id="StartEvent_1" name="Start">
                <bpmn:outgoing>SequenceFlow_1</bpmn:outgoing>
            </bpmn:startEvent>
        
            <!-- Parallel Gateway (Fork) -->
            <bpmn:parallelGateway id="ParallelGateway_1" name="Fork">
                <bpmn:incoming>SequenceFlow_1</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_2</bpmn:outgoing>
                <bpmn:outgoing>SequenceFlow_3</bpmn:outgoing>
            </bpmn:parallelGateway>
        
            <!-- Task: Run Logistic Regression on Dataset 1 -->
            <bpmn:task id="Task_RunDataset1" name="Run Logistic Regression on Dataset 1">
                <bpmn:incoming>SequenceFlow_2</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_4</bpmn:outgoing>
            </bpmn:task>
        
            <!-- Task: Run Logistic Regression on Dataset 2 -->
            <bpmn:task id="Task_RunDataset2" name="Run Logistic Regression on Dataset 2">
                <bpmn:incoming>SequenceFlow_3</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_5</bpmn:outgoing>
            </bpmn:task>
        
            <!-- Parallel Gateway (Join) -->
            <bpmn:parallelGateway id="ParallelGateway_2" name="Join">
                <bpmn:incoming>SequenceFlow_4</bpmn:incoming>
                <bpmn:incoming>SequenceFlow_5</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_6</bpmn:outgoing>
            </bpmn:parallelGateway>
        
            <!-- Task: Compare Outputs -->
            <bpmn:task id="Task_CompareOutputs" name="Compare Outputs">
                <bpmn:incoming>SequenceFlow_6</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_7</bpmn:outgoing>
            </bpmn:task>
        
            <!-- Task: Generate Final Output -->
            <bpmn:task id="Task_FinalOutput" name="Generate Final Output">
                <bpmn:incoming>SequenceFlow_7</bpmn:incoming>
                <bpmn:outgoing>SequenceFlow_8</bpmn:outgoing>
            </bpmn:task>
        
            <!-- End Event -->
            <bpmn:endEvent id="EndEvent_1" name="End">
                <bpmn:incoming>SequenceFlow_8</bpmn:incoming>
            </bpmn:endEvent>
        
            <!-- Sequence Flows -->
            <bpmn:sequenceFlow id="SequenceFlow_1" sourceRef="StartEvent_1" targetRef="ParallelGateway_1" />
            <bpmn:sequenceFlow id="SequenceFlow_2" sourceRef="ParallelGateway_1" targetRef="Task_RunDataset1" />
            <bpmn:sequenceFlow id="SequenceFlow_3" sourceRef="ParallelGateway_1" targetRef="Task_RunDataset2" />
            <bpmn:sequenceFlow id="SequenceFlow_4" sourceRef="Task_RunDataset1" targetRef="ParallelGateway_2" />
            <bpmn:sequenceFlow id="SequenceFlow_5" sourceRef="Task_RunDataset2" targetRef="ParallelGateway_2" />
            <bpmn:sequenceFlow id="SequenceFlow_6" sourceRef="ParallelGateway_2" targetRef="Task_CompareOutputs" />
            <bpmn:sequenceFlow id="SequenceFlow_7" sourceRef="Task_CompareOutputs" targetRef="Task_FinalOutput" />
            <bpmn:sequenceFlow id="SequenceFlow_8" sourceRef="Task_FinalOutput" targetRef="EndEvent_1" />
            </bpmn:process>
        
            <!-- BPMN Diagram Information -->
            <bpmndi:BPMNDiagram id="BPMNDiagram_1">
            <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
                <!-- Start Event Shape -->
                <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
                <dc:Bounds x="100" y="100" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- Parallel Gateway (Fork) Shape -->
                <bpmndi:BPMNShape id="ParallelGateway_1_di" bpmnElement="ParallelGateway_1" isMarkerVisible="true">
                <dc:Bounds x="200" y="100" width="50" height="50" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Run Logistic Regression on Dataset 1 Shape -->
                <bpmndi:BPMNShape id="Task_RunDataset1_di" bpmnElement="Task_RunDataset1">
                <dc:Bounds x="300" y="50" width="120" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Run Logistic Regression on Dataset 2 Shape -->
                <bpmndi:BPMNShape id="Task_RunDataset2_di" bpmnElement="Task_RunDataset2">
                <dc:Bounds x="300" y="150" width="120" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- Parallel Gateway (Join) Shape -->
                <bpmndi:BPMNShape id="ParallelGateway_2_di" bpmnElement="ParallelGateway_2" isMarkerVisible="true">
                <dc:Bounds x="450" y="100" width="50" height="50" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Compare Outputs Shape -->
                <bpmndi:BPMNShape id="Task_CompareOutputs_di" bpmnElement="Task_CompareOutputs">
                <dc:Bounds x="550" y="100" width="120" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- Task: Generate Final Output Shape -->
                <bpmndi:BPMNShape id="Task_FinalOutput_di" bpmnElement="Task_FinalOutput">
                <dc:Bounds x="700" y="100" width="120" height="80" />
                </bpmndi:BPMNShape>
        
                <!-- End Event Shape -->
                <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
                <dc:Bounds x="850" y="118" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- Sequence Flow: Start to Fork -->
                <bpmndi:BPMNEdge id="SequenceFlow_1_di" bpmnElement="SequenceFlow_1">
                <di:waypoint x="136" y="118" />
                <di:waypoint x="200" y="125" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Fork to Task 1 -->
                <bpmndi:BPMNEdge id="SequenceFlow_2_di" bpmnElement="SequenceFlow_2">
                <di:waypoint x="250" y="125" />
                <di:waypoint x="300" y="90" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Fork to Task 2 -->
                <bpmndi:BPMNEdge id="SequenceFlow_3_di" bpmnElement="SequenceFlow_3">
                <di:waypoint x="250" y="125" />
                <di:waypoint x="300" y="190" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Task 1 to Join -->
                <bpmndi:BPMNEdge id="SequenceFlow_4_di" bpmnElement="SequenceFlow_4">
                <di:waypoint x="420" y="90" />
                <di:waypoint x="450" y="125" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Task 2 to Join -->
                <bpmndi:BPMNEdge id="SequenceFlow_5_di" bpmnElement="SequenceFlow_5">
                <di:waypoint x="420" y="190" />
                <di:waypoint x="450" y="125" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Join to Compare Outputs -->
                <bpmndi:BPMNEdge id="SequenceFlow_6_di" bpmnElement="SequenceFlow_6">
                <di:waypoint x="500" y="125" />
                <di:waypoint x="550" y="140" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Compare Outputs to Final Output -->
                <bpmndi:BPMNEdge id="SequenceFlow_7_di" bpmnElement="SequenceFlow_7">
                <di:waypoint x="670" y="140" />
                <di:waypoint x="700" y="140" />
                </bpmndi:BPMNEdge>
        
                <!-- Sequence Flow: Final Output to End -->
                <bpmndi:BPMNEdge id="SequenceFlow_8_di" bpmnElement="SequenceFlow_8">
                <di:waypoint x="820" y="140" />
                <di:waypoint x="850" y="136" />
                </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
            </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        
        
                    4. **If the workflow involves one dataset and multiple models**: Create a linear flow for the dataset, followed by a parallel gateway that processes each model in parallel.
                    5. **If the workflow involves multiple models**: Use separate branches for each model's task, either sequentially or parallel, depending on user workflow.
                    6. **If the output of one model feeds into another model**: Ensure that the output of the first model is passed as input to the second model, no matter the number of datasets. This should be represented as a sequence flow from one model to the next.
                    
                    Use the exact names of datasets and models as we provided you in the description of our resources, and ensure that the XML follows the structure required for API execution and visual display.
                    
                    Your response should contain **only the XML code**. For reference, this is what our default code looks like with no selection:
                    <?xml version="1.0" encoding="UTF-8"?>
        <bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                            xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                            xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                            xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                            xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                            id="Definitions_3"
                            targetNamespace="http://bpmn.io/schema/bpmn">
            <bpmn:process id="Process_3" isExecutable="false">
            <!-- Start Event -->
            <bpmn:startEvent id="StartEvent_3" name="Start">
                <bpmn:outgoing>SequenceFlow_12</bpmn:outgoing>
            </bpmn:startEvent>
        
            <!-- End Event -->
            <bpmn:endEvent id="EndEvent_3" name="End">
                <bpmn:incoming>SequenceFlow_12</bpmn:incoming>
            </bpmn:endEvent>
        
            <!-- Sequence Flow -->
            <bpmn:sequenceFlow id="SequenceFlow_12" sourceRef="StartEvent_3" targetRef="EndEvent_3" />
            </bpmn:process>
        
            <!-- BPMN Diagram Information -->
            <bpmndi:BPMNDiagram id="BPMNDiagram_3">
            <bpmndi:BPMNPlane id="BPMNPlane_3" bpmnElement="Process_3">
                <!-- Start Event Shape -->
                <bpmndi:BPMNShape id="StartEvent_3_di" bpmnElement="StartEvent_3">
                <dc:Bounds x="100" y="100" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- End Event Shape -->
                <bpmndi:BPMNShape id="EndEvent_3_di" bpmnElement="EndEvent_3">
                <dc:Bounds x="300" y="100" width="36" height="36" />
                </bpmndi:BPMNShape>
        
                <!-- Sequence Flow Shape -->
                <bpmndi:BPMNEdge id="SequenceFlow_12_di" bpmnElement="SequenceFlow_12">
                <di:waypoint x="136" y="118" />
                <di:waypoint x="300" y="118" />
                </bpmndi:BPMNEdge>
            </bpmndi:BPMNPlane>
            </bpmndi:BPMNDiagram>
        </bpmn:definitions>

                7. **If the diagram is with filter:** You need to add a filter(fork) object that represents data being filtered according to the and then show the filtered data going into the selected model like (Cox or Kaplan meier). **ENSURE THAT THE FILTER IS APPLIED BEFORE THE DATA GOES INTO THE MODEL AND THE FILTER IS APPLIED ON EACH DATASET**.
                8. **If the diagram has more than one filter:** You need to add a filter(fork) object that represents data being filtered all filters should be one after the other.

Additional Instruction for Arrow Rendering (Important)
When generating the BPMN XML diagrams, ensure that every sequence flow (arrow) is explicitly defined with sufficient intermediate waypoints to keep lines clear and avoid overlap with tasks or gateways. Specifically:

Avoid Overlaps

Place tasks, gateways, and events at coordinates that keep space around each element.
Use intermediate waypoints to route connectors around elements if needed.
Maintain Symmetry for Parallel Paths

Where multiple parallel flows exist, position them at the same horizontal level or in a visually balanced manner so they do not overlap or clutter.
Clear Visual Distinction

Each arrow should have at least one or two intermediate waypoints if it needs to curve or bend around another shape.
Consistent Spacing

Ensure consistent horizontal or vertical spacing between shapes and arrow waypoints.
For example, increase x-coordinates by at least 100–150 for each subsequent step if the flow is horizontal; keep parallel flows separated by 50–100 units vertically.
Following these guidelines will help keep the resulting diagrams neat, aligned, and free from overlapping connectors.

        --
        Use this and the provided rules as a baseline to generate the bpmn code.`;

    const fullPrompt = `${customPromptBefore}${input}${customPromptAfter}`;
    // console.log("here2")
    const response = await getChatGPTResponse(fullPrompt);
    // console.log("ChatGPT Response:", response);

    // Save the whole response to JSON (append mode)
    saveWholeResponseToJson(response);

    // Save the BPMN XML in a separate file (incremental numbering)
    saveBPMNtoXML(response.content);

    // Extract and save the model and dataset names
    extractAndSaveModelDatasetNames(response.content);
  } else {
    console.log("Failed to read one or more JSON files.");
  }
  const endTime = Date.now(); // End time
  console.log("Prompt processing took " + (endTime - startTime) + " ms");
}

module.exports = { promptUserForInput, getChatGPTResponse };