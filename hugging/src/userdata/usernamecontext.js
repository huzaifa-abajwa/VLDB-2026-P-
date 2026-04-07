import React, { createContext, useState } from 'react';

// Create the context
export const UsernameContext = createContext();

// Create a provider component
export const UsernameProvider = ({ children }) => {
    const [username, setUsername] = useState('');

    return (
        <UsernameContext.Provider value={{ username, setUsername }}>
            {children}
        </UsernameContext.Provider>
    );
};
