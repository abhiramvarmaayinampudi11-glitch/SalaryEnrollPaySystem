/**
 * Reusable Monthly Salary Calculation Engine
 * 
 * Formulas:
 * - Gross = Basic Pay (payable) + Allowances (payable) + OT + Bonus
 * - Total Deductions = Employee PF + Employee ESIC + Advance Recovery + Other Deductions (+ Statutory PT/TDS)
 * - Net = Gross - Total Deductions
 * 
 * Features:
 * - Distinguishes nominal Monthly Salary from attendance-based Payable Salary.
 * - Prevents double deduction of NCP (Non-Contributing Period / LOP).
 * - Configurable proration methods (CALENDAR_DAYS, FIXED_30, ACTUAL_WORKING_DAYS).
 * - Decimal-safe money calculations and consistent statutory rounding.
 * - Strict separation of Employer contributions (CTC) from Employee Net Pay.
 */

const { calculatePf } = require('./pfCalculator');
const { calculateEsic } = require('./esicCalculator');
const { calculateProfessionalTax, estimateTds } = require('./ptAndTaxCalculator');
const { round2, safeSum } = require('../utils/mathUtils');

/**
 * Calculates complete monthly salary breakdown for an employee.
 *
 * @param {Object} params
 * @param {string} [params.employeeId='EMP'] - Employee identifier
 * @param {number} [params.month=1] - Payroll month (1-12)
 * @param {number} [params.year=2026] - Payroll year
 * @param {number} [params.workingDays=30] - Total working or calendar days in month
 * @param {number} [params.paidDays] - Total paid days (present + paid leave)
 * @param {number} [params.ncpDays=0] - Non-Contributing Period / unpaid leave days (LOP)
 * @param {number} [params.monthlyBasicSalary=0] - Nominal fixed basic salary
 * @param {Object|number} [params.allowances={}] - Fixed allowances { hra, da, conveyance, specialAllowance, otherAllowances } or flat number
 * @param {number} [params.overtimeHours=0] - Total overtime hours worked
 * @param {number} [params.overtimeAmount=0] - Explicit overtime pay amount
 * @param {number} [params.overtimeHourlyRate=0] - Hourly overtime rate (used if overtimeAmount is 0)
 * @param {number} [params.bonus=0] - Performance bonus, ex-gratia, or festival incentive
 * @param {number} [params.advanceRecovery=0] - Salary advance or loan recovery deduction
 * @param {number} [params.otherDeductions=0] - Other non-statutory deductions (canteen, transport, etc.)
 * @param {number|null} [params.pfWages=null] - Optional manual override for PF wages
 * @param {number|null} [params.esicWages=null] - Optional manual override for ESIC wages
 * @param {string} [params.prorationMethod='CALENDAR_DAYS'] - Proration mode: 'CALENDAR_DAYS' | 'FIXED_30' | 'ACTUAL_WORKING_DAYS'
 * @param {Object} [params.statutoryOptions={}] - Statutory compliance options
 * @param {Object} [params.configOverrides={}] - Custom statutory rule overrides
 * @returns {Object} Granular monthly salary calculation breakdown
 */
function calculateMonthlySalary({
  employeeId = 'EMP',
  month = new Date().getMonth() + 1,
  year = new Date().getFullYear(),
  workingDays = 30,
  paidDays,
  ncpDays = 0,
  monthlyBasicSalary = 0,
  allowances = {},
  overtimeHours = 0,
  overtimeAmount = 0,
  overtimeHourlyRate = 0,
  bonus = 0,
  advanceRecovery = 0,
  otherDeductions = 0,
  pfWages = null,
  esicWages = null,
  prorationMethod = 'CALENDAR_DAYS',
  statutoryOptions = {},
  configOverrides = {}
}) {
  // 1. Sanitize Base Salary and Allowances
  const basicNominal = Math.max(0, Number(monthlyBasicSalary) || 0);

  let allowancesNominal = {
    hra: 0,
    da: 0,
    conveyance: 0,
    specialAllowance: 0,
    otherAllowances: 0
  };

  if (typeof allowances === 'number') {
    allowancesNominal.specialAllowance = Math.max(0, allowances);
  } else if (typeof allowances === 'object' && allowances !== null) {
    allowancesNominal.hra = Math.max(0, Number(allowances.hra) || 0);
    allowancesNominal.da = Math.max(0, Number(allowances.da) || 0);
    allowancesNominal.conveyance = Math.max(0, Number(allowances.conveyance) || 0);
    allowancesNominal.specialAllowance = Math.max(0, Number(allowances.specialAllowance) || 0);
    allowancesNominal.otherAllowances = Math.max(0, Number(allowances.otherAllowances) || 0);
  }

  const totalNominalAllowances = safeSum(
    allowancesNominal.hra,
    allowancesNominal.da,
    allowancesNominal.conveyance,
    allowancesNominal.specialAllowance,
    allowancesNominal.otherAllowances
  );

  const nominalMonthlySalary = safeSum(basicNominal, totalNominalAllowances);

  // 2. Attendance & NCP (Non-Contributing Period) Resolution
  const totalWorkingDays = Math.max(1, Number(workingDays) || 30);
  const inputNcpDays = Math.max(0, Number(ncpDays) || 0);

  let effectivePaidDays;
  let effectiveNcpDays;

  if (paidDays !== undefined && paidDays !== null) {
    effectivePaidDays = Math.max(0, Math.min(totalWorkingDays, Number(paidDays)));
    effectiveNcpDays = Math.max(0, totalWorkingDays - effectivePaidDays);
  } else {
    effectiveNcpDays = Math.min(totalWorkingDays, inputNcpDays);
    effectivePaidDays = Math.max(0, totalWorkingDays - effectiveNcpDays);
  }

  // 3. Proration Factor Calculation
  let prorationDivisor = totalWorkingDays;
  if (prorationMethod === 'FIXED_30') {
    prorationDivisor = 30;
  }

  const rawProrationRatio = prorationDivisor > 0 ? (effectivePaidDays / prorationDivisor) : 1;
  const prorationRatio = Math.min(1, Math.max(0, round2(rawProrationRatio)));

  // 4. Attendance-based Payable Salary Components
  // Payable Basic and Allowances directly incorporate the NCP proration
  const payableBasic = round2(basicNominal * prorationRatio);
  const payableAllowances = {
    hra: round2(allowancesNominal.hra * prorationRatio),
    da: round2(allowancesNominal.da * prorationRatio),
    conveyance: round2(allowancesNominal.conveyance * prorationRatio),
    specialAllowance: round2(allowancesNominal.specialAllowance * prorationRatio),
    otherAllowances: round2(allowancesNominal.otherAllowances * prorationRatio)
  };

  const totalPayableAllowances = safeSum(
    payableAllowances.hra,
    payableAllowances.da,
    payableAllowances.conveyance,
    payableAllowances.specialAllowance,
    payableAllowances.otherAllowances
  );

  const attendancePayableSalary = safeSum(payableBasic, totalPayableAllowances);

  // 5. NCP Adjustment (Loss of Pay) Amount
  // CRITICAL REQUIREMENT: Double deduction prevention
  // The NCP adjustment amount is tracked for transparent pay-slip itemization,
  // but MUST NOT be added to Total Deductions because it already reduced Nominal Salary to Payable Salary!
  const ncpAdjustmentAmount = round2(nominalMonthlySalary - attendancePayableSalary);

  // 6. Overtime Calculation
  let effectiveOvertimeAmount = 0;
  const otHours = Math.max(0, Number(overtimeHours) || 0);
  const otDirectAmount = Math.max(0, Number(overtimeAmount) || 0);
  const otRate = Math.max(0, Number(overtimeHourlyRate) || 0);

  if (otDirectAmount > 0) {
    effectiveOvertimeAmount = round2(otDirectAmount);
  } else if (otHours > 0 && otRate > 0) {
    effectiveOvertimeAmount = round2(otHours * otRate);
  }

  const effectiveBonus = Math.max(0, Number(bonus) || 0);

  // 7. Gross Earnings Calculation
  // Gross = Basic Pay + Allowances + OT + Bonus
  const grossEarnings = safeSum(
    payableBasic,
    totalPayableAllowances,
    effectiveOvertimeAmount,
    effectiveBonus
  );

  // 8. Statutory Wages Determination
  // Use explicit override if provided, otherwise derive:
  // PF Wages = Payable Basic + Payable DA
  const resolvedPfWages = pfWages !== null && pfWages !== undefined
    ? Math.max(0, Number(pfWages))
    : safeSum(payableBasic, payableAllowances.da);

  // ESIC Wages = Gross Earnings (excluding pure overtime if excluded by rule, or full gross)
  const resolvedEsicWages = esicWages !== null && esicWages !== undefined
    ? Math.max(0, Number(esicWages))
    : grossEarnings;

  // 9. Statutory Calculations
  // A. EPFO / PF
  const pfResult = calculatePf(resolvedPfWages, 0, {
    isPfEligible: statutoryOptions.pfEligible !== undefined ? statutoryOptions.pfEligible : true,
    capAtWageCeiling: statutoryOptions.capPfAtWageCeiling !== undefined ? statutoryOptions.capPfAtWageCeiling : true,
    customConfig: configOverrides
  });

  // B. ESIC
  const esicResult = calculateEsic(resolvedEsicWages, totalWorkingDays, effectivePaidDays, {
    hasDisability: Boolean(statutoryOptions.hasDisability),
    isEsicEligible: statutoryOptions.esicEligible !== undefined ? statutoryOptions.esicEligible : null,
    customConfig: configOverrides
  });

  // C. Professional Tax (PT)
  const ptResult = calculateProfessionalTax(
    grossEarnings,
    statutoryOptions.stateForPt || 'DEFAULT',
    {
      month: statutoryOptions.ptMonth || month,
      gender: statutoryOptions.ptGender || 'MALE',
      customConfig: configOverrides
    }
  );

  // D. Income Tax (TDS) Withholding
  let tdsAmount = 0;
  let tdsDetails = null;
  if (statutoryOptions.customTds !== undefined && statutoryOptions.customTds !== null) {
    tdsAmount = Math.max(0, Number(statutoryOptions.customTds) || 0);
    tdsDetails = { mode: 'CUSTOM_OVERRIDE', monthlyTdsEstimate: tdsAmount };
  } else if (statutoryOptions.enableTds) {
    tdsDetails = estimateTds(grossEarnings, effectiveBonus, { customConfig: configOverrides });
    tdsAmount = tdsDetails.monthlyTdsEstimate;
  }

  // 10. Non-Statutory Voluntary Deductions
  const effectiveAdvanceRecovery = Math.max(0, Number(advanceRecovery) || 0);
  const effectiveOtherDeductions = Math.max(0, Number(otherDeductions) || 0);

  // 11. Total Deductions Calculation
  // Total Deductions = Employee PF + Employee ESIC + Advance Recovery + Other Deductions (+ PT + TDS)
  // NCP is strictly EXCLUDED from Total Deductions to prevent double deduction.
  const employeePf = pfResult.employeeDeduction.total;
  const employeeEsic = esicResult.employeeDeduction.total;
  const professionalTax = ptResult.professionalTax;

  const totalDeductions = safeSum(
    employeePf,
    employeeEsic,
    professionalTax,
    tdsAmount,
    effectiveAdvanceRecovery,
    effectiveOtherDeductions
  );

  // 12. Net Salary Calculation
  // Net = Gross - Total Deductions
  const netSalary = Math.max(0, round2(grossEarnings - totalDeductions));

  // 13. Employer Contributions & CTC (Separated from Employee Net Pay)
  const employerPfTotal = pfResult.employerContribution.total;
  const employerEsicTotal = esicResult.employerContribution.total;
  const totalEmployerContribution = safeSum(employerPfTotal, employerEsicTotal);
  const monthlyCtc = safeSum(grossEarnings, totalEmployerContribution);

  return {
    employeeId,
    period: {
      month: Number(month),
      year: Number(year)
    },
    attendance: {
      workingDays: totalWorkingDays,
      paidDays: effectivePaidDays,
      ncpDays: effectiveNcpDays,
      prorationMethod,
      prorationDivisor,
      prorationRatio,
      doubleNcpDeductionPrevented: true,
      ncpNotes: effectiveNcpDays > 0
        ? `NCP of ${effectiveNcpDays} days reduced nominal salary to attendance payable salary. No duplicate deduction applied.`
        : 'Full attendance recorded. No NCP deduction.'
    },
    salaryComparison: {
      nominalMonthlySalary,
      attendancePayableSalary,
      ncpAdjustmentAmount,
      explanation: 'nominalMonthlySalary is the full monthly CTC/contract wage; attendancePayableSalary is earned pay after NCP proration.'
    },
    earnings: {
      payableBasic,
      payableAllowances: {
        hra: payableAllowances.hra,
        da: payableAllowances.da,
        conveyance: payableAllowances.conveyance,
        specialAllowance: payableAllowances.specialAllowance,
        otherAllowances: payableAllowances.otherAllowances,
        total: totalPayableAllowances
      },
      overtime: {
        hours: otHours,
        hourlyRate: otRate,
        amount: effectiveOvertimeAmount
      },
      bonus: effectiveBonus,
      grossEarnings
    },
    deductions: {
      employeePf,
      employeeEsic,
      professionalTax,
      tds: tdsAmount,
      advanceRecovery: effectiveAdvanceRecovery,
      otherDeductions: effectiveOtherDeductions,
      totalDeductions
    },
    netSalary,
    employerContributions: {
      employerPf: {
        epf: pfResult.employerContribution.epf,
        eps: pfResult.employerContribution.eps,
        edli: pfResult.employerContribution.edli,
        adminCharges: pfResult.employerContribution.adminCharges,
        total: employerPfTotal
      },
      employerEsic: employerEsicTotal,
      totalEmployerContribution
    },
    costToCompany: {
      monthlyCtc,
      annualizedCtc: round2(monthlyCtc * 12)
    },
    statutoryWagesUsed: {
      pfWages: resolvedPfWages,
      esicWages: resolvedEsicWages,
      isPfWagesOverridden: pfWages !== null,
      isEsicWagesOverridden: esicWages !== null
    },
    statutoryDetails: {
      pf: pfResult,
      esic: esicResult,
      pt: ptResult,
      tds: tdsDetails
    },
    auditTrail: {
      grossFormula: 'Gross = Basic Pay + Allowances + OT + Bonus',
      deductionsFormula: 'Total Deductions = Employee PF + Employee ESIC + PT + TDS + Advance Recovery + Other Deductions',
      netFormula: 'Net = Gross - Total Deductions',
      doubleNcpDeductionCheck: 'PASSED (NCP factored directly into payable components, excluded from deductions list)',
      accountingIntegrity: round2(netSalary + totalDeductions) === grossEarnings,
      employerContributionsExcludedFromNetSalary: true,
      calculatedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  calculateMonthlySalary
};
