/**
 * Centralized Indian Statutory Compliance Rules and Legal Defaults
 * Configurable rules for EPF, ESIC, Professional Tax, Gratuity, and TDS.
 * NEVER hard-coded inside calculation functions.
 */

const STATUTORY_RULES = {
  // Employees' Provident Fund (EPFO) Rules
  pf: {
    effectiveDate: '2014-09-01',
    wageCeiling: 15000, // INR 15,000/month statutory wage ceiling
    employeeRate: 0.12, // 12% employee contribution to EPF
    employerTotalRate: 0.12, // 12% total employer contribution
    employerEpsRate: 0.0833, // 8.33% employer contribution to EPS
    employerEpfRate: 0.0367, // 3.67% employer contribution to EPF (12% - 8.33%)
    epsMaxCap: 1250, // INR 1,250 max cap on EPS (8.33% of 15,000 = 1249.50 -> 1250)
    edliRate: 0.005, // 0.5% Employees' Deposit Linked Insurance
    edliWageCeiling: 15000, // EDLI capped at 15,000 wage
    adminChargesRate: 0.005, // 0.5% EPF administration charge
    adminChargesMin: 500, // Statutory minimum admin fee per month
    roundingMethod: 'nearest_integer', // EPFO rounds to nearest integer rupee
    allowVoluntaryExcessPf: true // Employee can contribute on actual wages beyond 15k
  },

  // Employees' State Insurance (ESIC) Rules
  esic: {
    effectiveDate: '2019-07-01',
    wageLimit: 21000, // INR 21,000/month gross wage ceiling for coverage
    disabilityWageLimit: 25000, // INR 25,000/month for employees with disability
    employeeRate: 0.0075, // 0.75% of gross wages
    employerRate: 0.0325, // 3.25% of gross wages
    dailyWageExemptionLimit: 176, // Daily wage <= 176 is exempt from employee share
    roundingMethod: 'higher_rupee' // ESIC rule rounds fraction to next higher rupee
  },

  // Professional Tax (PT) Slabs by State
  pt: {
    defaultState: 'DEFAULT',
    slabs: {
      MAHARASHTRA: [
        { minGross: 0, maxGross: 7500, amount: 0, gender: 'MALE' },
        { minGross: 7501, maxGross: 10000, amount: 175, gender: 'MALE' },
        { minGross: 10001, maxGross: Infinity, amount: 200, specialMonthAmount: { month: 2, amount: 300 }, gender: 'MALE' },
        { minGross: 0, maxGross: 25000, amount: 0, gender: 'FEMALE' },
        { minGross: 25001, maxGross: Infinity, amount: 200, specialMonthAmount: { month: 2, amount: 300 }, gender: 'FEMALE' }
      ],
      KARNATAKA: [
        { minGross: 0, maxGross: 14999, amount: 0 },
        { minGross: 15000, maxGross: Infinity, amount: 200 }
      ],
      ANDHRA_PRADESH: [
        { minGross: 0, maxGross: 15000, amount: 0 },
        { minGross: 15001, maxGross: 20000, amount: 150 },
        { minGross: 20001, maxGross: Infinity, amount: 200 }
      ],
      TELANGANA: [
        { minGross: 0, maxGross: 15000, amount: 0 },
        { minGross: 15001, maxGross: 20000, amount: 150 },
        { minGross: 20001, maxGross: Infinity, amount: 200 }
      ],
      TAMIL_NADU: [
        { minGross: 0, maxGross: 3500, amount: 0 },
        { minGross: 3501, maxGross: 5000, amount: 21 },
        { minGross: 5001, maxGross: 7500, amount: 42 },
        { minGross: 7501, maxGross: 10000, amount: 84 },
        { minGross: 10001, maxGross: 12500, amount: 126 },
        { minGross: 12501, maxGross: Infinity, amount: 175 }
      ],
      DEFAULT: [
        { minGross: 0, maxGross: 15000, amount: 0 },
        { minGross: 15001, maxGross: 20000, amount: 150 },
        { minGross: 20001, maxGross: Infinity, amount: 200 }
      ]
    }
  },

  // Payment of Gratuity Act, 1972 Estimator Defaults
  gratuity: {
    act: 'Payment of Gratuity Act, 1972',
    workingDaysInMonth: 26, // 26 working days in a month formula divisor
    tenureDaysMultiplier: 15, // 15 days of last drawn salary for each year
    minContinuousServiceYears: 5, // Minimum 5 years continuous service
    maxTaxFreeLimit: 2000000, // INR 20 Lakhs statutory limit
    roundingMethod: 'nearest_integer'
  },

  // Income Tax (TDS) Withholding Estimator (New Tax Regime FY 2024-25 / FY 2025-26 u/s 115BAC)
  tds: {
    regime: 'NEW',
    standardDeduction: 75000, // Enhanced standard deduction
    rebateLimit87A: 700000, // Tax liability nil if net income <= 7,00,000 (effective up to 7,75,000 with std deduction)
    cessRate: 0.04, // 4% Health and Education Cess
    slabs: [
      { min: 0, max: 300000, rate: 0.00 },
      { min: 300001, max: 700000, rate: 0.05 },
      { min: 700001, max: 1000000, rate: 0.10 },
      { min: 1000001, max: 1200000, rate: 0.15 },
      { min: 1200001, max: 1500000, rate: 0.20 },
      { min: 1500001, max: Infinity, rate: 0.30 }
    ]
  }
};

/**
 * Returns a cloned configuration merged with any custom organizational overrides.
 * @param {Object} customOverrides
 * @returns {Object}
 */
function getStatutoryConfig(customOverrides = {}) {
  return {
    pf: { ...STATUTORY_RULES.pf, ...(customOverrides.pf || {}) },
    esic: { ...STATUTORY_RULES.esic, ...(customOverrides.esic || {}) },
    pt: {
      ...STATUTORY_RULES.pt,
      ...(customOverrides.pt || {}),
      slabs: { ...STATUTORY_RULES.pt.slabs, ...(customOverrides.pt?.slabs || {}) }
    },
    gratuity: { ...STATUTORY_RULES.gratuity, ...(customOverrides.gratuity || {}) },
    tds: { ...STATUTORY_RULES.tds, ...(customOverrides.tds || {}) }
  };
}

module.exports = {
  STATUTORY_RULES,
  getStatutoryConfig
};
