const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const authRouter = require("./routers/auth");
const fileRouter = require("./routers/fileupload");
const validationRouter = require("./validation_routes");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const { Web3 } = require("web3");
const Individual = require("./models/individual");
const SmartContract = require("./models/SmartContract");
const { spawn } = require("child_process");
require("dotenv").config();

// Imports for the signature creation :
const ethUtil = require("ethereumjs-util");
const secp256k1 = require("secp256k1");
const ethers = require("ethers");

// Imports for the LLM Creation :
const { promptUserForInput } = require("./llm");
const { generateWithRAG } = require("./llm_rag");

const app = express();
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(bodyParser.json()); // Add body-parser middleware

// Need to later remove it to persistent datastorage format.
const accessMap = new Map();

const jwtSecretKey = "secret_key";
const PRIVATEKEY = process.env.PRIVATE_KEY;
const NODE_URL = `wss://sepolia.infura.io/ws/v3/${process.env.INFURA_KEY}`;
const myWeb3 = new Web3(new Web3.providers.WebsocketProvider(NODE_URL));

async function signMessage(message) {
  const originalMessageHash = ethUtil.keccak256(Buffer.from(message));
  const wallet = new ethers.Wallet(PRIVATEKEY);
  const signature = await wallet.signMessage(originalMessageHash);
  console.log("Signature created is : ", signature);
  return signature;
}

// Middleware to authenticate JWT and extract claims
function authenticateJWT(req, res, next) {
  const token = req.header("Authorization");
  if (!token) {
    return res.status(403).send("Access denied. No token provided.");
  }

  try {
    const decoded = jwt.verify(token, jwtSecretKey);
    req.user = decoded;
    next();
  } catch (ex) {
    res.status(400).send("Invalid token.");
  }
}

// Function to verify the signatures passed by the users => will return true/false
async function verifySignature(message, givenSignature) {
  const originalMessageHash = ethUtil.keccak256(Buffer.from(message));
  const wallet = new ethers.Wallet(PRIVATEKEY);
  const signature = await wallet.signMessage(originalMessageHash);
  // Comparin the Signatures here :
  if (givenSignature === signature) {
    console.log("Signature verified correctly !");
    return true;
  } else {
    console.log("Signature verified incorrectly !");
    console.log(signature, "   ", givenSignature);
    return false;
  }
}

// ******   Functions to listen to the target smart contract for the access rights & accordinly provide access/deny

const createLogsFilter = (address) => ({
  address, // Contract address
  topics: [encodeEvent("SignUpResult(string)")],
});

// Function to encode the event topic
function encodeEvent(event) {
  return Web3.utils.sha3(event);
}

const subscribeToLogs = async (logsFilter) => {
  try {
    const subscription = await myWeb3.eth.subscribe("logs", logsFilter);

    subscription.on("data", handleLogs);
    subscription.on("error", handleError);

    // Clean up subscription on component unmount
    return () => {
      subscription.unsubscribe((error, success) => {
        if (success) console.log("Successfully unsubscribed!");
        else console.error("Error unsubscribing:", error);
      });
    };
  } catch (error) {
    console.error(`Error subscribing to new logs: ${error}`);
  }
};

const startEventListeners = async () => {
  try {
    const smartContracts = await SmartContract.find();
    if (!smartContracts.length) {
      console.log("No smart contracts found in the database.");
      return;
    }

    smartContracts.forEach((contract) => {
      const logsFilter = createLogsFilter(contract.address);
      subscribeToLogs(logsFilter);
      console.log(`Listening to events for contract: ${contract.address}`);
    });
  } catch (error) {
    console.error("Error fetching smart contracts from DB:", error);
  }
};

// Fall(or basically callback)back function to react to the different events :
const handleLogs = (log) => {
  console.log("Received log:", log);
  console.log(myWeb3.eth.abi.decodeParameter("string", log.data));
  let logString = myWeb3.eth.abi.decodeParameter("string", log.data);
  // Split the logString using '--' as delimiter
  const segments = logString.split("--");

  if (segments.length !== 3) {
    console.error("Invalid log format:", logString);
    return; // Handle error or return early if format is incorrect
  }

  // Extract decision, Address, and Dataset ID from segments :
  let decision = segments[0].trim(); // this hould be 'true' or 'false'
  const addressSegment = segments[1].trim(); // this should be 'Address:0x6457344cd4f59a867f0a31cc0c24e631c1049911'
  const datasetSegment = segments[2].trim(); // this Should be 'Dataset ID:cancerUSA.pdf'

  // Extract Address and Dataset ID values :
  decision = decision.split(":")[1].trim();
  const address = addressSegment.split(":")[1].trim(); // Extracts '0x6457344cd4f59a867f0a31cc0c24e631c1049911'
  const datasetID = datasetSegment.split(":")[1].trim(); // Extracts 'cancerUSA.pdf'

  console.log("Decision:", decision);
  console.log("Address:", address);
  console.log("Dataset ID:", datasetID);
  key = `${address}:${datasetID.toLowerCase()}`;
  const blockNumber = log.blockNumber;
  accessMap.set(key, blockNumber);

  // let decodedData = myWeb3.eth.abi.decodeParameter('string', log.data);
  // // handling the access accordinly in Memory(RAM for now) :
  // const [decision, publicKey, datasetID] = decodedData.split(':');

  // // Only add to the map if the decision is true
  // if (decision === 'true') {
  //   // const key = `${publicKey}:${datasetID}`;
  //   let key = publicKey.trim().toLowerCase();
  //   let fileName = datasetID.trim().toLowerCase();
  //   // const key = publicKey;
  //   console.log("The key is : ", key)
  //   const blockNumber = log.blockNumber;
  //   key = `${key}:${fileName}`;
  //   // Store the block number in the map
  //   accessMap.set(key, blockNumber);
  // }
};

const handleError = (error) => {
  console.error(`Error with log subscription: ${error}`);
};

mongoose
  .connect(
    process.env.MONGODB_URI,
  )
  .then(() => {
    console.log("\x1b[34m%s\x1b[0m", "DB connected");
    app.listen(3002, () =>
      console.log("\x1b[33m%s\x1b[0m", "Listening at port 3002"),
    );
  })
  .catch((err) => {
    console.error("\x1b[31m%s\x1b[0m", err);
  });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    return cb(null, "./uploads");
  },
  filename: function (req, file, cb) {
    return cb(null, `${Date.now()}_${file.originalname}`);
  },
});

startEventListeners();

const upload = multer({ storage });

// app.post('/upload', upload.single('file'), (req, res) => {
//   console.log("req.body", req.body);
//   console.log("req.file", req.file);
// });

app.post(
  "/upload",
  upload.fields([
    { name: "file" },
    { name: "xacmlFile" },
    { name: "jsonTermsFile" },
  ]),
  (req, res) => {
    console.log("req.body", req.body);
    console.log("req.files", req.files);

    if (!req.files.file || !req.files.xacmlFile || !req.files.jsonTermsFile) {
      return res.status(400).json({
        error:
          "All files (data, XACML, and JSON of terms) must be selected to upload.",
      });
    }

    res.status(200).json({ message: "Files uploaded successfully!" });
  },
);

app.get("/files", (req, res) => {
  fs.readdir("./uploads", (err, files) => {
    if (err) {
      console.error("Error reading directory:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ files });
  });
});

app.get("/files/:fileName", async (req, res) => {
  let fileName = req.params.fileName;
  let authToken = req.headers["authorization"];
  const publicKey = req.headers["publickey"];
  const docId = req.headers["docid"];

  authToken = authToken && authToken.split(" ")[1];
  console.log("Doctor ID is : ", docId);

  // find the doc from the database :
  const individual = await Individual.findOne({ username: docId });
  console.log(individual);
  if (!individual) {
    return res.status(404).send({ message: "Individual not found" });
  }

  // verify token:
  let stringifiedMsg =
    individual.doctorId +
    "," +
    individual.hospitalId +
    "," +
    individual.specialization +
    "," +
    individual.location;
  console.log("String message is : ", stringifiedMsg);
  let boolVerifySignature = await verifySignature(stringifiedMsg, authToken);
  if (boolVerifySignature === false) {
    console.log("Token verification : Failed!!");
    return res.status(404).send({ message: "Token verification failed !" });
  }

  let myKey = publicKey.trim().toLowerCase();
  fileName = fileName.trim().toLowerCase();
  myKey = `${myKey}:${fileName}`;

  if (accessMap.has(myKey)) {
    const value = accessMap.get(myKey);
    console.log(`Found key: ${myKey}, value: ${value}`);

    // Delete the entry
    accessMap.delete(myKey);
    console.log(`Deleted key: ${myKey}`);
  } else {
    console.log(`Key not found: ${myKey}`);
    console.log("All keys in accessMap:");
    for (let k of accessMap.keys()) {
      console.log(k);
    }
    return res.status(404).send({ message: "Permisssion not given !" });
  }
  // Once verifyed, check if any relevant event for that block has been emmitted or not ?

  // If event released, then grant the access for download
  // const fileName = req.params.fileName;
  fileName = req.headers["datasetid"];
  const filePath = path.join(__dirname, "uploads", fileName);
  console.log("filePath", filePath);
  res.download(filePath, fileName, (err) => {
    if (err) {
      console.error("Error downloading file:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

/* Following Function is to provide the client with the policy for the smart contract */

app.get("/getPolicy/:fileName", async (req, res) => {
  // 1) Extract artifacts json file
  // 2) Extract the smart contract's address
  // 3) Returns address, requirement Functions, permission function , abi
  /* Server will store a mapping between FileName Against The Smart Contract Adress */
  /* Search the mongoDB to get the smart contract and return it's address */
  try {
    const fileName = req.params.fileName;
    // Remap file names that differ from DB contract names
    const FILE_TO_DB_MAP = {
      diabetic_data: "UCI_diabetic_dataset",
    };
    const resolvedName = FILE_TO_DB_MAP[fileName] || fileName;
    // First Verify see if the value is in DB :
    const smartContract = await SmartContract.findOne({ name: resolvedName });
    if (!smartContract) {
      return res
        .status(404)
        .send({ message: "SmartContract with this policy not found" });
    }
    const solFileName = `smart-contract-${resolvedName.replace(/@/g, "_")}`;
    const contractName = solFileName.replace("smart-contract-", "");
    const contractPath = path.join(
      __dirname,
      `../blockchain/artifacts/contracts/${solFileName}.sol/${contractName}.json`,
    );

    /* Fetching The Json Term Policy : */
    const jsonTermsPath = path.join(__dirname, `/uploads/${resolvedName}.json`);
    const fileTerms = require(jsonTermsPath);

    console.log("filepath is : ", contractPath);
    const myContract = require(contractPath);
    console.log("hello", myContract.abi);
    // Get the contract instance
    const contract = new myWeb3.eth.Contract(
      myContract.abi,
      smartContract.address,
    );

    // Example: Call a pure function 'getPolicy' from the smart contract
    const result = await contract.methods.getPolicy().call();

    console.log(
      "requirements for the contract : ",
      fileName,
      " is  : ",
      result,
    );
    console.log("BACKEND_STEP1 : filenName requested = ", fileName);

    // const policy = await Policy.findOne({ fileName });
    // if (!policy) {
    //   return res.status(404).send('Policy not found');
    // }
    res.json({
      newContractAddress: smartContract.address,
      abi: myContract.abi,
      argv: result,
      permissionFunction: "evaluate",
      terms: fileTerms,
    });
  } catch (error) {
    console.log("Error !", error);
    res.status(500).send("Error fetching policy");
  }
});

/* Following Function is responsible to provide you with the arguments required for the username and signed them*/

app.get("/getSignedDetails/:username", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];
    const argvString = req.headers["argv"];
    const termArrString = req.headers["terms"];
    const termArr = termArrString.split(",");
    console.log("Argv ", argvString);
    console.log("terms are : ", termArr);
    const args = argvString ? argvString.split(",") : [];
    if (args.length == 0 || !token) {
      throw new Error("Arguments or Token not provided!");
    }
    const username = req.params.username;
    console.log("username", username);
    const individual = await Individual.findOne({ username: username });
    if (!individual) {
      return res.status(404).send({ message: "Individual not found" });
    }
    // Extract the details dynamically based on args array
    const details = {};
    let signedString = "";
    args.forEach((arg, index) => {
      if (individual[arg] !== undefined) {
        console.log("args allowed : ", arg);
        signedString += individual[arg];
        if (index < args.length - 1) {
          signedString += ",";
        }
        details[arg] = individual[arg];
      } else {
        let errMsg = "Argument " + arg + " doesnt exist in schema !";
        console.log(errMsg);
        throw new Error(errMsg);
      }
    });
    console.log("yessss , ", termArr.length);
    for (let i = 0; i < termArr.length; i++) {
      let term = termArr[i];
      console.log("Term is added: ", term);
      signedString += ",";
      signedString += term;
    }

    console.log("String is : ", signedString);
    let signature = await signMessage(signedString);
    console.log(signature);
    res.json({
      individualDetails: details,
      signature: signature,
    });
  } catch (error) {
    console.log("error in the signing the array !\n");
    res.status(404).send({ message: "Server error", error: error.message });
  }
});

app.get("/api/individuals/:username", async (req, res) => {
  try {
    // Extracting the Token :
    const authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];
    console.log("the token value is : ", token);

    if (!token) return res.status(401).json({ message: "Token not found" });
    console.log("the token value is : ", token);

    const username = req.params.username;
    console.log("username", username);
    const individual = await Individual.findOne({ username: username });
    console.log(individual);
    if (!individual) {
      return res.status(404).send({ message: "Individual not found" });
    }

    // Verifying the Token :
    let stringifiedMsg =
      individual.doctorId +
      "," +
      individual.hospitalId +
      "," +
      individual.specialization +
      "," +
      individual.location;
    console.log("String message is : ", stringifiedMsg);
    let boolVerifySignature = await verifySignature(stringifiedMsg, token);
    if (boolVerifySignature === true) {
      console.log("Token verification : Sucess!!");
      res.json(individual);
    } else {
      console.log("Token verification : Failed!!");
      return res.status(404).send({ message: "Token verification failed !" });
    }
    // res.json(individual);
  } catch (error) {
    res.status(500).send({ message: "Server error", error: error.message });
  }
});

app.get("/getAllDatasets", async (req, res) => {
  const directoryPath = "./uploads";

  try {
    const files = await fs.promises.readdir(directoryPath);

    const filteredFiles = files.filter(
      (file) =>
        !file.startsWith("run_") &&
        !file.startsWith("check_") &&
        !file.startsWith("converter") &&
        !file.startsWith("run_lstm") &&
        (file.includes("Cancer") ||
          file.includes("cancer") ||
          file.includes("Model") ||
          file.includes("model") ||
          file.includes("Dataset") ||
          file.includes("dataset") ||
          file.includes("Diabetes") ||
          file.includes("diabetes") ||
          file.includes("diabetic") ||
          file.includes("failure") ||
          file.includes("survival") ||
          file.includes("forest")) &&
        (file.includes(".xlsx") ||
          file.includes(".pdf") ||
          file.includes(".py") ||
          file.includes(".ipynb") ||
          file.includes(".csv")),
    );
    console.log("filteredFiles are : ", filteredFiles);

    res.json(filteredFiles);
  } catch (error) {
    console.error("Error reading directory:", error);
    res.status(500).json({ error: "Failed to fetch datasets or models." });
  }
});

// JWT-protected endpoint to evaluate access
app.post("/evaluate", authenticateJWT, async (req, res) => {
  const { datasetID } = req.body;
  const { doctorID, hospitalID, specialization, accessRights, location } =
    req.user;

  try {
    const accounts = await web3.eth.getAccounts();
    const result = await contract.methods
      .evaluate(
        datasetID,
        doctorID,
        hospitalID,
        specialization,
        accessRights,
        location,
      )
      .send({ from: accounts[1] });

    res.send(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// the following endpoint will be used to communicate with the GPT model when user sends request :
app.post("/generateLLMResponse", async (req, res) => {
  // app.post('/generateLLMResponse', authenticateJWT, async (req, res) => {

  const { requestedMsg } = req.body;

  if (!requestedMsg) {
    return res.status(400).json({ error: "Message input is required" });
  }

  try {
    // Call the refactored promptUserForInput function with the input message
    await promptUserForInput(requestedMsg);
    return res.status(200).json({
      message: "Response generated and saved to XML",
      data: "Success",
    });
    // console.log("response is : ", response)
    // if (response) {

    // } else {
    //     return res.status(500).json({ error: 'Failed to generate response' });
    // }
  } catch (err) {
    console.error("Error generating response:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// RAG-based LLM endpoint
app.post("/api/llm/rag", async (req, res) => {
  const { userInput, selectedDatasets, selectedModels } = req.body;

  console.log("📝 RAG Request received:");
  console.log("- User Input:", userInput);
  console.log("- Datasets:", selectedDatasets);
  console.log("- Models:", selectedModels);

  try {
    const result = await generateWithRAG(
      userInput,
      selectedDatasets || [],
      selectedModels || [],
    );

    console.log("✅ RAG generation completed");
    res.json(result);
  } catch (error) {
    console.error("❌ RAG generation failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoint to get recommended files
app.get("/getLLM_Recommended_files", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "models_datasets_names_1.json"); // Adjust if needed
    const fileData = fs.readFileSync(filePath, "utf8");
    const parsedData = JSON.parse(fileData);
    console.log("Parsed Data is ", parsedData);
    res.json(parsedData); // Send the parsed JSON as a response
  } catch (error) {
    console.error("Error reading file:", error);
    res.status(500).json({ error: "Error reading file" });
  }
});

// Add these imports at the top
const csv = require("csv-parser");
const xlsx = require("xlsx");

// Replace your data reading functions with the following
const readCsv = async (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = fs
      .createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => {
        results.push(data);
        if (results.length === 5) {
          stream.destroy(); // Stop reading after 5 rows
        }
      })
      .on("end", () => {
        resolve(results);
      })
      .on("close", () => {
        resolve(results);
      })
      .on("error", (error) => {
        reject(error);
      });
  });
};

const readExcel = async (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Assuming data is in the first sheet
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    const firstFiveRows = jsonData.slice(0, 5); // Get first 5 rows
    return firstFiveRows;
  } catch (error) {
    throw error;
  }
};

app.post("/process-data", async (req, res) => {
  const { models, datasets, variables, filters, groupBy } = req.body;
  console.log(
    "models:",
    models,
    "datasets:",
    datasets,
    "variables:",
    variables,
    "filters:",
    filters,
  );
  try {
    const outputs = [];

    for (const modelName of models) {
      const modelPath = path.join(__dirname, "uploads", modelName);

      // Check if model exists
      if (!fs.existsSync(modelPath)) {
        outputs.push({
          model: modelName,
          dataset: null,
          output: `Error: Model ${modelName} not found.`,
        });
        continue;
      }

      const isCoxModel = modelName.toLowerCase().includes("cox");
      const isKaplanModel = modelName.toLowerCase().includes("kaplan");
      const isXGBoostModel = modelName.toLowerCase().includes("xgboost");
      const isRSFModel = modelName
        .toLowerCase()
        .includes("random_survival_forest");
      const isMLPModel = modelName.toLowerCase().includes("mlp");
      const isLSTMModel = modelName.toLowerCase().includes("lstm");

      if (isKaplanModel) {
        const datasetPaths = [];
        for (const datasetName of datasets) {
          const datasetPath = path.join(__dirname, "uploads", datasetName);
          console.log("Model Path:", modelPath);
          console.log("Dataset Path:", datasetPath);
          datasetPaths.push(datasetPath);
        }

        // Generate unique filename for output image
        const outputFilename = `kaplan_meier_${Date.now()}.png`;
        const outputPath = path.join(__dirname, "uploads", outputFilename);

        // Run the updated Kaplan–Meier model with filters
        await new Promise((resolve, reject) => {
          const pythonProcess = spawn("python", [
            modelPath,
            "--filters",
            filters || "",
            "--group-by",
            groupBy || "race",
            ...datasetPaths,
            outputPath,
          ]);

          let outputData = "";
          let errorData = "";

          pythonProcess.stdout.on("data", (data) => {
            outputData += data.toString();
          });

          pythonProcess.stderr.on("data", (data) => {
            errorData += data.toString();
            console.log(`[${modelName}]`, data.toString().trim());
          });

          pythonProcess.on("close", (code) => {
            if (code === 0) {
              console.log("Kaplan–Meier plot generated successfully.");
              // Cleanup old Kaplan–Meier images (except for the new one)
              const uploadsDir = path.join(__dirname, "uploads");
              try {
                const files = fs.readdirSync(uploadsDir);
                for (const file of files) {
                  if (
                    file.startsWith("kaplan_meier_") &&
                    file.endsWith(".png") &&
                    file !== outputFilename
                  ) {
                    fs.unlinkSync(path.join(uploadsDir, file));
                    console.log(`Deleted old Kaplan–Meier image: ${file}`);
                  }
                }
              } catch (err) {
                console.error(
                  "Error cleaning up old Kaplan–Meier images:",
                  err,
                );
              }
              outputs.push({
                model: modelName,
                datasets: datasets,
                output: outputData || null,
                // imageUrl: `http://localhost:3001/uploads/${outputFilename}`,
                imageUrl: `https://84.235.241.150:3001/uploads/${outputFilename}`,
              });
              resolve();
            } else {
              reject(`Process exited with code: ${code}\n${errorData}`);
            }
          });
        });
      } else if (
        isCoxModel ||
        isXGBoostModel ||
        isRSFModel ||
        isMLPModel ||
        isLSTMModel
      ) {
        // For Cox model, ensure variables are provided
        if (!variables || variables.length === 0) {
          outputs.push({
            model: modelName,
            dataset: null,
            output: `Error: No variables selected for ${modelName}.`,
          });
          continue;
        }
        // Guard: reject LSTM on incompatible datasets (e.g., Sylhet)
        if (isLSTMModel) {
          const incompatible = datasets.filter(
            (d) =>
              (!d.toLowerCase().includes("diabetic") &&
                !d.toLowerCase().includes("diabetes") &&
                !d.toLowerCase().includes("readmission")) ||
              d.toLowerCase().includes("sylhet") ||
              d.toLowerCase().includes("bangladesh"),
          );
          if (incompatible.length > 0) {
            outputs.push({
              model: modelName,
              datasets: datasets,
              output: JSON.stringify({
                error: `LSTM is only compatible with UCI Diabetes dataset. Incompatible: ${incompatible.join(", ")}`,
                model: "LSTM Readmission",
              }),
            });
            continue;
          }
        }

        const variablesString = variables.join(",");
        const datasetPaths = datasets.map((datasetName) =>
          path.join(__dirname, "uploads", datasetName),
        );

        // Check if datasets exist
        const missingDatasets = datasetPaths.filter((p) => !fs.existsSync(p));
        if (missingDatasets.length > 0) {
          outputs.push({
            model: modelName,
            dataset: null,
            output: `Error: Datasets not found: ${missingDatasets.join(", ")}`,
          });
          continue;
        }

        // Generate unique filename for survival curve image (Cox/XGBoost/RSF/MLP/LSTM)
        let outputImagePath = null;
        let outputFilename = null;
        if (
          isCoxModel ||
          isXGBoostModel ||
          isRSFModel ||
          isMLPModel ||
          isLSTMModel
        ) {
          outputFilename = `${modelName.replace(".py", "")}_${Date.now()}.png`;
          outputImagePath = path.join(__dirname, "uploads", outputFilename);
        }

        // Build arguments: use --vars and --filters flags
        const pythonArgs = [
          modelPath,
          "--vars",
          variablesString,
          "--filters",
          filters || "",
          "--group-by",
          groupBy || "meno",
        ];

        // Add --output-image for models that support it
        if (outputImagePath) {
          pythonArgs.push("--output-image", outputImagePath);
        }

        pythonArgs.push(...datasetPaths);

        const pythonProcess = spawn("python", pythonArgs);
        let outputData = "";
        let errorData = "";

        await new Promise((resolve) => {
          pythonProcess.stdout.on("data", (data) => {
            outputData += data.toString();
          });
          pythonProcess.stderr.on("data", (data) => {
            errorData += data.toString();
            console.log(`[${modelName}]`, data.toString().trim());
          });
          pythonProcess.on("close", (code) => {
            if (code === 0) {
              console.log(`${modelName} processed successfully.`);
              if (errorData) {
                console.log("Python script error output:", errorData);
              }

              // Check if image was generated and cleanup old images
              let imageUrl = null;
              if (outputImagePath && fs.existsSync(outputImagePath)) {
                // imageUrl = `http://localhost:3001/uploads/${outputFilename}`;
                imageUrl = `https://84.235.241.150:3001/uploads/${outputFilename}`;

                // Cleanup old images
                const uploadsDir = path.join(__dirname, "uploads");
                try {
                  const files = fs.readdirSync(uploadsDir);
                  const prefix = modelName.replace(".py", "");
                  const currentTimestamp = parseInt(
                    outputFilename
                      .replace(prefix + "_", "")
                      .replace(".png", ""),
                  );
                  for (const file of files) {
                    if (
                      file.startsWith(prefix) &&
                      file.endsWith(".png") &&
                      file !== outputFilename
                    ) {
                      const fileTimestamp = parseInt(
                        file.replace(prefix + "_", "").replace(".png", ""),
                      );
                      // Only delete images older than 30 seconds to avoid race conditions
                      if (currentTimestamp - fileTimestamp > 30000) {
                        fs.unlinkSync(path.join(uploadsDir, file));
                        console.log(`Deleted old ${modelName} image: ${file}`);
                      }
                    }
                  }
                } catch (err) {
                  console.error(
                    `Error cleaning up old ${modelName} images:`,
                    err,
                  );
                }
              }

              // Check for cross-race probability plots (multiple images)
              let crossRaceImages = [];
              if (outputFilename) {
                const timestamp = outputFilename
                  .replace(modelName.replace(".py", "") + "_", "")
                  .replace(".png", "");
                const plotPrefix = `${modelName.replace(".py", "")}_${timestamp}_`;
                const uploadsDir2 = path.join(__dirname, "uploads");
                try {
                  const allFiles = fs.readdirSync(uploadsDir2);
                  crossRaceImages = allFiles
                    .filter(
                      (f) => f.startsWith(plotPrefix) && f.endsWith(".png"),
                    )
                    .map((f) => `https://84.235.241.150:3001/uploads/${f}`);
                  // .map((f) => `http://localhost:3001/uploads/${f}`);
                } catch (e) {}
              }

              outputs.push({
                model: modelName,
                datasets: datasets,
                output: outputData.trim(),
                imageUrl: imageUrl,
                crossRaceImages:
                  crossRaceImages.length > 0 ? crossRaceImages : undefined,
              });
            } else {
              console.error("Python script error output:", errorData);
              outputs.push({
                model: modelName,
                datasets: datasets,
                output: `Error processing datasets ${datasets.join(", ")}:\n${errorData}`,
              });
            }
            resolve();
          });
        });
      } else {
        // For any other models (e.g., logistic regression), use the original logic
        for (const datasetName of datasets) {
          const datasetPath = path.join(__dirname, "uploads", datasetName);
          console.log("Model Path:", modelPath);
          console.log("Dataset Path:", datasetPath);

          if (!fs.existsSync(datasetPath)) {
            outputs.push({
              model: modelName,
              dataset: datasetName,
              output: `Error: Dataset ${datasetName} not found.`,
            });
            continue;
          }

          let pythonArgs;
          if (isCoxModel) {
            if (!variables || variables.length === 0) {
              outputs.push({
                model: modelName,
                dataset: datasetName,
                output: `Error: No variables selected for Cox model.`,
              });
              continue;
            }
            const variablesString = variables.join(",");
            pythonArgs = [
              modelPath,
              "--vars",
              variablesString,
              "--filters",
              filters || "",
              datasetPath,
            ];
          } else {
            pythonArgs = [modelPath, datasetPath];
          }

          const pythonProcess = spawn("python", pythonArgs);
          let outputData = "";
          let errorData = "";

          await new Promise((resolve) => {
            pythonProcess.stdout.on("data", (data) => {
              outputData += data.toString();
            });
            pythonProcess.stderr.on("data", (data) => {
              errorData += data.toString();
              console.log(`[${modelName}]`, data.toString().trim());
            });
            pythonProcess.on("close", (code) => {
              if (code === 0) {
                outputs.push({
                  model: modelName,
                  dataset: datasetName,
                  output: outputData.trim(),
                });
              } else {
                outputs.push({
                  model: modelName,
                  dataset: datasetName,
                  output: `Error processing ${datasetName}:\n${errorData}`,
                });
              }
              resolve();
            });
          });
        }
      }
    }

    // If only one dataset, read and return a data sample (first 5 rows)
    let dataSample = null;
    if (datasets.length === 1) {
      const datasetPath = path.join(__dirname, "uploads", datasets[0]);
      let df;
      if (datasets[0].endsWith(".csv")) {
        df = await readCsv(datasetPath);
      } else if (
        datasets[0].endsWith(".xlsx") ||
        datasets[0].endsWith(".xls")
      ) {
        df = await readExcel(datasetPath);
      } else {
        df = null;
      }
      if (df) {
        dataSample = df.slice(0, 5); // Return first 5 rows as sample
      }
    }

    res.json({ outputs, dataSample });
  } catch (error) {
    console.error("Error processing data:", error);
    res
      .status(500)
      .json({ error: "Internal server error.", details: error.message });
  }
});

function getValidColumns(data) {
  if (data.length === 0) {
    return [];
  }

  const columns = Object.keys(data[0]);
  const validColumns = [];

  columns.forEach((col) => {
    const values = data.map((row) => row[col]);
    const nonNullValues = values.filter(
      (val) => val !== null && val !== undefined && val !== "",
    );

    // Exclude columns with all null/empty values
    if (nonNullValues.length === 0) {
      return;
    }

    // Check for zero variance (all values are the same)
    const uniqueValues = [...new Set(nonNullValues)];
    if (uniqueValues.length <= 1) {
      return;
    }

    validColumns.push(col.toLowerCase().trim());
  });

  return validColumns;
}

// Updated Endpoint to get dataset columns
app.post("/get-dataset-columns", async (req, res) => {
  const { datasets } = req.body;

  try {
    const datasetsColumns = {};

    for (const datasetName of datasets) {
      const datasetPath = path.join(__dirname, "uploads", datasetName);
      let data = [];

      if (datasetName.endsWith(".csv")) {
        data = await readCsv(datasetPath);
      } else if (
        datasetName.endsWith(".xlsx") ||
        datasetName.endsWith(".xls")
      ) {
        data = await readExcel(datasetPath);
      } else {
        // Unsupported file type
        continue;
      }

      const validColumns = getValidColumns(data);
      datasetsColumns[datasetName] = validColumns;
    }

    res.json({ datasetsColumns });
  } catch (error) {
    console.error("Error reading datasets:", error);
    res
      .status(500)
      .json({ error: "Internal server error.", details: error.message });
  }
});

app.use("/auth", authRouter);
app.use("/api/validation", validationRouter);
