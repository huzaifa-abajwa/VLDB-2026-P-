// src/components/DataSetPage.js

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/datasetpage.css';
import Layout from './Layout'; // Use Layout component for consistency
import Web3 from 'web3';

const sha256 = require('js-sha256');

const NODE_URL = "REDACTED";
const web3 = new Web3(NODE_URL);

const DataSetPage = () => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [fileDetails, setFileDetails] = useState(null);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState("");
  const [terms, setTerms] = useState([]);
  const [termResponses, setTermResponses] = useState({});
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [currentDataset, setCurrentDataset] = useState(null);

  const [datasetAgreementTitle, setDatasetAgreementTitle] = useState("");
  const [datasetAgreementGeneral, setDatasetAgreementGeneral] = useState("");

  useEffect(() => {
    async function fetchDatasets() {
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/getAllDatasets`);
        setDatasets(response.data);
        setNotification("Datasets fetched successfully.");
      } catch (error) {
        console.error('Error fetching datasets:', error);
        setError("Error fetching datasets.");
      }
    }

    fetchDatasets();
  }, []);

  // Function to remove file extension
  function removeFileExtension(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return filename;
    } else {
      return filename.substring(0, lastDotIndex);
    }
  }

  // Function to fetch policy details
  const getPolicyDetails = async (fileName, flag) => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/getPolicy/${removeFileExtension(fileName)}`);
      if (response.status !== 200) {
        throw new Error('Policy not found');
      }
      const { newContractAddress, abi, argv, permissionFunction, terms } = response.data;
      console.log("Here are the terms: ", terms);

      if (flag) {
        if (terms.datasetAgreementTitle) {
          setDatasetAgreementTitle(terms.datasetAgreementTitle);
        }
        if (terms.datasetAgreementGeneral) {
          setDatasetAgreementGeneral(terms.datasetAgreementGeneral);
        }

        const termsArray = Object.entries(terms)
          .filter(([key]) => key.startsWith('term'))
          .map(([key, value]) => ({ term: key, description: value }));
        setTerms(termsArray);
        setTermResponses(prevResponses => ({
          ...prevResponses,
          [fileName]: new Array(termsArray.length).fill(null)
        }));
        setCurrentDataset(fileName);
        setShowTermsModal(true);
      }

      return response.data;
    } catch (error) {
      console.error("Error fetching policy:", error);
      setError("Error fetching policy details.");
      throw error;
    }
  };

  // Handle dataset selection
  const handleDatasetSelect = async (event) => {
    const datasetName = event.target.value;
    setSelectedDataset(datasetName);
    setFileDetails(null); // Reset file details when a new dataset is selected
    setError(null); // Reset any previous errors
    await getPolicyDetails(datasetName, true);
  };

  // Handle term responses
  const handleTermResponse = (termDescription, index, response) => {
    const updatedResponses = { ...termResponses };
    let finalResponse = response + ":" + sha256(termDescription);
    updatedResponses[currentDataset][index] = finalResponse;
    setTermResponses(updatedResponses);
  };

  // Submit term responses
  const handleTermsSubmit = () => {
    const responses = termResponses[currentDataset];
    if (responses.includes(null)) {
      setError("Please respond to all terms.");
      return;
    }

    const anyDisagree = responses.some(response => response.startsWith("no"));
    if (anyDisagree) {
      setError("You must agree to all terms to access the dataset details.");
      setShowTermsModal(false);
      setFileDetails(null); // Ensure file details are not displayed
      return;
    }

    setError(null);
    setShowTermsModal(false);
    setCurrentDataset(null);
    console.log("Terms responses: ", termResponses);
    fetchFileDetails();
  };

  // Fetch file details after accepting terms
  const fetchFileDetails = async () => {
    try {
      const policyDetails = await getPolicyDetails(selectedDataset, false);
      setFileDetails(policyDetails);
      setNotification("Dataset details fetched successfully.");
    } catch (error) {
      console.error("Error fetching file details:", error);
      setError("Error fetching file details.");
    }
  };

  return (
    <Layout>
      <div className='dataset-page-container'>
        <h1 className="header-title">Dataset Page</h1>
        <div className="dataset-select-container">
          <select
            value={selectedDataset}
            onChange={handleDatasetSelect}
            className="input-field"
            aria-label="Select a dataset"
          >
            <option value="" disabled>Select a dataset</option>
            {datasets.map((dataset, index) => (
              <option key={index} value={dataset}>{dataset}</option>
            ))}
          </select>
        </div>
        {fileDetails && !showTermsModal && !error && (
          <div className="file-details">
            <h3>File: {selectedDataset}</h3>
            <p><strong>Contract Address:</strong> {fileDetails.newContractAddress}</p>
            <p><strong>Permission Function:</strong> {fileDetails.permissionFunction}</p>
            <p><strong>Arguments:</strong> {fileDetails.argv}</p>
            <p><strong>Terms And Conditions:</strong> </p>
            <div className="terms-results">
              {termResponses[selectedDataset] && termResponses[selectedDataset].map((termResponse, idx) => (
                <p key={idx} className="term-result">
                  {termResponse.split(":")[0]}: {termResponse.split(":")[1]}
                </p>
              ))}
            </div>
            {/* Add more details here if necessary */}
          </div>
        )}
        {notification && <p className="notification-message">{notification}</p>}
        {error && <p className="notification-message error-message">{error}</p>}
        {showTermsModal && (
          <div className="terms-modal">
            <div className="terms-modal-content">
              <h2>DATA USAGE AGREEMENT</h2>
              <p className="terms-intro">
                <strong>{datasetAgreementTitle}</strong>
                <br />
                {datasetAgreementGeneral}
                <br />
                To access the following file, you need to comply with the file data usage agreement below:
              </p>
              {terms.map((term, index) => (
                <div key={index} className="term">
                  <p>{term.description}</p>
                  <div className="response-buttons">
                    <button
                      className={`button-yes ${termResponses[currentDataset] && termResponses[currentDataset][index]?.startsWith("yes") ? 'selected' : ''}`}
                      onClick={() => handleTermResponse(term.description, index, "yes")}
                      aria-pressed={termResponses[currentDataset] && termResponses[currentDataset][index]?.startsWith("yes")}
                    >
                      Yes
                    </button>
                    <button
                      className={`button-no ${termResponses[currentDataset] && termResponses[currentDataset][index]?.startsWith("no") ? 'selected' : ''}`}
                      onClick={() => handleTermResponse(term.description, index, "no")}
                      aria-pressed={termResponses[currentDataset] && termResponses[currentDataset][index]?.startsWith("no")}
                    >
                      No
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={handleTermsSubmit}
                disabled={termResponses[currentDataset]?.includes(null)}
                className="modal-submit-button"
                aria-disabled={termResponses[currentDataset]?.includes(null)}
              >
                Submit Responses
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default DataSetPage;
