import React from 'react';
import NavBar from './navbar';
import '../styles/layout.css'; 

const Layout = ({ children }) => {
  return (
    <>
      <NavBar />
      <main className="main-content">
        {children}
      </main>
    </>
  );
}

export default Layout;
