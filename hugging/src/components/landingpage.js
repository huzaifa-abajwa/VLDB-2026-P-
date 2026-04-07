import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/landingpage.css';
import Logo from '../styles/logo.png'; // Import your logo
import BackendIcon from '../styles/backend-icon.png'; // Import backend icon
import FrontendIcon from '../styles/frontend-icon.png'; // Import frontend icon
import DatabaseIcon from '../styles/database-icon.png'; // Import database icon

const LandingPage = () => {
  useEffect(() => {
    // Add the class to the body when the component mounts
    document.body.classList.add('landing-page');

    // Clean up the class when the component unmounts
    return () => {
      document.body.classList.remove('landing-page');
    };
  }, []);

  return (
    <div className="LandingPageContainer">
      <nav className="LandingPageNav">
        <div className="NavBrand">
          <img src={Logo} alt="Collaborative ML Cloud Logo" className="NavLogo" />
          <span className="NavTitle">Collaborative ML Cloud Infrastructure</span>
        </div>
        <div className="NavLinks">
          <Link to="/login" className="NavLink">Login</Link>
          <Link to="/signup" className="NavLink">Signup</Link>
        </div>
      </nav>

      <header className="LandingHeader">
        <h1 className="LandingTitle">Empower Your Machine Learning Projects</h1>
        <p className="LandingSubtitle">Join our cloud-based platform to collaborate, share, and deploy machine learning models with ease.</p>
        <div className="LandingButtons">
          <Link to="/signup"><button className="PrimaryButton">Get Started</button></Link>
          <Link to="/login"><button className="SecondaryButton">Login</button></Link>
        </div>
      </header>

      <section className="FeaturesSection">
        <div className="FeatureCard">
          <img src={BackendIcon} alt="Backend" className="FeatureIcon" />
          <h3 className="FeatureTitle">Backend Infrastructure</h3>
          <p className="FeatureDescription">Robust and scalable backend services for your ML models.</p>
        </div>
        <div className="FeatureCard">
          <img src={FrontendIcon} alt="Frontend" className="FeatureIcon" />
          <h3 className="FeatureTitle">Frontend Interface</h3>
          <p className="FeatureDescription">User-friendly interfaces for easy interaction with your models.</p>
        </div>
        <div className="FeatureCard">
          <img src={DatabaseIcon} alt="Database" className="FeatureIcon" />
          <h3 className="FeatureTitle">Data Management</h3>
          <p className="FeatureDescription">Efficient data storage and retrieval solutions.</p>
        </div>
      </section>

      <footer className="LandingFooter">
        <p>&copy; 2024 Collaborative ML Cloud. All rights reserved.</p>
        <div className="FooterLinks">
          <Link to="/privacy-policy" className="FooterLink">Privacy Policy</Link>
          <Link to="/terms-of-service" className="FooterLink">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
