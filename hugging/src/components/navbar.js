// src/components/NavBar.js

import React, { useState, useEffect, useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import '../styles/navbar.css';
import Logo from '../styles/logo.png';
import { isAuthenticated, logout } from '../utils/auth';
import { ThemeContext } from '../components/ThemeContext'; // Import ThemeContext
import { FaMoon, FaSun } from 'react-icons/fa'; // Import icons for the toggle

const NavBar = () => {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrollingUp, setIsScrollingUp] = useState(true);
  const [isSmall, setIsSmall] = useState(false);

  const { isDarkMode, setIsDarkMode } = useContext(ThemeContext); // Use ThemeContext

  useEffect(() => {
    let lastScrollTop = 0;

    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

      if (scrollTop > lastScrollTop && scrollTop > 100) {
        setIsScrollingUp(false);
      } else {
        setIsScrollingUp(true);
      }

      setIsSmall(scrollTop > 50);
      lastScrollTop = scrollTop;
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  // Toggle Dark Mode
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <nav
      className={`NavBar ${isScrollingUp ? '' : 'hidden'} ${
        isSmall ? 'smaller' : ''
      } ${isDarkMode ? 'dark' : 'light'}`}
    >
      <div className="NavContainer">
        <NavLink
          to="/userpage"
          className="Brand"
          aria-label="Collaborative ML Cloud Infrastructure Home"
        >
          <img
            src={Logo}
            alt="Collaborative ML Cloud Infrastructure Logo"
            className="BrandLogo"
          />
          <span className="BrandName">Collaborative ML Cloud Infrastructure</span>
        </NavLink>
        <button
          onClick={toggleMenu}
          className="MenuToggle"
          aria-controls="navbar-menu"
          aria-expanded={isMenuOpen}
          aria-label="Toggle navigation menu"
        >
          <svg
            className="MenuIcon"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 17 14"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M1 1h15M1 7h15M1 13h15"
            />
          </svg>
        </button>
        <div
          className={`NavMenu ${isMenuOpen ? 'active' : ''}`}
          id="navbar-menu"
        >
          <ul className="NavList">
            {isAuthenticated() && (
              <>
                <li>
                  <NavLink
                    to="/userpage"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Home
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/workflow"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Workflow
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/dataset"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Dataset
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/fileupload"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    File Upload
                  </NavLink>
                </li>
                {/* Add LLMPage Link */}
                <li>
                  <NavLink
                    to="/LLMPage"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    LLM Interface
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/legacypage"
                    className={({ isActive }) =>
                      `NavItem ${isActive ? 'active' : ''}`
                    }
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Legacy Pages
                  </NavLink>
                </li>
              </>
            )}
          </ul>
          <div className="NavActions">
            <button
              onClick={toggleDarkMode}
              className="DarkModeToggle"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <FaSun /> : <FaMoon />}
            </button>
            {isAuthenticated() && (
              <button onClick={handleSignOut} className="SignOutButton">
                Sign Out
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
