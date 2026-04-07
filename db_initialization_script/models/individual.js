const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const individualSchema = new Schema({
  username: { type: String, unique: true, required: true },
  fullName: { type: String, required: true },
  doctorId: { type: String },
  hospitalId: { type: String },
  specialization: { type: String },
  accessRights: { type: String },
  location: { type: String },
  password: { type: String, required: true },
  grantId: { type: String },
  experienceYears: { type: String },
  personRole: { type: String },
  specialization: { type: String },
  designation: { type: String },
  fromNetworks: { type: String },
  department: { type: String },
  certifications: { type: String },
  researchFocus: { type: String },
  authorizedBy: { type: String }
});




const Individual = mongoose.model('Individual', individualSchema);

module.exports = Individual;
