/**
 * Professional Tax (PT), Gratuity, and Income Tax (TDS) Calculation & Estimator Services
 * Configurable state slabs, Payment of Gratuity Act formula, and New Tax Regime TDS estimator.
 */

const { getStatutoryConfig } = require('../config/statutoryRules');
const { roundNearest, round2 } = require('../utils/mathUtils');

/**
 * Calculates Professional Tax based on state-specific salary slabs.
 *
 * @param {number} monthlyGrossSalary - Total earned gross salary for the month
 * @param {string} [state='DEFAULT'] - State code (e.g. 'MAHARASHTRA', 'KARNATAKA', 'ANDHRA_PRADESH', 'TELANGANA', 'TAMIL_NADU', 'DEFAULT')
 * @param {Object} [options={}] - Options (e.g. month: 2 for February special slab, gender: 'MALE'|'FEMALE')
 * @returns {Object} Professional Tax calculation result
 */
function calculateProfessionalTax(monthlyGrossSalary, state = 'DEFAULT', options = {}) {
  const {
    month = new Date().getMonth() + 1, // 1 to 12
    gender = 'MALE',
    customConfig = {}
  } = options;

  const config = getStatutoryConfig(customConfig).pt;
  const gross = Math.max(0, Number(monthlyGrossSalary) || 0);
  const normalizedState = (state || 'DEFAULT').toUpperCase();
  const slabs = config.slabs[normalizedState] || config.slabs.DEFAULT;

  let ptAmount = 0;
  let matchingSlab = null;
  const selectedGender = (gender && gender !== 'ALL' ? gender : 'MALE').toUpperCase();

  for (const slab of slabs) {
    // If slab is gender-specific, match selected gender
    if (slab.gender && slab.gender !== 'ALL' && slab.gender !== selectedGender) {
      continue;
    }

    if (gross >= slab.minGross && gross <= slab.maxGross) {
      matchingSlab = slab;
      // Check if special month override exists (e.g. Maharashtra February ₹300)
      if (slab.specialMonthAmount && slab.specialMonthAmount.month === month) {
        ptAmount = slab.specialMonthAmount.amount;
      } else {
        ptAmount = slab.amount;
      }
      break;
    }
  }

  return {
    state: normalizedState,
    monthlyGrossSalary: gross,
    professionalTax: ptAmount,
    monthApplied: month,
    matchedSlab: matchingSlab
      ? { min: matchingSlab.minGross, max: matchingSlab.maxGross, slabAmount: matchingSlab.amount }
      : null
  };
}

/**
 * Estimates Gratuity payout under Payment of Gratuity Act, 1972.
 * Formula: (15 * (Last Drawn Basic + DA) * Completed Years) / 26
 *
 * Assumptions:
 * 1. Minimum continuous service of 5 years is legally required for eligibility (unless death/disability).
 * 2. Capped at statutory maximum of ₹20,00,000.
 * 3. 26 working days considered per month as per statute.
 *
 * @param {number} lastDrawnBasic - Last drawn basic salary
 * @param {number} lastDrawnDa - Last drawn Dearness Allowance (default 0)
 * @param {number} completedYears - Completed years of continuous service
 * @param {Object} [options={}] - Custom options and overrides
 * @returns {Object} Gratuity estimate and assumptions
 */
function estimateGratuity(lastDrawnBasic, lastDrawnDa = 0, completedYears = 0, options = {}) {
  const {
    isEligibleOverride = null,
    customConfig = {}
  } = options;

  const config = getStatutoryConfig(customConfig).gratuity;
  const basic = Math.max(0, Number(lastDrawnBasic) || 0);
  const da = Math.max(0, Number(lastDrawnDa) || 0);
  const years = Math.max(0, Number(completedYears) || 0);

  const isEligible = isEligibleOverride !== null
    ? Boolean(isEligibleOverride)
    : years >= config.minContinuousServiceYears;

  if (!isEligible || basic <= 0 || years === 0) {
    return {
      isEligible: false,
      completedYears: years,
      minContinuousServiceYears: config.minContinuousServiceYears,
      gratuityAmount: 0,
      assumptions: [
        `Under ${config.act}, minimum ${config.minContinuousServiceYears} continuous years of service required. Current service: ${years} years.`
      ]
    };
  }

  const wages = basic + da;
  const rawGratuity = (config.tenureDaysMultiplier * wages * years) / config.workingDaysInMonth;
  const cappedGratuity = Math.min(rawGratuity, config.maxTaxFreeLimit);
  const finalGratuity = roundNearest(cappedGratuity);

  return {
    isEligible: true,
    completedYears: years,
    wagesConsidered: wages,
    formula: `(${config.tenureDaysMultiplier} * (${basic} + ${da}) * ${years}) / ${config.workingDaysInMonth}`,
    rawCalculatedAmount: round2(rawGratuity),
    maxTaxFreeLimit: config.maxTaxFreeLimit,
    isCappedAtLimit: rawGratuity > config.maxTaxFreeLimit,
    gratuityAmount: finalGratuity,
    assumptions: [
      `Governed by ${config.act}.`,
      `Computed as: (15 days * Last Drawn Basic + DA * ${years} years) / 26 days.`,
      `Statutory tax-free cap of ₹${config.maxTaxFreeLimit.toLocaleString('en-IN')} applied.`
    ]
  };
}

/**
 * Estimates monthly TDS withholding based on New Tax Regime (Section 115BAC).
 *
 * Assumptions:
 * 1. Annualized Gross = Monthly Gross * 12 + other income.
 * 2. Standard deduction of ₹75,000 applies under Section 115BAC (FY 2024-25/25-26).
 * 3. Section 87A rebate gives nil tax liability if taxable income <= ₹7,00,000.
 * 4. Health and Education Cess of 4% added to tax.
 * 5. Monthly TDS = Annual Tax / 12.
 *
 * @param {number} monthlyGross - Monthly gross salary
 * @param {number} [otherAnnualIncome=0] - Additional taxable income / bonus projected annually
 * @param {Object} [options={}] - Options and config overrides
 * @returns {Object} Estimated monthly TDS withholding and tax bracket breakdown
 */
function estimateTds(monthlyGross, otherAnnualIncome = 0, options = {}) {
  const {
    customConfig = {}
  } = options;

  const config = getStatutoryConfig(customConfig).tds;
  const monthly = Math.max(0, Number(monthlyGross) || 0);
  const otherIncome = Math.max(0, Number(otherAnnualIncome) || 0);

  const projectedAnnualGross = round2((monthly * 12) + otherIncome);
  const taxableIncome = Math.max(0, projectedAnnualGross - config.standardDeduction);

  // Section 87A rebate check: If net taxable income <= 7,00,000, tax is zero
  if (taxableIncome <= config.rebateLimit87A) {
    return {
      monthlyTdsEstimate: 0,
      projectedAnnualGross,
      standardDeduction: config.standardDeduction,
      netTaxableIncome: taxableIncome,
      annualTaxBeforeCess: 0,
      annualCess: 0,
      totalAnnualTax: 0,
      regime: config.regime,
      assumptions: [
        'New Tax Regime (Section 115BAC) applied.',
        `Standard deduction of ₹${config.standardDeduction} deducted.`,
        `Taxable income (₹${taxableIncome}) is within Section 87A rebate limit (₹${config.rebateLimit87A}); net tax is ₹0.`
      ]
    };
  }

  // Calculate slab-wise tax
  let tax = 0;
  for (const slab of config.slabs) {
    if (taxableIncome > slab.min) {
      const taxableInSlab = Math.min(taxableIncome, slab.max) - slab.min;
      tax += taxableInSlab * slab.rate;
    }
  }

  const annualCess = round2(tax * config.cessRate);
  const totalAnnualTax = round2(tax + annualCess);
  const monthlyTds = roundNearest(totalAnnualTax / 12);

  return {
    monthlyTdsEstimate: monthlyTds,
    projectedAnnualGross,
    standardDeduction: config.standardDeduction,
    netTaxableIncome: taxableIncome,
    annualTaxBeforeCess: round2(tax),
    annualCess,
    totalAnnualTax,
    regime: config.regime,
    assumptions: [
      'New Tax Regime (Section 115BAC) estimator.',
      `Standard deduction of ₹${config.standardDeduction} applied.`,
      `Health & Education Cess of ${(config.cessRate * 100)}% applied.`,
      'Monthly TDS is estimated as Total Annual Tax divided by 12.'
    ]
  };
}

module.exports = {
  calculateProfessionalTax,
  estimateGratuity,
  estimateTds
};
