/**
 * Contribution Rule Mongoose Model
 * Manages versioned statutory compliance rules for PF, EPS, EDLI, ESIC, PT,
 * wage ceilings, eligibility limits, and effective date periods.
 */

const mongoose = require('mongoose');

const contributionRuleSchema = new mongoose.Schema(
  {
    ruleCode: {
      type: String,
      required: [true, 'Rule code is required (e.g. STATUTORY_V1).'],
      trim: true,
      uppercase: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Rule name is required.'],
      default: 'Statutory Contribution Rule',
      trim: true
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1
    },
    effectiveFrom: {
      type: Date,
      required: [true, 'effectiveFrom date is required.'],
      index: true
    },
    effectiveTo: {
      type: Date,
      default: null, // null denotes currently open-ended and ongoing
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    verifiedByAdmin: {
      type: Boolean,
      default: true
    },

    // EPFO Statutory Rules
    pf: {
      employeeRate: {
        type: Number,
        required: true,
        default: 0.12,
        min: 0,
        max: 1
      },
      employerTotalRate: {
        type: Number,
        required: true,
        default: 0.12,
        min: 0,
        max: 1
      },
      employerEpfRate: {
        type: Number,
        required: true,
        default: 0.0367,
        min: 0,
        max: 1
      },
      employerEpsRate: {
        type: Number,
        required: true,
        default: 0.0833,
        min: 0,
        max: 1
      },
      wageCeiling: {
        type: Number,
        required: true,
        default: 15000,
        min: 0
      },
      epsMaxCap: {
        type: Number,
        required: true,
        default: 1250,
        min: 0
      },
      edliRate: {
        type: Number,
        required: true,
        default: 0.005,
        min: 0,
        max: 1
      },
      edliWageCeiling: {
        type: Number,
        required: true,
        default: 15000,
        min: 0
      },
      adminChargesRate: {
        type: Number,
        required: true,
        default: 0.005,
        min: 0,
        max: 1
      },
      roundingMethod: {
        type: String,
        default: 'nearest_integer',
        enum: ['nearest_integer', 'round_up', 'decimal_2']
      },
      allowVoluntaryExcessPf: {
        type: Boolean,
        default: true
      }
    },

    // ESIC Statutory Rules
    esic: {
      wageLimit: {
        type: Number,
        required: true,
        default: 21000,
        min: 0
      },
      disabilityWageLimit: {
        type: Number,
        required: true,
        default: 25000,
        min: 0
      },
      employeeRate: {
        type: Number,
        required: true,
        default: 0.0075,
        min: 0,
        max: 1
      },
      employerRate: {
        type: Number,
        required: true,
        default: 0.0325,
        min: 0,
        max: 1
      },
      dailyWageExemptionLimit: {
        type: Number,
        required: true,
        default: 176,
        min: 0
      },
      roundingMethod: {
        type: String,
        default: 'higher_rupee',
        enum: ['higher_rupee', 'nearest_integer', 'decimal_2']
      }
    },

    // Professional Tax Slabs
    pt: {
      defaultState: {
        type: String,
        default: 'DEFAULT'
      },
      slabs: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    },

    // Gratuity Rules
    gratuity: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // TDS Slabs
    tds: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    remarks: {
      type: String,
      default: ''
    },
    createdBy: {
      type: String,
      default: 'System Administrator'
    },
    updatedBy: {
      type: String,
      default: 'System Administrator'
    }
  },
  {
    timestamps: true
  }
);

// Compound index on ruleCode and version
contributionRuleSchema.index({ ruleCode: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('ContributionRule', contributionRuleSchema);
