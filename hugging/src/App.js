import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './components/landingpage';
import Login from './components/login';
import Signup from './components/signup';
import UserPage from './components/userpage';
import FileUpload from './components/fileupload';
import FileList from './components/filelist';
import { UsernameProvider } from './userdata/usernamecontext';
import SmartContract from './components/smartcontract';
// import PreSignup from './components/presignup';
import WorkflowPage from './components/workflowpage';
import DataSetPage from './components/datasetpage';
import LegacyPage from './components/legacypage';
import LLMPage from './components/LLMPage';
import ProtectedRoute from './ProtectedRoute'; // Import ProtectedRoute
import WorkflowManipulation from './components/WorkflowManipulation';
import { ThemeProvider } from './components/ThemeContext'; 


function App() {
  return (
    <ThemeProvider>
    <UsernameProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route exact path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* Protected Routes */}
            <Route path="/llmpage" element={<ProtectedRoute element={<LLMPage />} />} />
            <Route path="/userpage" element={<ProtectedRoute element={<UserPage />} />} />
            <Route path="/fileupload" element={<ProtectedRoute element={<FileUpload />} />} />
            <Route path="/filelist" element={<ProtectedRoute element={<FileList />} />} />
            <Route path="/smartcontract" element={<ProtectedRoute element={<SmartContract />} />} />
            <Route path="/workflow" element={<ProtectedRoute element={<WorkflowPage />} />} />
            <Route path="/dataset" element={<ProtectedRoute element={<DataSetPage />} />} />
            <Route path="/legacypage" element={<ProtectedRoute element={<LegacyPage />} />} />
            <Route path="/workflowmanipulation" element={<ProtectedRoute element={<WorkflowManipulation />} />} />
          </Routes>
        </div>
      </Router>
    </UsernameProvider>
    </ThemeProvider>
  );
}

export default App;
