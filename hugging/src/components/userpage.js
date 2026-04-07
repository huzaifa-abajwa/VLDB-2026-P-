import React, { useContext, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/userpage.css';
import { UsernameContext } from '../userdata/usernamecontext';
import NavBar from './navbar'; // Import NavBar

// Import images
import frontendIcon from '../styles/frontend-icon.png';
import backendIcon from '../styles/backend-icon.png';
import databaseIcon from '../styles/database-icon.png';
import infrastructureIcon from '../styles/infrastructure-icon.png';

const UserPage = () => {
  const { username } = useContext(UsernameContext);

  useEffect(() => {
    document.body.classList.add('user-page');
    return () => {
      document.body.classList.remove('user-page');
    };
  }, []);

  return (
    <div className='UserPageContainer'>
      <NavBar /> {/* Add NavBar */}
      <div className="TextWrapper">
        <h1>Welcome {username} to our Collaborative ML Cloud Infrastructure!</h1>
      </div>
      <div className="IconContainer">
        <Link to="/fileupload">
          <div className="IconWrapper">
            <img src={backendIcon} alt="Back-end" className="Icon" />
            <button className="Button">Upload Datasets</button>
          </div>
        </Link>
        <Link to="/workflow">
          <div className="IconWrapper">
            <img src={databaseIcon} alt="Database" className="Icon" />
            <button className="Button">Workflow Page</button>
          </div>
        </Link>
        <Link to="/dataset">
          <div className="IconWrapper">
            <img src={infrastructureIcon} alt="Infrastructure" className="Icon" />
            <button className="Button">Dataset Page</button>
          </div>
        </Link>
        {/* Add LLMPage Link */}
        <Link to="/LLMPage">
          <div className="IconWrapper">
            <img src={frontendIcon} alt="LLM Interface" className="Icon" />
            <button className="Button">LLM Interface</button>
          </div>
        </Link>
      </div>
    </div>
  );
};

export default UserPage;
