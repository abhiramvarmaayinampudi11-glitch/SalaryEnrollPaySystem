/**
 * MonthlyPayroll Mongoose Model
 * Persists finalized and draft monthly payroll breakdowns, attendance records,
 * itemized earnings, deductions, net salary, employer contributions, and statutory rule snapshots.
 * Enforces period uniqueness via compound index on { employeeId, month, year }.
 */

const mongoose = require('mongoose');

const monthlyPayrollSchema = new mongoose.Schema(
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
    employeeName: {
      type: String,
      default: ''
    },
    department: {
      type: String,
      default: ''
    },
    designation: {
      type: String,
      default: ''
    },
    month: {
      type: Number,
      required: [true, 'Payroll month is required (1-12).'],
      min: 1,
      max: 12
    },
    year: {
      type: Number,
      required: [true, 'Payroll year is required.'],
      min: 2000
    },

    // Attendance Metrics
    attendance: {
      workingDays: { type: Number, default: 30 },
      paidDays: { type: Number, default: 30 },
      ncpDays: { type: Number, default: 0 },
      prorationRatio: { type: Number, default: 1 },
      overtimeHours: { type: Number, default: 0 },
      overtimeHourlyRate: { type: Number, default: 0 },
      overtimeAmount: { type: Number, default: 0 },
      doubleNcpDeductionPrevented: { type: Boolean, default: true }
    },

    // Salary Comparison
    salaryComparison: {
      nominalMonthlySalary: { type: Number, default: 0 },
      attendancePayableSalary: { type: Number, default: 0 },
      ncpAdjustmentAmount: { type: Number, default: 0 }
    },

    // Earnings Breakdown
    earnings: {
      basic: { type: Number, default: 0 },
      da: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      conveyance: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      otherAllowances: { type: Number, default: 0 },
      totalAllowances: { type: Number, default: 0 },
      overtimeAmount: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      grossEarnings: { type: Number, required: true },
      grossSalary: { type: Number, default: 0 }
    },

    // Deductions Breakdown
    deductions: {
      employeePf: { type: Number, default: 0 },
      employeeEsic: { type: Number, default: 0 },
      professionalTax: { type: Number, default: 0 },
      tds: { type: Number, default: 0 },
      advanceRecovery: { type: Number, default: 0 },
      otherDeductions: { type: Number, default: 0 },
      totalDeductions: { type: Number, required: true }
    },

    // Net Take-Home Salary
    netSalary: {
      type: Number,
      required: [true, 'Net salary is required.'],
      min: 0
    },

    // Employer Contributions (CTC Costs)
    employerContributions: {
      pf: {
        epf: { type: Number, default: 0 },
        eps: { type: Number, default: 0 },
        edli: { type: Number, default: 0 },
        adminCharges: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      },
      esic: {
        employerEsic: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      },
      totalEmployerContributions: { type: Number, default: 0 },
      totalEmployerContribution: { type: Number, default: 0 }
    },

    // Cost to Company
    costToCompany: {
      monthlyCtc: { type: Number, default: 0 },
      annualizedCtc: { type: Number, default: 0 }
    },

    // Detailed Statutory Calculation Output
    statutoryDetails: {
      type: Object,
      default: {}
    },

    // Immutable Rule Snapshot applied for this payroll run
    statutoryRuleSnapshot: {
      type: Object,
      required: true
    },

    // Status: Recalculation allowed ONLY in DRAFT status
    status: {
      type: String,
      enum: ['DRAFT', 'PROCESSED', 'FINALIZED', 'PAID'],
      default: 'DRAFT',
      index: true
    },

    version: {
      type: Number,
      default: 1
    },

    recalculatedAt: {
      type: Date,
      default: null
    },

    paymentDate: {
      type: Date,
      default: null
    },

    remarks: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound Unique Index: Prevents duplicate payroll records for the same employee in the same period
monthlyPayrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyPayroll', monthlyPayrollSchema);
