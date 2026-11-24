/**
 * Salary Structure Mongoose Model
 * Represents the base monthly salary structure and fixed allowances for an employee.
 */

const mongoose = require('mongoose');

const salaryStructureSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: false
    },
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required.'],
      trim: true,
      uppercase: true,
      index: true
    },
    basic: {
      type: Number,
      required: [true, 'Basic salary is required.'],
      min: [0, 'Basic salary cannot be negative.']
    },
    da: {
      type: Number,
      default: 0,
      min: [0, 'Dearness Allowance cannot be negative.']
    },
    hra: {
      type: Number,
      default: 0,
      min: [0, 'House Rent Allowance cannot be negative.']
    },
    conveyance: {
      type: Number,
      default: 0,
      min: [0, 'Conveyance allowance cannot be negative.']
    },
    specialAllowance: {
      type: Number,
      default: 0,
      min: [0, 'Special allowance cannot be negative.']
    },
    otherAllowances: {
      type: Number,
      default: 0,
      min: [0, 'Other allowances cannot be negative.']
    },
    nominalGrossFixed: {
      type: Number,
      default: 0
    },
    effectiveDate: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Auto-calculate nominal fixed gross before save
salaryStructureSchema.pre('save', function (next) {
  this.nominalGrossFixed =
    (this.basic || 0) +
    (this.da || 0) +
    (this.hra || 0) +
    (this.conveyance || 0) +
    (this.specialAllowance || 0) +
    (this.otherAllowances || 0);
  next();
});

module.exports = mongoose.model('SalaryStructure', salaryStructureSchema);
