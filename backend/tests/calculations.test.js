/**
 * Automated Verification Test Suite for Payroll, PF, ESIC, PT, Gratuity, and TDS Calculations
 * Uses Node.js native test runner (node:test and node:assert).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calculatePf } = require('../src/services/pfCalculator');
const { calculateEsic } = require('../src/services/esicCalculator');
const { calculateProfessionalTax, estimateGratuity, estimateTds } = require('../src/services/ptAndTaxCalculator');
const { calculatePayroll } = require('../src/services/payrollCalculator');
const { getStatutoryConfig } = require('../src/config/statutoryRules');

describe('EPFO / PF Calculation Engine', () => {
  test('Standard PF calculation below wage ceiling (Basic: ₹10,000, DA: ₹0)', () => {
    const result = calculatePf(10000, 0);

    assert.equal(result.isPfEligible, true);
    assert.equal(result.pfWages, 10000);
    assert.equal(result.pfWageSubjectToEpf, 10000);

    // Employee EPF: 12% of 10,000 = 1,200
    assert.equal(result.employeeDeduction.epf, 1200);
    assert.equal(result.employeeDeduction.total, 1200);

    // Employer EPS: 8.33% of 10,000 = 833
    assert.equal(result.employerContribution.eps, 833);

    // Employer EPF: 12% (1200) - 833 = 367
    assert.equal(result.employerContribution.epf, 367);

    // EDLI: 0.5% of 10,000 = 50
    assert.equal(result.employerContribution.edli, 50);

    // Admin Charges: 0.5% of 10,000 = 50
    assert.equal(result.employerContribution.adminCharges, 50);

    // Total Employer PF: 367 + 833 + 50 + 50 = 1300
    assert.equal(result.employerContribution.total, 1300);
  });

  test('PF capped at statutory wage ceiling ₹15,000 for high earner (Basic: ₹40,000)', () => {
    const result = calculatePf(40000, 0, { capAtWageCeiling: true });

    assert.equal(result.isPfEligible, true);
    assert.equal(result.pfWages, 40000);
    assert.equal(result.pfWageSubjectToEpf, 15000);

    // Employee EPF capped at 12% of 15,000 = 1,800
    assert.equal(result.employeeDeduction.epf, 1800);

    // Employer EPS strictly capped at ₹1,250
    assert.equal(result.employerContribution.eps, 1250);

    // Employer EPF: 1,800 - 1,250 = 550
    assert.equal(result.employerContribution.epf, 550);

    // EDLI: 0.5% of 15,000 = 75
    assert.equal(result.employerContribution.edli, 75);

    // Admin Charges: 0.5% of 15,000 = 75
    assert.equal(result.employerContribution.adminCharges, 75);

    // Total Employer: 550 + 1250 + 75 + 75 = 1,950
    assert.equal(result.employerContribution.total, 1950);
  });

  test('Voluntary excess PF without wage ceiling (Basic: ₹30,000, capAtWageCeiling: false)', () => {
    const result = calculatePf(30000, 0, { capAtWageCeiling: false });

    // Employee EPF: 12% of full 30,000 = 3,600
    assert.equal(result.employeeDeduction.epf, 3600);

    // Employer EPS is still statutorily capped at ₹1,250
    assert.equal(result.employerContribution.eps, 1250);

    // Employer EPF: (12% of 30,000 = 3600) - 1250 = 2350
    assert.equal(result.employerContribution.epf, 2350);
  });

  test('Ineligible employee returns zero deductions and contributions', () => {
    const result = calculatePf(20000, 0, { isPfEligible: false });

    assert.equal(result.isPfEligible, false);
    assert.equal(result.employeeDeduction.total, 0);
    assert.equal(result.employerContribution.total, 0);
  });

  test('Custom rules override: Rates and ceilings configurable without hardcoding', () => {
    const customConfig = {
      pf: {
        employeeRate: 0.10, // 10%
        wageCeiling: 20000,
        employerTotalRate: 0.10
      }
    };
    const result = calculatePf(25000, 0, { capAtWageCeiling: true, customConfig });

    assert.equal(result.pfWageSubjectToEpf, 20000);
    assert.equal(result.employeeDeduction.epf, 2000); // 10% of 20,000
  });
});

describe('ESIC Calculation Engine', () => {
  test('Standard ESIC eligible employee (Gross: ₹18,000 <= ₹21,000)', () => {
    const result = calculateEsic(18000, 30, 30);

    assert.equal(result.isEsicEligible, true);
    assert.equal(result.isExemptFromEmployeeShare, false);

    // Employee ESIC: 0.75% of 18,000 = 135
    assert.equal(result.employeeDeduction.esic, 135);

    // Employer ESIC: 3.25% of 18,000 = 585
    assert.equal(result.employerContribution.esic, 585);
  });

  test('High earner above ₹21,000 threshold is ineligible for ESIC', () => {
    const result = calculateEsic(25000, 30, 30);

    assert.equal(result.isEsicEligible, false);
    assert.equal(result.employeeDeduction.esic, 0);
    assert.equal(result.employerContribution.esic, 0);
  });

  test('Disability wage ceiling higher limit (₹25,000)', () => {
    const result = calculateEsic(23000, 30, 30, { hasDisability: true });

    assert.equal(result.isEsicEligible, true);
    assert.equal(result.hasDisability, true);
    assert.equal(result.wageCeiling, 25000);
    assert.equal(result.employeeDeduction.esic, Math.ceil(23000 * 0.0075)); // 173
  });

  test('Daily wage exemption (Daily wage <= ₹176: Employee 0%, Employer 3.25%)', () => {
    // 4000 gross with 25 present days = daily wage ₹160 <= ₹176
    const result = calculateEsic(4000, 30, 25);

    assert.equal(result.isEsicEligible, true);
    assert.equal(result.dailyWage, 160);
    assert.equal(result.isExemptFromEmployeeShare, true);

    // Employee share is 0 (EXEMPT)
    assert.equal(result.employeeDeduction.esic, 0);

    // Employer STILL pays 3.25% (3.25% of 4000 = 130)
    assert.equal(result.employerContribution.esic, 130);
  });
});

describe('Professional Tax & Statutory Estimators', () => {
  test('Professional Tax slabs for Maharashtra, Andhra Pradesh, and Karnataka', () => {
    // Maharashtra Male > 10,000 = 200 (March = month 3)
    const mh = calculateProfessionalTax(15000, 'MAHARASHTRA', { month: 3, gender: 'MALE' });
    assert.equal(mh.professionalTax, 200);

    // Maharashtra February special amount = 300
    const mhFeb = calculateProfessionalTax(15000, 'MAHARASHTRA', { month: 2, gender: 'MALE' });
    assert.equal(mhFeb.professionalTax, 300);

    // Andhra Pradesh 15001 - 20000 = 150
    const ap = calculateProfessionalTax(18000, 'ANDHRA_PRADESH');
    assert.equal(ap.professionalTax, 150);

    // Karnataka < 15,000 = 0
    const kaLow = calculateProfessionalTax(12000, 'KARNATAKA');
    assert.equal(kaLow.professionalTax, 0);

    // Karnataka >= 15,000 = 200
    const kaHigh = calculateProfessionalTax(22000, 'KARNATAKA');
    assert.equal(kaHigh.professionalTax, 200);
  });

  test('Gratuity calculation under Payment of Gratuity Act, 1972', () => {
    // Under 5 years service -> not eligible
    const ineligible = estimateGratuity(30000, 0, 4);
    assert.equal(ineligible.isEligible, false);
    assert.equal(ineligible.gratuityAmount, 0);

    // 5 years service with Basic + DA = 26,000: (15 * 26000 * 5) / 26 = 75,000
    const eligible = estimateGratuity(26000, 0, 5);
    assert.equal(eligible.isEligible, true);
    assert.equal(eligible.gratuityAmount, 75000);

    // Statutory cap of ₹20,00,000 applied for large tenures/salaries
    const capped = estimateGratuity(500000, 0, 30);
    assert.equal(capped.isEligible, true);
    assert.equal(capped.gratuityAmount, 2000000);
    assert.equal(capped.isCappedAtLimit, true);
  });

  test('TDS Estimator under Section 115BAC New Tax Regime', () => {
    // Monthly gross ₹50,000 -> Annualized ₹6,00,000. Less ₹75k std deduction = ₹5,25,000. Under 87A rebate, tax = 0.
    const lowTax = estimateTds(50000);
    assert.equal(lowTax.monthlyTdsEstimate, 0);
    assert.equal(lowTax.netTaxableIncome, 525000);

    // Monthly gross ₹1,00,000 -> Annualized ₹12,00,000. Slabs computed.
    const highTax = estimateTds(100000);
    assert.ok(highTax.monthlyTdsEstimate > 0);
    assert.ok(highTax.totalAnnualTax > 0);
  });
});

describe('Main Payroll Calculation Engine & Invariants', () => {
  test('Full payroll calculation with attendance proration and LOP', () => {
    const input = {
      salaryStructure: {
        basic: 24000,
        da: 0,
        hra: 10000,
        conveyance: 2000,
        specialAllowance: 4000
      },
      attendance: {
        totalDays: 30,
        presentDays: 20, // 10 days unpaid loss of pay (LOP)
        paidLeaveDays: 0,
        unpaidLeaveDays: 10,
        overtimeHours: 5,
        overtimeHourlyRate: 200 // 1,000 OT
      },
      variablePay: {
        bonus: 2000
      },
      statutoryOptions: {
        pfEligible: true,
        capPfAtWageCeiling: true,
        stateForPt: 'KARNATAKA'
      }
    };

    const result = calculatePayroll(input);

    // 1. Attendance & Proration verification
    assert.equal(result.attendanceSummary.totalDays, 30);
    assert.equal(result.attendanceSummary.presentDays, 20);
    assert.equal(result.attendanceSummary.payableDays, 20);
    assert.equal(result.attendanceSummary.lopDays, 10);
    assert.equal(result.attendanceSummary.prorationRatio, 0.67);

    // 2. Prorated Basic: 24000 * (20/30) = 16000
    assert.equal(result.earningsBreakdown.basic, 16000);

    // 3. Gross Salary includes prorated earnings + OT (1,000) + Bonus (2,000)
    assert.ok(result.earningsBreakdown.grossSalary > 0);

    // 4. Invariant: Employer contributions must NEVER be deducted from Net Salary
    assert.equal(result.auditTrail.employerDeductionExcludedFromNetPay, true);

    // 5. Accounting Invariant: Net Salary + Total Employee Deductions === Gross Salary
    assert.equal(
      Math.round((result.netSalary + result.deductionsBreakdown.totalEmployeeDeductions) * 100) / 100,
      result.earningsBreakdown.grossSalary
    );

    // 6. CTC Invariant: Monthly CTC === Gross Salary + Total Employer Contribution
    assert.equal(
      Math.round((result.earningsBreakdown.grossSalary + result.employerContributions.totalEmployerContribution) * 100) / 100,
      result.costToCompany.monthlyCtc
    );
  });

  test('ESIC and PF combined scenario: Verify employer contributions do not decrease take-home', () => {
    const input = {
      salaryStructure: {
        basic: 12000,
        hra: 4000,
        conveyance: 1000
      },
      attendance: {
        totalDays: 30,
        presentDays: 30
      },
      statutoryOptions: {
        pfEligible: true,
        capPfAtWageCeiling: true,
        stateForPt: 'ANDHRA_PRADESH'
      }
    };

    const result = calculatePayroll(input);

    // Gross: 17,000 <= 21,000 -> ESIC is eligible
    assert.equal(result.statutoryDetails.esic.isEsicEligible, true);

    // Employee Deductions should only contain employee shares:
    const expectedEmployeeDeductions =
      result.deductionsBreakdown.employeePf +
      result.deductionsBreakdown.employeeEsic +
      result.deductionsBreakdown.professionalTax;

    assert.equal(result.deductionsBreakdown.totalEmployeeDeductions, expectedEmployeeDeductions);
    assert.equal(result.netSalary, result.earningsBreakdown.grossSalary - expectedEmployeeDeductions);

    // Employer shares exist in employerContributions and are strictly positive
    assert.ok(result.employerContributions.employerPf.total > 0);
    assert.ok(result.employerContributions.employerEsic > 0);
    assert.ok(result.costToCompany.monthlyCtc > result.earningsBreakdown.grossSalary);
  });
});
