// src/components/FileUpload.js

import React, { useState, useEffect } from "react";
import axios from 'axios';
import { Link } from 'react-router-dom';
import '../styles/fileupload.css';
import Layout from './Layout'; // Import Layout
import { useDropzone } from 'react-dropzone';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function FileUpload() {
  const [files, setFiles] = useState({
    dataFile: null,
    xacmlFile: null,
    jsonTermsFile: null,
  });
  const [uploadStatus, setUploadStatus] = useState(""); // State to store upload status message
  const [uploadProgress, setUploadProgress] = useState(0); // State to track upload progress

  useEffect(() => {
    // Fetch any necessary data here if required
  }, []);

  // Function to handle file removal
  const removeFile = (fileType) => {
    setFiles(prevFiles => ({
      ...prevFiles,
      [fileType]: null,
    }));
    toast.info(`${fileType.replace(/([A-Z])/g, ' $1')} removed.`);
  };

  // Function to handle file drop
  const onDrop = (acceptedFiles, fileType) => {
    if (acceptedFiles.length === 0) return; // No files dropped
    setFiles(prevFiles => ({
      ...prevFiles,
      [fileType]: acceptedFiles[0],
    }));
    toast.success(`${fileType.replace(/([A-Z])/g, ' $1')} selected: ${acceptedFiles[0].name}`);
  };

  // Dropzone configurations for each file type
  const {
    getRootProps: getDataFileRootProps,
    getInputProps: getDataFileInputProps,
    isDragActive: isDataFileDragActive,
    fileRejections: dataFileRejections
  } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'dataFile'),
    multiple: false,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/xml': ['.xml'],
      'application/json': ['.json'],
      'text/plain': ['.txt'],
      'application/javascript': ['.js'],
      'application/octet-stream': ['.bin']
    },
    maxSize: 10485760 // 10MB in bytes
  });

  const {
    getRootProps: getXacmlFileRootProps,
    getInputProps: getXacmlFileInputProps,
    isDragActive: isXacmlFileDragActive,
    fileRejections: xacmlFileRejections
  } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'xacmlFile'),
    multiple: false,
    accept: {
      'text/xml': ['.xml'],
      'application/xml': ['.xml']
    },
    maxSize: 5242880 // 5MB in bytes
  });

  const {
    getRootProps: getJsonTermsFileRootProps,
    getInputProps: getJsonTermsFileInputProps,
    isDragActive: isJsonTermsFileDragActive,
    fileRejections: jsonTermsFileRejections
  } = useDropzone({
    onDrop: (acceptedFiles) => onDrop(acceptedFiles, 'jsonTermsFile'),
    multiple: false,
    accept: {
      'application/json': ['.json']
    },
    maxSize: 2097152 // 2MB in bytes
  });

  // Handle file rejections for Data File
  useEffect(() => {
    if (dataFileRejections.length > 0) {
      dataFileRejections.forEach(rejection => {
        rejection.errors.forEach(error => {
          if (error.code === 'file-too-large') {
            toast.error("Data file is too large. Maximum size is 10MB.");
          } else if (error.code === 'file-invalid-type') {
            toast.error("Invalid file type for Data file.");
          }
        });
      });
    }
  }, [dataFileRejections]);

  // Handle file rejections for XACML File
  useEffect(() => {
    if (xacmlFileRejections.length > 0) {
      xacmlFileRejections.forEach(rejection => {
        rejection.errors.forEach(error => {
          if (error.code === 'file-too-large') {
            toast.error("XACML file is too large. Maximum size is 5MB.");
          } else if (error.code === 'file-invalid-type') {
            toast.error("Invalid file type for XACML file.");
          }
        });
      });
    }
  }, [xacmlFileRejections]);

  // Handle file rejections for JSON of Terms File
  useEffect(() => {
    if (jsonTermsFileRejections.length > 0) {
      jsonTermsFileRejections.forEach(rejection => {
        rejection.errors.forEach(error => {
          if (error.code === 'file-too-large') {
            toast.error("JSON of terms file is too large. Maximum size is 2MB.");
          } else if (error.code === 'file-invalid-type') {
            toast.error("Invalid file type for JSON of terms file.");
          }
        });
      });
    }
  }, [jsonTermsFileRejections]);

  // Function to handle file upload
  const upload = async () => {
    // Form Validation
    if (!files.dataFile || !files.xacmlFile || !files.jsonTermsFile) {
      setUploadStatus("All files (Data, XACML, and JSON of terms) must be selected to upload.");
      toast.error("Please select all required files before uploading.");
      return;
    }

    const formData = new FormData();
    formData.append('file', files.dataFile);
    formData.append('xacmlFile', files.xacmlFile);
    formData.append('jsonTermsFile', files.jsonTermsFile);

    try {
      setUploadStatus("Uploading files...");
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        }
      });

      if (response.status === 200) {
        setUploadStatus("Files uploaded successfully!");
        toast.success("Files uploaded successfully!");
        setTimeout(() => {
          window.location.reload();
        }, 2000); // Wait 2 seconds before refreshing the page
      } else {
        throw new Error("Upload failed");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("File upload failed. Please try again.");
      toast.error("File upload failed. Please try again.");
      setUploadProgress(0);
    }
  };

  return (
    <Layout>
      <div className="fileupload-container">
        <h1 className="fileupload-title">File Upload</h1>
        <div className="fileupload-form">
          {/* Data File Upload */}
          <div className="input-group">
            <label className="file-label">Upload Data File</label>
            <div 
              {...getDataFileRootProps()} 
              className={`dropzone ${isDataFileDragActive ? 'active' : ''}`} 
              aria-label="Data file upload area"
            >
              <input {...getDataFileInputProps()} aria-labelledby="dataFileUpload" />
              {
                isDataFileDragActive ?
                  <p>Drop the data file here ...</p> :
                  <p>Drag & drop a data file here, or click to select a file</p>
              }
            </div>
            {files.dataFile && (
              <div className="selected-file-container">
                <p className="selected-file-name">{files.dataFile.name}</p>
                <button 
                  type="button" 
                  className="remove-file-button" 
                  onClick={() => removeFile('dataFile')}
                  aria-label={`Remove ${files.dataFile.name}`}
                >
                  &times;
                </button>
              </div>
            )}
          </div>

          {/* XACML File Upload */}
          <div className="input-group">
            <label className="file-label">Upload XACML File</label>
            <div 
              {...getXacmlFileRootProps()} 
              className={`dropzone ${isXacmlFileDragActive ? 'active' : ''}`} 
              aria-label="XACML file upload area"
            >
              <input {...getXacmlFileInputProps()} aria-labelledby="xacmlFileUpload" />
              {
                isXacmlFileDragActive ?
                  <p>Drop the XACML file here ...</p> :
                  <p>Drag & drop a XACML file here, or click to select a file</p>
              }
            </div>
            {files.xacmlFile && (
              <div className="selected-file-container">
                <p className="selected-file-name">{files.xacmlFile.name}</p>
                <button 
                  type="button" 
                  className="remove-file-button" 
                  onClick={() => removeFile('xacmlFile')}
                  aria-label={`Remove ${files.xacmlFile.name}`}
                >
                  &times;
                </button>
              </div>
            )}
          </div>

          {/* JSON of Terms File Upload */}
          <div className="input-group">
            <label className="file-label">Upload JSON of Terms</label>
            <div 
              {...getJsonTermsFileRootProps()} 
              className={`dropzone ${isJsonTermsFileDragActive ? 'active' : ''}`} 
              aria-label="JSON of terms file upload area"
            >
              <input {...getJsonTermsFileInputProps()} aria-labelledby="jsonTermsFileUpload" />
              {
                isJsonTermsFileDragActive ?
                  <p>Drop the JSON file here ...</p> :
                  <p>Drag & drop a JSON file here, or click to select a file</p>
              }
            </div>
            {files.jsonTermsFile && (
              <div className="selected-file-container">
                <p className="selected-file-name">{files.jsonTermsFile.name}</p>
                <button 
                  type="button" 
                  className="remove-file-button" 
                  onClick={() => removeFile('jsonTermsFile')}
                  aria-label={`Remove ${files.jsonTermsFile.name}`}
                >
                  &times;
                </button>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="progress-bar-container" aria-label="Upload progress">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }}>
                {uploadProgress}%
              </div>
            </div>
          )}

          {/* Upload Button */}
          <button 
            type="button" 
            className="upload-button" 
            onClick={upload}
            aria-label="Upload files"
          >
            Upload
          </button>
        </div>
        
        {/* Upload Status Message */}
        {uploadStatus && <p className={`upload-status-message ${uploadStatus.includes('failed') ? 'error' : 'success'}`}>{uploadStatus}</p>}

        {/* Navigation Button */}
        <div className="navigation-button-container">
          <Link to="/dataset">
            <button className="navigation-button">View Datasets</button>
          </Link>
        </div>

        {/* Toast Notifications */}
        <ToastContainer 
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </div>
    </Layout>
  );
}

export default FileUpload;
