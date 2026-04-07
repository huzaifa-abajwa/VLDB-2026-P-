import React, { useState, useEffect } from 'react';
import Web3 from 'web3';
import '../styles/smartcontract.css';

function App() {
  const [account, setAccount] = useState('');
  const [ID, setID] = useState('');
  const [doctorID, setDoctorID] = useState('');
  const [hospitalID, setHospitalID] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [accessRights, setAccessRights] = useState('');
  const [location, setLocation] = useState('');
  const [result, setResult] = useState('');
  const [contract, setContract] = useState(null);

  const ABI = [
    {
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
    }
  ];
  const address = "0x8b18DeBe665AA7aCB94e32977a432C598B5E7271";

  useEffect(() => {
    if (window.ethereum) {
      window.web3 = new Web3(window.ethereum);
    }
  }, []);

  const connectMetamask = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
      } catch (error) {
        console.error('MetaMask connection error:', error);
        alert('MetaMask connection failed!');
      }
    } else {
      alert('MetaMask is not installed!');
    }
  };

  const connectContract = async () => {
    return new Promise((resolve, reject) => {
      if (window.web3) {
        try {
          const contractInstance = new window.web3.eth.Contract(ABI, address);
          setContract(contractInstance);
          console.log("Connected to smart contract");
          resolve(contractInstance);
        } catch (error) {
          console.error('Error connecting to contract:', error);
          reject(error);
        }
      } else {
        alert('Web3 is not initialized. Please connect MetaMask first.');
        reject('Web3 not initialized');
      }
    });
  };

  const evaluation = async () => {
    console.log('Evaluating...');
    console.log('ID:', ID);
    console.log('doctorID:', doctorID);
    console.log('hospitalID:', hospitalID);
    console.log('specialization:', specialization);
    console.log('accessRights:', accessRights);
    console.log('Location:', location);

    try {
      const connectedContract = contract || await connectContract();
      await connectedContract.methods.evaluate(ID, doctorID, hospitalID, specialization, accessRights, location)
        .send({ from: account });
      console.log('Sent evaluation transaction');

      setTimeout(async () => {
        const evaluationResult = await connectedContract.methods.getEvaluationResult(ID).call();
        console.log('Evaluation result:', evaluationResult);
        setResult(evaluationResult);
      }, 10000); // Wait for 10 seconds before calling getEvaluationResult
    } catch (error) {
      console.error('Evaluation error:', error);
      setResult('Evaluation failed: ' + error.message);
    }
  };

  return (
    <div className="App">
      <h1>Access Control Policy for Hospital Dataset</h1>
      <button onClick={connectMetamask}>Connect to MetaMask</button>
      <br />
      {account && <div>Account Address: {account}</div>}
      <input type="text" value={ID} onChange={e => setID(e.target.value)} placeholder="ID" /><br />
      <input type="text" value={doctorID} onChange={e => setDoctorID(e.target.value)} placeholder="Doctor ID" /><br />
      <input type="text" value={hospitalID} onChange={e => setHospitalID(e.target.value)} placeholder="Hospital ID" /><br />
      <input type="text" value={specialization} onChange={e => setSpecialization(e.target.value)} placeholder="Specialization" /><br />
      <input type="text" value={accessRights} onChange={e => setAccessRights(e.target.value)} placeholder="Access Rights" /><br />
      <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" /><br />
      <button onClick={evaluation}>Evaluate</button>
      <div>{result && `Evaluation Result: ${result}`}</div>
    </div>
  );
}

export default App;
