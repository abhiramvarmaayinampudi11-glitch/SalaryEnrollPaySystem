/**
 * Employees' State Insurance (ESIC) Calculation Engine
 * Pure financial calculation adhering to ESIC Act statutory rules.
 * Rates, wage limits, and daily wage exemption rules are fully configurable.
 */

const { getStatutoryConfig } = require('../config/statutoryRules');
const { roundUp, round2, roundNearest } = require('../utils/mathUtils');

/**
 * Calculates Employee & Employer ESIC contributions.
 *
 * Statutory Rules:
 * - Wage Limit: Gross Wages <= ₹21,000/month (or ₹25,000 for disability).
 * - Employee Contribution: 0.75% of gross wages.
 * - Employer Contribution: 3.25% of gross wages.
 * - Daily Wage Exemption: If average daily wage <= ₹176, employee is exempt (0%),
 *   while employer still pays 3.25%.
 * - Rounding: ESIC Act specifies fraction of a rupee is rounded up to next higher rupee.
 *
 * @param {number} grossWages - Monthly gross wages earned
 * @param {number} [workingDays=30] - Total working / calendar days in period
 * @param {number} [presentDays=30] - Days worked (used for average daily wage calculation)
 * @param {Object} [options={}] - Options and overrides
 * @param {boolean} [options.hasDisability=false] - If true, higher ₹25,000 threshold applies
 * @param {boolean|null} [options.isEsicEligible=null] - Explicit eligibility flag; null auto-evaluates
 * @param {Object} [options.customConfig] - Overrides for statutory rules
 * @returns {Object} Comprehensive ESIC calculation breakdown
 */
function calculateEsic(grossWages, workingDays = 30, presentDays = 30, options = {}) {
  const {
    hasDisability = false,
    isEsicEligible = null,
    customConfig = {}
  } = options;

  const config = getStatutoryConfig(customConfig).esic;
  const wages = Math.max(0, Number(grossWages) || 0);
  const wDays = Math.max(1, Number(workingDays) || 30);
  const pDays = Math.max(0, Number(presentDays) || 0);

  // 1. Determine wage limit based on disability status
  const wageCeiling = hasDisability ? config.disabilityWageLimit : config.wageLimit;

  // 2. Evaluate eligibility (if not explicitly forced)
  const eligible = isEsicEligible !== null
    ? Boolean(isEsicEligible)
    : (wages > 0 && wages <= wageCeiling);

  if (!eligible || wages <= 0) {
    return {
      isEsicEligible: false,
      grossWages: wages,
      wageCeiling,
      hasDisability,
      dailyWage: 0,
      isExemptFromEmployeeShare: false,
      employeeDeduction: {
        esic: 0,
        total: 0
      },
      employerContribution: {
        esic: 0,
        total: 0
      },
      complianceNotes: [
        wages > wageCeiling
          ? `Gross wage (₹${wages.toFixed(2)}) exceeds ESIC statutory limit of ₹${wageCeiling}. ESIC not applicable.`
          : 'Employee not eligible or zero gross wages.'
      ]
    };
  }

  // 3. Average Daily Wage calculation for exemption test
  const effectiveDays = pDays > 0 ? pDays : wDays;
  const dailyWage = round2(wages / effectiveDays);
  const isExemptFromEmployeeShare = dailyWage <= config.dailyWageExemptionLimit;

  // Helper rounding function per statutory configuration
  const applyRounding = (val) => {
    if (config.roundingMethod === 'higher_rupee') {
      return roundUp(val);
    }
    if (config.roundingMethod === 'nearest_integer') {
      return roundNearest(val);
    }
    return round2(val);
  };

  // 4. Employee Share: 0.75% (or 0 if daily wage <= 176)
  const rawEmployeeShare = wages * config.employeeRate;
  const employeeEsic = isExemptFromEmployeeShare ? 0 : applyRounding(rawEmployeeShare);

  // 5. Employer Share: 3.25% (Employer pays even if employee is exempt!)
  const rawEmployerShare = wages * config.employerRate;
  const employerEsic = applyRounding(rawEmployerShare);

  return {
    isEsicEligible: true,
    grossWages: wages,
    wageCeiling,
    hasDisability,
    dailyWage,
    isExemptFromEmployeeShare,
    ratesApplied: {
      employeeRate: config.employeeRate,
      employerRate: config.employerRate,
      dailyWageExemptionLimit: config.dailyWageExemptionLimit,
      roundingMethod: config.roundingMethod
    },
    // Explicit separation: Employee deduction affects take-home pay
    employeeDeduction: {
      esic: employeeEsic,
      total: employeeEsic
    },
    // Employer contribution is NEVER deducted from employee net pay
    employerContribution: {
      esic: employerEsic,
      total: employerEsic
    },
    complianceNotes: [
      `Gross wages of ₹${wages.toFixed(2)} is within ESIC limit of ₹${wageCeiling}.`,
      isExemptFromEmployeeShare
        ? `Average daily wage (₹${dailyWage.toFixed(2)}) is <= ₹${config.dailyWageExemptionLimit}. Employee contribution is EXEMPT, employer pays ₹${employerEsic}.`
        : `Employee ESIC (0.75%): ₹${employeeEsic}, Employer ESIC (3.25%): ₹${employerEsic}.`
    ]
  };
}

module.exports = {
  calculateEsic
};
