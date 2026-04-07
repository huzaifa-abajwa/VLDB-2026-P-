const mongoose = require('mongoose');

const smartContractSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  address: {
    type: String,
    required: true,
  },
});

const SmartContract = mongoose.model('SmartContract', smartContractSchema);

module.exports = SmartContract;
