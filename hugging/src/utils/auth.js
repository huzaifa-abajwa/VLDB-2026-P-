// src/utils/auth.js

export const isAuthenticated = () => {
  // Check if a token exists in localStorage (or session storage)
  return localStorage.getItem('authToken') !== null;
};

export const login = (token) => {
  localStorage.setItem('authToken', token);
};

export const logout = () => {
  // Remove WorkflowPage selections
  localStorage.removeItem('workflowSelectedModels');
  localStorage.removeItem('workflowSelectedDatasets');

  // Remove LLMPage selections
  localStorage.removeItem('llmSelectedModels');
  localStorage.removeItem('llmSelectedDatasets');

  // Remove authentication token
  localStorage.removeItem('authToken');
};
