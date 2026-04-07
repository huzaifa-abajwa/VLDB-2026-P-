// Import necessary modules
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Import for the signature creation :
const ethUtil = require("ethereumjs-util");
const secp256k1 = require("secp256k1");
const ethers = require("ethers");

const Individual = require("../models/individual"); // Import the Individual model

// 3rd party's private key :
const PRIVATEKEY = process.env.SIGNING_PRIVATE_KEY;

async function signMessage(message) {
  const originalMessageHash = ethUtil.keccak256(Buffer.from(message));
  const wallet = new ethers.Wallet(PRIVATEKEY);
  const signature = await wallet.signMessage(originalMessageHash);
  console.log("Signature created is : ", signature);
  return signature;
}

// Signup Route
router.post("/signup", async (req, res) => {
  try {
    const existingUser = await Individual.findOne({
      username: req.body.username,
    });
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newIndividual = new Individual({
      username: req.body.username,
      fullName: req.body.fullName,
      doctorId: req.body.doctorId,
      hospitalId: req.body.hospitalId,
      specialization: req.body.specialization,
      accessRights: req.body.accessRights,
      location: req.body.location,
      password: hashedPassword,
    });

    await newIndividual.save();
    console.log("signup successful");
    res.status(201).json({ message: "Signup successful" });
  } catch (error) {
    res.status(500).json({ message: "Signup failed", error: error.message });
  }
});

// Login Route
router.post("/login", async (req, res) => {
  try {
    console.log("req.body", req.body);
    const individual = await Individual.findOne({
      username: req.body.username,
    });
    if (!individual) {
      return res.status(400).json({ message: "Invalid username!" });
    }
    // Checkin the password
    const passwordMatch = req.body.password === individual.password;
    console.log("passwordMatch", passwordMatch);
    if (!passwordMatch) {
      return res.status(400).json({ message: "Invalid password!" });
    }
    console.log("login successful");

    // Creating token using our private key
    let tokenString =
      individual.doctorId +
      "," +
      individual.hospitalId +
      "," +
      individual.specialization +
      "," +
      individual.location;
    console.log("The token stirng is : ", tokenString);
    let tokenSignature = await signMessage(tokenString);
    res
      .status(200)
      .json({ message: "Login successful", token: tokenSignature });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

router.post("/adminLogin", async (req, res) => {
  try {
    const { password } = req.body;
    if (password === "hello123") {
      res.status(200).json({ message: "Login successful", valid: true });
    } else {
      res.status(401).json({ message: "Login failed", valid: false });
    }
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

module.exports = router;
