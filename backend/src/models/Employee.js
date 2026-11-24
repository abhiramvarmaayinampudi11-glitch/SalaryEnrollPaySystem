/**
 * Employee Mongoose Model
 * Stores employee personal, departmental, statutory eligibility, and enrollment attributes.
 */

const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required.'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    firstName: {
      type: String,
      required: [true, 'First name is required.'],
      trim: true
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required.'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email address is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, 'Please provide a valid email address.']
    },
    department: {
      type: String,
      default: 'General',
      trim: true
    },
    designation: {
      type: String,
      default: 'Staff',
      trim: true
    },
    joiningDate: {
      type: Date,
      default: Date.now
    },
    // Statutory flags
    pfEligible: {
      type: Boolean,
      default: true
    },
    capPfAtWageCeiling: {
      type: Boolean,
      default: true
    },
    esicEligible: {
      type: Boolean,
      default: null // null indicates auto-evaluation by gross wage limit
    },
    hasDisability: {
      type: Boolean,
      default: false // Qualifies for higher ESIC wage limit of ₹25,000
    },
    stateForPt: {
      type: String,
      default: 'DEFAULT',
      trim: true,
      uppercase: true
    },
    pan: {
      type: String,
      trim: true,
      uppercase: true
    },
    uan: {
      type: String,
      trim: true
    },
    esicIpNumber: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for full name
employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model('Employee', employeeSchema);
