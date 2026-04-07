import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/legacypage.css';
import NavBar from './navbar';

// Import images
import fileListIcon from '../styles/frontend-icon.png';

const LegacyPage = () => {
  useEffect(() => {
    document.body.classList.add('legacy-page');
    return () => {
      document.body.classList.remove('legacy-page');
    };
  }, []);

  return (
    <div className="LegacyPageContainer">
      <NavBar />
      <div className="TextWrapper">
        <h1>Legacy Pages</h1>
      </div>
      <div className="IconContainer">
        <Link to="/filelist">
          <div className="IconWrapper">
            <img src={fileListIcon} alt="File List" className="Icon" />
            <button className="Button">File List</button>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default LegacyPage;
