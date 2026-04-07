const mongoose = require('mongoose');
const SmartContract = require('./models/SmartContract');

require('dotenv').config();
const MONGO_URI = process.env.MONGODB_URI;

async function wipe() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('\x1b[34m%s\x1b[0m', 'DB connected');

    const result = await SmartContract.deleteMany({});
    console.log(`\x1b[31mDeleted ${result.deletedCount} smart contract entries.\x1b[0m`);

    console.log('\x1b[32mWipe complete.\x1b[0m');
  } catch (err) {
    console.error('\x1b[31mWipe failed:\x1b[0m', err);
  } finally {
    await mongoose.disconnect();
  }
}

wipe();