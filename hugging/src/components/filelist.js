import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Web3 from 'web3';
import '../styles/filelist.css';
import NavBar from './navbar';

// ****** New Imports for the Smart Contract Interaction ******
import myContract from '../artifacts/contracts/SC_20_21_13_28.sol/SC_20_21_13_28.json';
const ethers = require("ethers");

// Web 3 WSS end-point :
const NODE_URL =
  "REDACTED";
const web3 = new Web3(NODE_URL);

function encodeEvent(event) {
  const keccakHash = web3.utils.keccak256(event);
  console.log("your event hash is : ", keccakHash)
  return keccakHash;
}

// const myContractAddress = '0xAc966Fa4FB2B6d756FCF32667218F0CB0F0A5711';

const myContractAddress = 'REDACTED';

function FileList() {
  const [inputValue, setInputValue] = useState("");
  const [inputValue1, setInputValue1] = useState("");
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [myCreds,setmyCreds] = useState('');
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState('');
  const [result, setResult] = useState("");


  const [notification, setNotification] = useState("");  // State to hold notifications
  const [notification1, setNotification1] = useState("");
  const [notification2, setNotification2] = useState("");
  const [notification3, setNotification3] = useState("");
  const [notification4, setNotification4] = useState("");

  // These state variables are used to unveil the backend & smart Contract processing

  const [notification5, setNotification5] = useState("Your Token is " + localStorage.getItem("authToken"));
  const [notification6, setNotification6] = useState("");
  const [notification7, setNotification7] = useState("");
  // const [notification8, setNotification8] = useState("");  



  const handleInputChange = (event) => {
    setInputValue(event.target.value);
  };

  const handleInputChange1 = (event) => {
    setInputValue1(event.target.value);
  };
  // ABI and Address of your Smart Contract
  const ABI = [{
    "inputs": [
        {
            "internalType": "string",
            "name": "ID",
            "type": "string"
        },
        {
            "internalType": "string",
            "name": "doctorID",
            "type": "string"
        },
        {
            "internalType": "string",
            "name": "hospitalID",
            "type": "string"
        },
        {
            "internalType": "string",
            "name": "specialization",
            "type": "string"
        },
        {
            "internalType": "string",
            "name": "accessRights",
            "type": "string"
        },
        {
            "internalType": "string",
            "name": "Location",
            "type": "string"
        }
    ],
    "name": "evaluate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
},
{
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
},
{
    "inputs": [],
    "name": "calls",
    "outputs": [
        {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
        }
    ],
    "stateMutability": "view",
    "type": "function"
},
{
    "inputs": [
        {
            "internalType": "string",
            "name": "ID",
            "type": "string"
        }
    ],
    "name": "getEvaluationResult",
    "outputs": [
        {
            "internalType": "string",
            "name": "",
            "type": "string"
        }
    ],
    "stateMutability": "view",
    "type": "function"
}]; // Your contract's ABI
  const address = "0xdbAbcc32657D3BDeb8464FdF74033500BA80fA18"; // Your contract's address

  useEffect(() => {
    async function fetchFiles() {
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/files`);
        setFiles(response.data.files);
        setNotification("Files fetched successfully.");
      } catch (error) {
        setError('Error fetching files');
      }
    }

    

    fetchFiles();
    initializeWeb3();
     document.body.classList.add('file-list-page');
     return () => {
       document.body.classList.remove('file-list-page');
     };
  }, []);

  const initializeWeb3 = () => {
    if (window.ethereum) {
      window.web3 = new Web3(window.ethereum);
      const contractInstance = new window.web3.eth.Contract(ABI, address);
      setContract(contractInstance);
      setNotification("MetaMask is connected.");
    } else {
      setError('MetaMask is not installed!');
    }
  };

  const connectMetamask = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      setNotification("MetaMask account connected.");
    } catch (error) {
      setError('MetaMask connection error!');
    }
  };

  
  function getAuthToken () 
  {
    return localStorage.getItem('authToken');
  } 


  // The following function will ask the backend for the details required w.r.t to the file needed :
  const getPolicyDetails = async ( fileName ) =>{

    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/getPolicy/${fileName}`);
      if (response.status !== 200) {
        throw new Error('Policy not found');
      }
      const { newContractAddress , abi  , argv , permissionFunction } = response.data;
      console.log("heres the response ")
      console.log(response.data)
      
      return response.data;
    } catch (error) {
      console.error("Error fetching policy:", error);
      throw error;
    }
  };

  // The following function expects series of requirements in string format e.g. name,id...etc 
  // please expect the signature over the details in the end of the whole result
  const getSignedDetails = async (argv) =>{
    try {
      let authToken = getAuthToken();
      const signedCredentials = await axios.get(`${process.env.REACT_APP_API_URL}/getSignedDetails/${inputValue}`, {
          headers: {
              'Authorization': `Bearer ${authToken}`,
              'Argv' : argv
          }
      });
      // Extract individual details into an array
    const individualDetails = signedCredentials.data.individualDetails;
    const detailsArray = Object.values(individualDetails);

    // let newArray = [];
    // Object.values(detailsArray).forEach(item => {
    // newArray.push(item);});

    console.log('Signed details array:', detailsArray);
    console.log('Signature:', signedCredentials.data.signature);
    detailsArray.push(signedCredentials.data.signature);
    return detailsArray
    }
    catch (error)
    {
      console.error("Error in retrieving signed details : ", error)
    }
  }

  const callSmartContractWOtxn = async ( contractAddress , contractABI , functionName , args) => {
    /// Need to complete 

  };

  const callSmartContractWithtxn = async (contractAddress, contractABI, functionName, args) => {
    try {
        console.log(contractABI, contractAddress)
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        // Create a new instance of web3 with the provider
        const web3 = new Web3(window.ethereum);
        const contract = new web3.eth.Contract(contractABI , contractAddress);
        const accounts = await web3.eth.getAccounts();
        const fromAccount = accounts[0];
        console.log(fromAccount)
        console.log("function name is : ", functionName , "args are : ", args);
        const method = contract.methods[functionName](...args);
        const gas = await method.estimateGas({ from: fromAccount });
        // Send the transaction
        const result = await method.send({ from: fromAccount, gas });
        console.log(result)
        return result;
    } catch (error) {
        console.error("Error calling contract function:", error);
        throw error;
    }
};


  const checkPermissions = async (fileName) => {
    try {
      // passin the signature token to the server for the details :
      const authToken = localStorage.getItem('authToken');
      if (!authToken) {
          throw new Error('Authentication token not found. Please log in.');
        }
      const credentials = await axios.get(`${process.env.REACT_APP_API_URL}/api/individuals/${inputValue}`, {
          headers: {
              'Authorization': `Bearer ${authToken}`
          }
      });

      // const credentials = await axios.get(`${process.env.REACT_APP_API_URL}/api/individuals/${inputValue}`);
      setNotification("Credentials retrieved successfully.");
      console.log("credentials", credentials);
      setmyCreds(credentials);
      console.log("My creds are : ", myCreds);
      let {newContractAddress , abi  , argv , permissionFunction} = await getPolicyDetails(fileName);
      console.log("frontend argv is : ", argv)
      let myArr = await getSignedDetails(argv);
      myArr.unshift(fileName) 
      const { doctorId, hospitalId, specialization, accessRights, location } = credentials.data;

      setNotification6(`Retrieved Details:\nDoctor ID: ${doctorId}\n, Hospital ID: ${hospitalId}\n, Specialization: ${specialization}\n, Access Rights: ${accessRights}\n, Location: ${location}`);
      
      setNotification2("Invoking Smart Contract with your request");
      // Interaction with the Smart Contract :

      if (typeof myContract === 'undefined' || !myContract.abi) {
        throw new Error('VerifySignature contract ABI is not defined');
      }
      // const contractABI = myContract.abi;
      // await window.ethereum.request({ method: 'eth_requestAccounts' });
      // const provider = new ethers.BrowserProvider(window.ethereum);
      // const signer = await provider.getSigner();
      // const contract = new ethers.Contract(myContractAddress, contractABI, signer);
      console.log("Our token is : ", authToken)
      let mySignature = authToken;
      console.log(mySignature.length)

      // const tx = await contract.evaluate(fileName, doctorId, hospitalId, specialization, accessRights, location, mySignature);
      // const receipt = await tx.wait();
      // console.log("your transaction reciept is : ",receipt)
      // console.log("Decoding the data : ", receipt.logs);
      // console.log(web3.eth.abi.decodeParameter('string', receipt.logs[0].data));

      setNotification3("Waiting for your transaction to be published on Etherium");
      // const tx = await contract.evaluate(fileName, doctorId, hospitalId, specialization, accessRights, location, mySignature);
      // const receipt = await tx.wait();
      console.log("my Array is : ", myArr)
      const receipt = await callSmartContractWithtxn(newContractAddress , abi , permissionFunction , myArr);      
      console.log("your transaction reciept is : ",receipt)
      console.log("Decoding the data : ", receipt.logs);

      setNotification3(`Transaction ${receipt.hash} has been published successfully on Block ${receipt.blockNumber}`);
      // console.log(web3.eth.abi.decodeParameter('string', receipt.logs[0].data));
      let txnResult = web3.eth.abi.decodeParameter('string', receipt.logs[0].data);
      const [decision, publicKey, datasetID] = txnResult.split(':');
      if (decision == "true")
      {

        console.log("Yes confirmed !");
        setNotification7("Smart Contract's Access Policy's Result for you is Permit for " + datasetID);
      } 
      else 
      {
        setNotification7("Smart Contract's Access Policy's Result for you is Denied for " + datasetID);
      }      

      return true;
    } catch (error) {
      console.error('Error checking permissions:', error);
      return false;
    }
  };

  const handleDownload = async (docID , fileName) => {
    if (!contract) {
      setError('Smart contract not connected. Please check MetaMask.');
      return;
    }

    if (!inputValue)
    {
      setNotification("Please enter your doctor ID.");
    }    
 
    if (!docID) {
      setNotification("Please enter your doctor ID.");
      return;
    } 
    setInputValue1(fileName)
    let isAllowed = await checkPermissions(fileName);
    if (isAllowed) {
      try {
        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
            throw new Error('Authentication token not found. Please log in.');
        }

        // Getting public key address :
        // setNotification3("Transaction has been published successfully, now waiting for backend based on Smart contract's decision");
        
        
        console.log("doc ID : ", docID , inputValue)
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const publicKeyAddress = await signer.getAddress();
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/files/${fileName}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'PublicKey': publicKeyAddress,
            'docID': inputValue,
            'datasetID':fileName
          },
          responseType: 'blob'
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
        setNotification4("Service Provider has successfully provided you with " + fileName);
        setResult("");
      } catch (error) {
        setError('Error downloading file');
      }
    } else {
      setError('You do not have permission to download this file.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault(); // Prevent default form submission behavior
    if (!inputValue1) {
      setNotification("Please enter a file name!");
      return;
    }
    if (!inputValue)
    {
      setNotification("Please enter your doctor ID!");
      return;
    }
    console.log("Submitting for: ", inputValue);
    setNotification("Checking your permissions for " + inputValue1);
    console.log(myCreds)
    handleDownload(inputValue,inputValue1);
  };

  return (
    <> 
    <NavBar/>
      <div>
        <h2 id="headerTitle" class="header-title">Uploaded Files</h2>
        <button class="ConnectMetamask" onClick={connectMetamask}>Connect MetaMask</button>
      </div>
      <div class="file-list-container" id="fileListContainer">
      <form onSubmit={handleSubmit}>
          <input style={{backgroundColor:"white"}} type="text" value={inputValue} onChange={handleInputChange} placeholder="Enter your username" />
          <input type="text" value={inputValue1} onChange={handleInputChange1} placeholder="Enter dataset ID" />
          <button type="submit">Check Permissions</button>
          
          {/* <select style={{backgroundColor:"white", width:"calc(100% - 40px)", color: 'grey'}} value={inputValue1} onChange={handleInputChange1}>
            <option value="" disabled>Select a dataset</option>
            {files.map((file, index) => (
              <option key={index} value={file}>{file}</option>
            ))}
          </select>
          <button class="CheckPermissions" type="submit">Check Permissions & Download File</button> */}
        </form>

        {notification5 && <p class="notification-message" id="notificationMessage">{notification5}</p>}
        {notification6 && <p class="notification-message" id="notificationMessage">{notification6}</p>}
        {notification3 && <p class="notification-message" id="notificationMessage">{notification3}</p>}
        {notification && <p class="notification-message" id="notificationMessage">{notification}</p>}
        {notification1 && <p class="notification-message" id="notificationMessage">{notification1}</p>}

        {notification2 && <p class="notification-message" id="notificationMessage">{notification2}</p>}
        
        
         
        {notification7 && <p class="notification-message" id="notificationMessage">{notification7}</p>}
        
        {notification4 && <p class="notification-message" id="notificationMessage">{notification4}</p>}
        
        
        
        
        
        {error && <p class="notification-message" id="notificationMessage">{error}</p>}
        <ul class="file-list" id="fileList">
          {/* {files.map((file, index) => (
            <li key={index} class="file-item" id={`fileItem-${index}`} onClick={() => handleDownload(inputValue,file)}>
              {file}
            </li>
          ))} */}
        </ul>
      </div>
    </>
  );
}

export default FileList;
