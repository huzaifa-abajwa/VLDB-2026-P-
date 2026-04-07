import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/signup.css'; // Reuse the same CSS as the signup page
import axios from 'axios';

const PreSignup = () => {
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        document.body.classList.add('signup-page');
        return () => {
            document.body.classList.remove('signup-page');
        };
    }, []);

    const handlePasswordChange = (e) => {
        setPassword(e.target.value);
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post(`${process.env.REACT_APP_API_URL}/auth/adminLogin`, { password });
            const result = response.data; // Directly access response.data
            if (result.valid) {
                navigate('/signup');
            } else {
                setErrorMessage('Invalid password. Please try again.');
            }
        } catch (error) {
            console.error(error);
            setErrorMessage('Invalid password. Please try again.');
        }
    };

    return (
        <div className="signup-container">
            <h1 className="signup-title">Enter SignUp Credentials</h1>
            <form className="signup-form" onSubmit={handlePasswordSubmit}>
                <input 
                    type="password" 
                    className="signup-password" 
                    name="password" 
                    placeholder="Enter Password" 
                    onChange={handlePasswordChange} 
                    required 
                />
                <button type="submit" className="signup-button">Submit</button>
            </form>
            {errorMessage && (
                <div className="signup-error">
                    <p>{errorMessage}</p>
                </div>
            )}
        </div>
    );
};

export default PreSignup;
