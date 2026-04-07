import React, { useState, useContext, useEffect } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom'; 
import '../styles/login.css';
import { UsernameContext } from '../userdata/usernamecontext';
import { login } from '../utils/auth'; // Import the login utility function

const Login = () => {
    const { setUsername } = useContext(UsernameContext); 
    const [formData, setFormData] = useState({
        username: '',
        password: ''
    });
    const [error, setError] = useState('');
    const navigate = useNavigate(); // Use useNavigate for navigation

    useEffect(() => {
        // Add the class to the body when the component mounts
        document.body.classList.add('login-page');
        
        // Clean up the class when the component unmounts
        return () => {
            document.body.classList.remove('login-page');
        };
    }, []);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setError(''); // Clear error message when user changes input
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post(`${process.env.REACT_APP_API_URL}/auth/login`, formData);
            if (response.status === 200) {
                const token = response.data.token;
                
                // Save token in localStorage
                login(token); // Use the login function from auth.js
                
                // Set username in context
                setUsername(formData.username); 
                
                // Redirect to the userpage
                navigate('/userpage');
            }
        } catch (error) {
            console.error('Login failed:', error.response?.data || error);
            setError('Invalid username or password'); // Set error message
        }
    };

    return (
        <div id="login-container" className="container">
            <h2 className="form-title">Login</h2>
            <form id="login-form" className="form" onSubmit={handleSubmit}>
                <input 
                    type="text" 
                    id="username" 
                    className="input username" 
                    name="username" 
                    placeholder="Username" 
                    value={formData.username} 
                    onChange={handleChange} 
                    required 
                />
                <input 
                    type="password" 
                    id="password" 
                    className="input password" 
                    name="password" 
                    placeholder="Password" 
                    value={formData.password} 
                    onChange={handleChange} 
                    required 
                />
                <button type="submit" className="submit-btn">Login</button>
                {error && <p className="error-message">{error}</p>} {/* Display error message */}
                <p>Don't have an account? <Link to="/signup" className="signup-link">Register</Link></p> {/* Use Link component */}
            </form>
        </div>
    );
};

export default Login;
