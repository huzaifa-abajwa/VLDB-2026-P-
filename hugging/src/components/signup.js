import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/signup.css';
import { Link } from 'react-router-dom';

const SignUp = () => {
    const [formData, setFormData] = useState({
        username: '',
        fullName: '',
        doctorId: '',
        hospitalId: '',
        specialization: '',
        accessRights: '',
        location: '',
        password: ''
    });
    const [success, setSuccess] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        document.body.classList.add('signup-page');
        return () => {
            document.body.classList.remove('signup-page');
        };
    }, []);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post(`${process.env.REACT_APP_API_URL}/auth/signup`, formData);
            console.log(response.data);
            setSuccess(true);
            setErrorMessage('');
        } catch (error) {
            console.error(error.response.data);
            setSuccess(false);
            setErrorMessage('Signup failed. Please try again.');
        }
    };

    return (
        <div className="signup-container">
            <h1 className="signup-title">Create Your Account</h1>
            {success ? (
                <div className="signup-success">
                    <p>Signup successful! Welcome aboard.</p>
                    <Link to="/login"><button className="button">Login</button></Link>
                </div>
            ) : (
                <form className="signup-form" onSubmit={handleSubmit}>
                    <input type="text" className="signup-input" name="username" placeholder="Username" onChange={handleChange} required />
                    <input type="text" className="signup-input" name="fullName" placeholder="Full Name" onChange={handleChange} required />
                    <input type="text" className="signup-input" name="doctorId" placeholder="Doctor ID" onChange={handleChange} />
                    <input type="text" className="signup-input" name="hospitalId" placeholder="Hospital ID" onChange={handleChange} />
                    <input type="text" className="signup-input" name="specialization" placeholder="Specialization" onChange={handleChange} />
                    <input type="text" className="signup-input" name="accessRights" placeholder="Access Rights" onChange={handleChange} />
                    <input type="text" className="signup-input" name="location" placeholder="Location" onChange={handleChange} />
                    <input type="password" className="signup-password" name="password" placeholder="Password" onChange={handleChange} required />
                    <button type="submit" className="signup-button">Sign Up</button>
                </form>
            )}
            {errorMessage && (
                <div className="signup-error">
                    <p>{errorMessage}</p>
                </div>
            )}
        </div>
    );
};

export default SignUp;
