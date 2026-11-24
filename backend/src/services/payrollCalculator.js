/**
 * Main Payroll Calculation Engine
 * Orchestrates Attendance Proration, Earnings, Allowances, Statutory Deductions,
 * Net Salary, and Employer CTC with 100% decimal-safe financial calculations.
 */

const { calculatePf } = require('./pfCalculator');
const { calculateEsic } = require('./esicCalculator');
const { calculateProfessionalTax, estimateTds } = require('./ptAndTaxCalculator');
const { round2, safeSum } = require('../utils/mathUtils');

/**
 * Calculates complete employee payroll breakdown.
 *
 * @param {Object} params
 * @param {Object} params.salaryStructure - Base structure { basic, da, hra, conveyance, specialAllowance, otherAllowances }
 * @param {Object} [params.attendance] - Attendance details { totalDays, presentDays, paidLeaveDays, unpaidLeaveDays, overtimeHours, overtimeHourlyRate }
 * @param {Object} [params.variablePay] - Additional earnings { bonus, incentives, arrears, otherEarnings }
 * @param {Object} [params.statutoryOptions] - Options { pfEligible, capPfAtWageCeiling, esicEligible, hasDisability, stateForPt, ptMonth, ptGender, enableTds, customTds, customDeductions }
 * @param {Object} [params.configOverrides] - Custom statutory configuration overrides
 * @returns {Object} Comprehensive payroll calculation result
 */
function calculatePayroll({
  salaryStructure = {},
  attendance = {},
  variablePay = {},
  statutoryOptions = {},
  configOverrides = {}
}) {
  // 1. Sanitize and validate Salary Structure inputs
  const structure = {
    basic: Math.max(0, Number(salaryStructure.basic) || 0),
    da: Math.max(0, Number(salaryStructure.da) || 0),
    hra: Math.max(0, Number(salaryStructure.hra) || 0),
    conveyance: Math.max(0, Number(salaryStructure.conveyance) || 0),
    specialAllowance: Math.max(0, Number(salaryStructure.specialAllowance) || 0),
    otherAllowances: Math.max(0, Number(salaryStructure.otherAllowances) || 0)
  };

  const nominalGrossFixed = safeSum(
    structure.basic,
    structure.da,
    structure.hra,
    structure.conveyance,
    structure.specialAllowance,
    structure.otherAllowances
  );

  // 2. Attendance & Loss of Pay (LOP) Proration
  const totalDays = Number(attendance.totalDays) > 0 ? Number(attendance.totalDays) : 30;
  const presentDays = Math.max(0, Number(attendance.presentDays) >= 0 ? Number(attendance.presentDays) : totalDays);
  const paidLeaveDays = Math.max(0, Number(attendance.paidLeaveDays) || 0);
  const unpaidLeaveDays = Math.max(0, Number(attendance.unpaidLeaveDays) || 0);

  // Payable days cannot exceed total working days
  const payableDays = Math.min(totalDays, presentDays + paidLeaveDays);
  const lopDays = Math.max(0, totalDays - payableDays);
  const prorationRatio = totalDays > 0 ? payableDays / totalDays : 1;

  // Prorated fixed components
  const earnedBasic = round2(structure.basic * prorationRatio);
  const earnedDa = round2(structure.da * prorationRatio);
  const earnedHra = round2(structure.hra * prorationRatio);
  const earnedConveyance = round2(structure.conveyance * prorationRatio);
  const earnedSpecialAllowance = round2(structure.specialAllowance * prorationRatio);
  const earnedOtherAllowances = round2(structure.otherAllowances * prorationRatio);

  const lopDeductionAmount = round2(nominalGrossFixed - (earnedBasic + earnedDa + earnedHra + earnedConveyance + earnedSpecialAllowance + earnedOtherAllowances));

  // 3. Overtime Pay & Variable Earnings
  const overtimeHours = Math.max(0, Number(attendance.overtimeHours) || 0);
  const overtimeHourlyRate = Math.max(0, Number(attendance.overtimeHourlyRate) || 0);
  const overtimePay = round2(overtimeHours * overtimeHourlyRate);

  const bonus = Math.max(0, Number(variablePay.bonus) || 0);
  const incentives = Math.max(0, Number(variablePay.incentives) || 0);
  const arrears = Math.max(0, Number(variablePay.arrears) || 0);
  const otherEarnings = Math.max(0, Number(variablePay.otherEarnings) || 0);
  const totalVariablePay = safeSum(bonus, incentives, arrears, otherEarnings);

  // Total Gross Salary Earned
  const grossSalary = safeSum(
    earnedBasic,
    earnedDa,
    earnedHra,
    earnedConveyance,
    earnedSpecialAllowance,
    earnedOtherAllowances,
    overtimePay,
    totalVariablePay
  );

  // 4. Statutory Calculations
  // A. Employees' Provident Fund (EPFO)
  const pfResult = calculatePf(earnedBasic, earnedDa, {
    isPfEligible: statutoryOptions.pfEligible !== undefined ? statutoryOptions.pfEligible : true,
    capAtWageCeiling: statutoryOptions.capPfAtWageCeiling !== undefined ? statutoryOptions.capPfAtWageCeiling : true,
    customConfig: configOverrides
  });

  // B. Employees' State Insurance (ESIC)
  const esicResult = calculateEsic(grossSalary, totalDays, presentDays, {
    hasDisability: Boolean(statutoryOptions.hasDisability),
    isEsicEligible: statutoryOptions.esicEligible !== undefined ? statutoryOptions.esicEligible : null,
    customConfig: configOverrides
  });

  // C. Professional Tax (PT)
  const ptResult = calculateProfessionalTax(
    grossSalary,
    statutoryOptions.stateForPt || 'DEFAULT',
    {
      month: statutoryOptions.ptMonth,
      gender: statutoryOptions.ptGender || 'ALL',
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
    tdsDetails = estimateTds(grossSalary, totalVariablePay, { customConfig: configOverrides });
    tdsAmount = tdsDetails.monthlyTdsEstimate;
  }

  // E. Other custom / voluntary deductions (advance, loan recovery, canteen, etc.)
  const customDeductions = Math.max(0, Number(statutoryOptions.customDeductions) || 0);

  // 5. Total Employee Deductions & Net Salary Calculation
  const employeePfDeduction = pfResult.employeeDeduction.total;
  const employeeEsicDeduction = esicResult.employeeDeduction.total;
  const professionalTaxDeduction = ptResult.professionalTax;

  const totalEmployeeDeductions = safeSum(
    employeePfDeduction,
    employeeEsicDeduction,
    professionalTaxDeduction,
    tdsAmount,
    customDeductions
  );

  // Net Take-Home Salary = Gross Salary - Total Employee Deductions
  // CRITICAL RULE: Employer contributions are NEVER deducted from employee net salary!
  const netSalary = Math.max(0, round2(grossSalary - totalEmployeeDeductions));

  // 6. Employer Contributions & CTC Calculation
  const employerPfTotal = pfResult.employerContribution.total;
  const employerEsicTotal = esicResult.employerContribution.total;
  const totalEmployerContribution = safeSum(employerPfTotal, employerEsicTotal);

  // Monthly Cost to Company (CTC) = Gross Salary + Total Employer Contribution
  const monthlyCtc = safeSum(grossSalary, totalEmployerContribution);

  return {
    attendanceSummary: {
      totalDays,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      payableDays,
      lopDays,
      prorationRatio: round2(prorationRatio),
      overtimeHours,
      overtimeHourlyRate,
      overtimePay
    },
    earningsBreakdown: {
      basic: earnedBasic,
      da: earnedDa,
      hra: earnedHra,
      conveyance: earnedConveyance,
      specialAllowance: earnedSpecialAllowance,
      otherAllowances: earnedOtherAllowances,
      overtimePay,
      bonus,
      incentives,
      arrears,
      otherEarnings,
      totalVariablePay,
      grossSalary,
      nominalGrossFixed,
      lopDeductionAmount
    },
    deductionsBreakdown: {
      employeePf: employeePfDeduction,
      employeeEsic: employeeEsicDeduction,
      professionalTax: professionalTaxDeduction,
      tds: tdsAmount,
      customDeductions,
      totalEmployeeDeductions
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
    statutoryDetails: {
      pf: pfResult,
      esic: esicResult,
      pt: ptResult,
      tds: tdsDetails
    },
    auditTrail: {
      calculatedAt: new Date().toISOString(),
      formulaApplied: 'Net Salary = Gross Salary - (Employee PF + Employee ESIC + Professional Tax + TDS + Custom Deductions)',
      employerDeductionExcludedFromNetPay: true,
      integrityCheck: round2(netSalary + totalEmployeeDeductions) === grossSalary
    }
  };
}

module.exports = {
  calculatePayroll
};
