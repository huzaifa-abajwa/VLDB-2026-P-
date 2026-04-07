// src/context/ThemeContext.js

import React, { createContext, useState, useEffect } from 'react';

// Create the context
export const ThemeContext = createContext();

// Create a provider component
export const ThemeProvider = ({ children }) => {
  // Initialize theme state based on user's preference or default to light mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check local storage for theme preference
    const storedTheme = localStorage.getItem('isDarkMode');
    return storedTheme ? JSON.parse(storedTheme) : false;
  });

  // Update local storage whenever theme changes
  useEffect(() => {
    localStorage.setItem('isDarkMode', JSON.stringify(isDarkMode));
    // Add or remove 'dark-mode' class from body
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  return (
    <ThemeContext.Provider value={{ isDarkMode, setIsDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
