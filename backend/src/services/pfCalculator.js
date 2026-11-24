/**
 * Employees' Provident Fund (EPFO / PF) Calculation Engine
 * Pure financial calculation adhering to EPFO statutory guidelines.
 * All rates, ceilings, and rules are fully configurable.
 */

const { getStatutoryConfig } = require('../config/statutoryRules');
const { roundNearest, round2 } = require('../utils/mathUtils');

/**
 * Calculates Employee & Employer PF contributions based on statutory wages.
 *
 * Statutory Breakdown:
 * - Employee EPF: 12% of PF Wages (capped at wage ceiling or uncapped if opted)
 * - Employer EPS (Pension): 8.33% of PF Wages (strictly capped at wage ceiling, max ₹1,250)
 * - Employer EPF: Balance of 12% employer share (Total 12% - EPS)
 * - Employer EDLI: 0.5% of PF Wages (capped at ₹15,000)
 * - Employer Admin Charges: 0.5% of PF Wages
 *
 * @param {number} earnedBasic - Prorated earned basic salary
 * @param {number} earnedDa - Prorated earned Dearness Allowance (default 0)
 * @param {Object} [options={}] - Calculation and compliance options
 * @param {boolean} [options.isPfEligible=true] - Whether employee is enrolled in PF
 * @param {boolean} [options.capAtWageCeiling=true] - If true, cap EPF calculation wage at ₹15,000
 * @param {Object} [options.customConfig] - Overrides for statutory rules
 * @returns {Object} Comprehensive PF calculation breakdown
 */
function calculatePf(earnedBasic, earnedDa = 0, options = {}) {
  const {
    isPfEligible = true,
    capAtWageCeiling = true,
    customConfig = {}
  } = options;

  const config = getStatutoryConfig(customConfig).pf;

  // Clean numerical inputs
  const basic = Math.max(0, Number(earnedBasic) || 0);
  const da = Math.max(0, Number(earnedDa) || 0);
  const pfWages = round2(basic + da);

  // Ineligible employee: zero contributions
  if (!isPfEligible || pfWages <= 0) {
    return {
      isPfEligible: false,
      pfWages: 0,
      pfWageSubjectToEpf: 0,
      epsWages: 0,
      employeeDeduction: {
        epf: 0,
        total: 0
      },
      employerContribution: {
        epf: 0,
        eps: 0,
        edli: 0,
        adminCharges: 0,
        total: 0
      },
      complianceNotes: ['Employee not enrolled in PF or zero PF wages.']
    };
  }

  // 1. Determine wage subject to Employee PF
  // If capAtWageCeiling is true, wage is capped at statutory limit (₹15,000)
  const pfWageSubjectToEpf = capAtWageCeiling
    ? Math.min(pfWages, config.wageCeiling)
    : pfWages;

  // 2. Employee Contribution: 12% of applicable PF wages
  const rawEmployeeEpf = pfWageSubjectToEpf * config.employeeRate;
  const employeeEpf = config.roundingMethod === 'nearest_integer'
    ? roundNearest(rawEmployeeEpf)
    : round2(rawEmployeeEpf);

  // 3. Employer EPS (Pension Scheme): 8.33% strictly capped at statutory ceiling (₹15,000)
  const epsWages = Math.min(pfWages, config.wageCeiling);
  const rawEmployerEps = Math.min(epsWages * config.employerEpsRate, config.epsMaxCap);
  const employerEps = config.roundingMethod === 'nearest_integer'
    ? roundNearest(rawEmployerEps)
    : round2(rawEmployerEps);

  // 4. Employer EPF: Total 12% employer share minus EPS
  const totalEmployer12Percent = config.roundingMethod === 'nearest_integer'
    ? roundNearest(pfWageSubjectToEpf * config.employerTotalRate)
    : round2(pfWageSubjectToEpf * config.employerTotalRate);
  
  const employerEpf = Math.max(0, totalEmployer12Percent - employerEps);

  // 5. Employer EDLI: 0.5% capped at EDLI wage ceiling (₹15,000)
  const edliWages = Math.min(pfWages, config.edliWageCeiling);
  const rawEdli = edliWages * config.edliRate;
  const edli = config.roundingMethod === 'nearest_integer'
    ? roundNearest(rawEdli)
    : round2(rawEdli);

  // 6. Employer Admin Charges: 0.5% of applicable PF wages
  const rawAdmin = pfWageSubjectToEpf * config.adminChargesRate;
  const adminCharges = config.roundingMethod === 'nearest_integer'
    ? roundNearest(rawAdmin)
    : round2(rawAdmin);

  // Total employer contribution (EPF + EPS + EDLI + Admin)
  const totalEmployerContribution = employerEpf + employerEps + edli + adminCharges;

  return {
    isPfEligible: true,
    pfWages,
    pfWageSubjectToEpf,
    epsWages,
    capAtWageCeiling,
    ratesApplied: {
      employeeRate: config.employeeRate,
      employerEpfRate: config.employerEpfRate,
      employerEpsRate: config.employerEpsRate,
      edliRate: config.edliRate,
      adminChargesRate: config.adminChargesRate,
      wageCeiling: config.wageCeiling,
      epsMaxCap: config.epsMaxCap
    },
    // Explicit separation: Only employeeDeduction affects net take-home salary
    employeeDeduction: {
      epf: employeeEpf,
      total: employeeEpf
    },
    // Employer contribution is a company CTC cost and NEVER deducted from employee salary
    employerContribution: {
      epf: employerEpf,
      eps: employerEps,
      edli,
      adminCharges,
      total: totalEmployerContribution
    },
    complianceNotes: [
      `PF wages: ₹${pfWages.toFixed(2)}${capAtWageCeiling && pfWages > config.wageCeiling ? ` (capped at ₹${config.wageCeiling} for deduction)` : ''}.`,
      `Employer contribution of ₹${totalEmployerContribution} is payable by employer, not deducted from employee pay.`
    ]
  };
}

module.exports = {
  calculatePf
};
