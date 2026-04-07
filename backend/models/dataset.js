const mongoose = require('mongoose');

// Define dataset schema
const datasetSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Define Dataset model
const Dataset = mongoose.model('Dataset', datasetSchema);

module.exports = Dataset;
