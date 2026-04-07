const mongoose = require("mongoose");
const Individual = require("./models/individual");
const SmartContract = require("./models/SmartContract");

require('dotenv').config();
const MONGO_URI = process.env.MONGODB_URI;

// ─── Users ────────────────────────────────────────────────────────────────────

const users = [
  {
    // Cancer survival analysis — German@2020 + Pakistan + cox@2020 + kaplan@2020
    username: "ibr123",
    password: "123",
    fullName: "Ibrahim Ahmed",
    doctorId: "DOC001",
    hospitalId: "HOSP001",
    accessRights: "read",
    location: "Lahore",
    grantId: "grant-id-74829",
    experienceYears: "7",
    personRole: "researcher",
    specialization: "bioinformatics",
    designation: "researcher",
    fromNetworks: "hospital-network",
    department: "bioinformatics",
    certifications: "PhD",
    researchFocus: "bioinformatics",
    authorizedBy: "faculty-advisor",
  },
  {
    // Heart failure dataset + google_Health model
    username: "sarah123",
    password: "123",
    fullName: "Sarah Chen",
    doctorId: "DOC002",
    hospitalId: "HOSP002",
    accessRights: "read",
    location: "New York",
    grantId: "grant-id-31205",
    experienceYears: "5",
    personRole: "researcher",
    specialization: "bioinformatics",
    designation: "researcher",
    fromNetworks: "hospital-network",
    department: "bioinformatics",
    certifications: "PhD",
    researchFocus: "bioinformatics",
    authorizedBy: "faculty-advisor",
  },
  {
    // SEER exclusive + cox@2020 + kaplan@2020
    username: "seer_admin",
    password: "1234",
    fullName: "SEER Admin", // placeholder — update with real name
    doctorId: "DOC003",
    hospitalId: "HOSP003",
    accessRights: "read",
    location: "Washington DC",
    grantId: "grant-id-00547",
    experienceYears: "7",
    personRole: "researcher",
    specialization: "bioinformatics",
    designation: "researcher",
    fromNetworks: "hospital-network",
    department: "bioinformatics",
    certifications: "PhD",
    researchFocus: "bioinformatics",
    authorizedBy: "faculty-advisor",
  },
  {
    // UCI diabetic dataset + lstm@2026 + mlp@2025
    username: "mike123",
    password: "123",
    fullName: "Michael Torres",
    doctorId: "DOC004",
    hospitalId: "HOSP004",
    accessRights: "read",
    location: "Chicago",
    grantId: "grant-id-42857",
    experienceYears: "3",
    personRole: "researcher",
    specialization: "medical-research",
    designation: "researcher",
    fromNetworks: "hospital-network",
    department: "bioinformatics",
    certifications: "PhD",
    researchFocus: "bioinformatics",
    authorizedBy: "faculty-advisor",
  },
  {
    // Sylhet + Pima + rsf@2025 + xgboost@2025
    username: "priya123",
    password: "123",
    fullName: "Priya Sharma",
    doctorId: "DOC005",
    hospitalId: "HOSP005",
    accessRights: "read",
    location: "London",
    grantId: "grant-id-63940",
    experienceYears: "3",
    personRole: "researcher",
    specialization: "medical-research",
    designation: "researcher",
    fromNetworks: "hospital-network",
    department: "bioinformatics",
    certifications: "PhD",
    researchFocus: "bioinformatics",
    authorizedBy: "faculty-advisor",
  },
];

// ─── Smart Contracts ──────────────────────────────────────────────────────────

// const contracts =[
//   {
//     "name": "cox_model@2020",
//     "address": "0x9907d30b6d72397Db6c2f0624f49abd2F03212bD"
//   },
//   {
//     "name": "German_Cancer_registry@2020",
//     "address": "0x028126D07A0C76e0F1E5ba9efF0E6CdEEcee5b1b"
//   },
//   {
//     "name": "google_Health_Cancer_Prediction_Model",
//     "address": "0x210D2Cd6c45a394a20C41F21c8d7b1feaDEb5635"
//   },
//   {
//     "name": "heart_failure_clinical_records_dataset",
//     "address": "0xE1150c0050248A3C2c0329389788a6cCb6851957"
//   },
//   {
//     "name": "kaplan_meier_model@2020",
//     "address": "0xFb80E0eF91508529f3AB1b494f755fD29bAeD615"
//   },
//   {
//     "name": "lstm_readmission_model@2026",
//     "address": "0xEd4c83817a42BB651Fc018760e3797D976d2A5a7"
//   },
//   {
//     "name": "mlp_cancer_classifier@2025",
//     "address": "0x5B923Ddf0fB5fDc544254833b3860f2073f6324b"
//   },
//   {
//     "name": "National_Cancer_Registry_of_Pakistan",
//     "address": "0x7C9Efd5cb7233f45E94aC7a1E943750144c4F978"
//   },
//   {
//     "name": "Pima_Indians_Diabetes_USA",
//     "address": "0x084DE6165e48B36C325b59c4D8Fb308bdf7531A0"
//   },
//   {
//     "name": "random_survival_forest@2025",
//     "address": "0x38F9a78F6c78b11d9A7F4Aa816A1C0EA90c950D6"
//   },
//   {
//     "name": "SEER_Cancer_Registry_of_USA",
//     "address": "0x3E39b7A3B7a1593Fa2d6CCd45Bf88d4c1683eA2A"
//   },
//   {
//     "name": "Sylhet_Diabetes_Hospital_Bangladesh",
//     "address": "0x0aa657216EA57a1B868778308F75c38925e96066"
//   },
//   {
//     "name": "UCI_diabetic_dataset",
//     "address": "0xf8B1b0720a9220325e58a4D9488A0d43c0Bb160A"
//   },
//   {
//     "name": "xgboost_risk_model@2025",
//     "address": "0xf027B194D78C6Dd4d2b5d01fD438c83E9CA5f517"
//   }
// ]

const contracts = [
  {
    name: "cox_model@2020",
    address: "0x18F1beE969e14F98f77d84AF4C1EC30bddAe824F",
  },
  {
    name: "German_Cancer_registry@2020",
    address: "0xa2fef1e1EA2768a11AAB8E8FCae216C0Ad78511D",
  },
  {
    name: "google_Health_Cancer_Prediction_Model",
    address: "0x712d955bF8fB28430E4341D834D582CbAB7c368C",
  },
  {
    name: "heart_failure_clinical_records_dataset",
    address: "0x495fB73dc0a918cE2B642e939b438dFdD55Ce2a7",
  },
  {
    name: "kaplan_meier_model@2020",
    address: "0x7CA3F8ea356C01B4cA1524cD046189dC7eFB83ae",
  },
  {
    name: "lstm_readmission_model@2026",
    address: "0x48ddC12Dd22Ac67039f9A6B118fFC44C056cb38B",
  },
  {
    name: "mlp_cancer_classifier@2025",
    address: "0xd37090144C91eA0Ac3B80F2Be6A8921069791d9F",
  },
  {
    name: "National_Cancer_Registry_of_Pakistan",
    address: "0x0c34336FD97E5b81EaB6310d1DcF85Bd57b5Ff9e",
  },
  {
    name: "Pima_Indians_Diabetes_USA",
    address: "0x0Ea744b2d0D3e4eFc86e3e75052D0a56E9d0360D",
  },
  {
    name: "random_survival_forest@2025",
    address: "0x0386C43a72F18432bFe045E72d1767C8522ecf7c",
  },
  {
    name: "SEER_Cancer_Registry_of_USA",
    address: "0x8056a6C71B19360aF6E584872146CAe8F5f1A125",
  },
  {
    name: "Sylhet_Diabetes_Hospital_Bangladesh",
    address: "0x3203d2E4317EB0f4953a2eDaA79789E386919A2E",
  },
  {
    name: "UCI_AfricanAmerican_Readmission",
    address: "0x23E8f3BF4054122802Db8d243DC6154E38F1e0d3",
  },
  {
    name: "UCI_Asian_Readmission",
    address: "0x304Cff7f100FE70f8f6273Cc43BC94b3164bc56C",
  },
  {
    name: "UCI_Caucasian_Readmission",
    address: "0x42d17d0Bf2E5995495DCda8A878319Edc6A94066",
  },
  {
    name: "UCI_diabetic_dataset",
    address: "0x1a3A07f36282c8d38EfD95a6c7c267c3351A7955",
  },
  {
    name: "UCI_Hispanic_Readmission",
    address: "0x0044E1c89508b131712B7BD35444829FF518bb9e",
  },
  {
    name: "xgboost_risk_model@2025",
    address: "0xc087a6fEAe902cb0Ab61a69bB3d9719668A81D2D",
  },
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("\x1b[34m%s\x1b[0m", "DB connected");

    // ── Wipe existing data ───────────────────────────────────────────────────
    console.log("\n--- Wiping existing data ---");
    const delUsers = await Individual.deleteMany({});
    const delContracts = await SmartContract.deleteMany({});
    console.log(`Deleted ${delUsers.deletedCount} users`);
    console.log(`Deleted ${delContracts.deletedCount} contracts`);

    // ── Seed users ───────────────────────────────────────────────────────────
    console.log("\n--- Seeding Users ---");
    for (const userData of users) {
      const user = new Individual(userData);
      await user.save();
      console.log(
        `\x1b[32mCreated user: ${userData.username} (${userData.fullName})\x1b[0m`,
      );
    }

    // ── Seed contracts ───────────────────────────────────────────────────────
    console.log("\n--- Seeding Smart Contracts ---");
    for (const contractData of contracts) {
      const contract = new SmartContract(contractData);
      await contract.save();
      console.log(`\x1b[32mCreated contract: ${contractData.name}\x1b[0m`);
      console.log(`  → ${contractData.address}`);
    }

    console.log(
      "\n\x1b[32m%s\x1b[0m",
      `Seeding complete. ${users.length} users, ${contracts.length} contracts.`,
    );
  } catch (err) {
    console.error("\x1b[31m%s\x1b[0m", "Seeding failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
