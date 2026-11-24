/**
 * Automated Test Suite for Monthly Salary Calculation Engine
 * Verifies attendance-based payable salary, double NCP deduction prevention,
 * Gross = Basic + Allowances + OT + Bonus, Total Deductions = PF + ESIC + Advance + Other,
 * Net = Gross - Total Deductions, decimal safety, proration methods, and API routes.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { calculateMonthlySalary } = require('../src/services/monthlySalaryCalculator');
const app = require('../src/app');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

describe('Monthly Salary Calculation Engine - Business Logic & Invariants', () => {
  test('Standard calculation: attendance-based payable salary, OT, bonus, and deductions', () => {
    const input = {
      employeeId: 'EMP_1001',
      month: 5,
      year: 2026,
      workingDays: 30,
      paidDays: 26,
      ncpDays: 4,
      monthlyBasicSalary: 30000,
      allowances: {
        hra: 12000,
        da: 0,
        conveyance: 2000,
        specialAllowance: 6000
      },
      overtimeHours: 10,
      overtimeHourlyRate: 200, // 2,000 OT
      bonus: 3000,
      advanceRecovery: 1500,
      otherDeductions: 500,
      statutoryOptions: {
        pfEligible: true,
        capPfAtWageCeiling: true,
        stateForPt: 'KARNATAKA'
      }
    };

    const result = calculateMonthlySalary(input);

    // 1. Distinction: Nominal vs Payable
    // Nominal monthly salary = 30000 + 12000 + 2000 + 6000 = 50,000
    assert.equal(result.salaryComparison.nominalMonthlySalary, 50000);

    // Proration ratio = 26 / 30 = 0.87
    assert.equal(result.attendance.workingDays, 30);
    assert.equal(result.attendance.paidDays, 26);
    assert.equal(result.attendance.ncpDays, 4);
    assert.equal(result.attendance.prorationRatio, 0.87);

    // Payable Basic: 30000 * 0.87 = 26100
    assert.equal(result.earnings.payableBasic, 26100);
    assert.ok(result.salaryComparison.attendancePayableSalary < result.salaryComparison.nominalMonthlySalary);

    // 2. Overtime & Bonus
    assert.equal(result.earnings.overtime.amount, 2000);
    assert.equal(result.earnings.bonus, 3000);

    // 3. Gross Formula Invariant:
    // Gross = Basic Pay + Allowances + OT + Bonus
    const expectedGross = Math.round(
      (result.earnings.payableBasic +
        result.earnings.payableAllowances.total +
        result.earnings.overtime.amount +
        result.earnings.bonus) * 100
    ) / 100;
    assert.equal(result.earnings.grossEarnings, expectedGross);

    // 4. Double Deduction Prevention:
    // NCP is already factored into payableBasic and payableAllowances.
    // It must NOT be added into deductions.
    assert.equal(result.attendance.doubleNcpDeductionPrevented, true);
    assert.equal(result.deductions.advanceRecovery, 1500);
    assert.equal(result.deductions.otherDeductions, 500);

    // Total Deductions = Employee PF + Employee ESIC + PT + TDS + Advance Recovery + Other Deductions
    const expectedDeductions = Math.round(
      (result.deductions.employeePf +
        result.deductions.employeeEsic +
        result.deductions.professionalTax +
        result.deductions.tds +
        result.deductions.advanceRecovery +
        result.deductions.otherDeductions) * 100
    ) / 100;
    assert.equal(result.deductions.totalDeductions, expectedDeductions);

    // 5. Net Formula Invariant:
    // Net = Gross - Total Deductions
    assert.equal(result.netSalary, Math.round((expectedGross - expectedDeductions) * 100) / 100);
    assert.equal(result.auditTrail.accountingIntegrity, true);

    // 6. Employer Contributions Separation:
    assert.ok(result.employerContributions.employerPf.total > 0);
    assert.equal(result.auditTrail.employerContributionsExcludedFromNetSalary, true);
  });

  test('Prevent double deduction of NCP verification', () => {
    const input = {
      workingDays: 30,
      paidDays: 20,
      ncpDays: 10, // 10 days unpaid
      monthlyBasicSalary: 30000,
      advanceRecovery: 2000
    };

    const result = calculateMonthlySalary(input);

    // Nominal: 30,000; Payable: 20,000 (proration 20/30 = 0.67 -> 20100)
    assert.equal(result.salaryComparison.nominalMonthlySalary, 30000);

    // Double deduction check:
    // Deductions must ONLY contain statutory deductions + advanceRecovery (2000).
    // The NCP amount (~10,000) must NEVER appear inside deductions.
    assert.equal(result.deductions.advanceRecovery, 2000);
    const nonStatutoryDeductions = result.deductions.advanceRecovery + result.deductions.otherDeductions;
    assert.equal(nonStatutoryDeductions, 2000);
    assert.equal(result.auditTrail.doubleNcpDeductionCheck.includes('PASSED'), true);
  });

  test('Configurable proration methods (CALENDAR_DAYS vs FIXED_30)', () => {
    const calendarMonth31 = {
      workingDays: 31,
      paidDays: 28,
      monthlyBasicSalary: 31000,
      prorationMethod: 'CALENDAR_DAYS'
    };
    const resCalendar = calculateMonthlySalary(calendarMonth31);
    // 28 / 31 = 0.90 -> 31000 * 0.90 = 27900
    assert.equal(resCalendar.attendance.prorationDivisor, 31);
    assert.equal(resCalendar.earnings.payableBasic, 27900);

    const fixed30Month = {
      workingDays: 31,
      paidDays: 28,
      monthlyBasicSalary: 30000,
      prorationMethod: 'FIXED_30'
    };
    const resFixed = calculateMonthlySalary(fixed30Month);
    // 28 / 30 = 0.93 -> 30000 * 0.93 = 27900
    assert.equal(resFixed.attendance.prorationDivisor, 30);
    assert.equal(resFixed.earnings.payableBasic, 27900);
  });

  test('Direct overtimeAmount overrides overtimeHours calculation', () => {
    const input = {
      monthlyBasicSalary: 20000,
      overtimeHours: 20,
      overtimeHourlyRate: 150, // would be 3,000
      overtimeAmount: 4500 // explicit override
    };

    const result = calculateMonthlySalary(input);
    assert.equal(result.earnings.overtime.amount, 4500);
  });

  test('Manual overrides for pfWages and esicWages', () => {
    const input = {
      monthlyBasicSalary: 40000,
      pfWages: 15000, // manual statutory cap
      esicWages: 20000,
      statutoryOptions: {
        pfEligible: true,
        esicEligible: true
      }
    };

    const result = calculateMonthlySalary(input);
    assert.equal(result.statutoryWagesUsed.pfWages, 15000);
    assert.equal(result.statutoryWagesUsed.isPfWagesOverridden, true);
    assert.equal(result.deductions.employeePf, 1800); // 12% of 15,000
    assert.equal(result.deductions.employeeEsic, 150); // 0.75% of 20,000
  });
});

describe('POST /api/payroll/monthly-salary/calculate (REST API Endpoint)', () => {
  test('Valid request returns 200 with complete breakdown', async () => {
    const payload = {
      employeeId: 'EMP_API_TEST',
      month: 6,
      year: 2026,
      workingDays: 30,
      paidDays: 28,
      ncpDays: 2,
      monthlyBasicSalary: 25000,
      allowances: {
        hra: 10000,
        conveyance: 1500
      },
      overtimeHours: 5,
      overtimeHourlyRate: 200,
      bonus: 1000,
      advanceRecovery: 500,
      otherDeductions: 200,
      statutoryOptions: {
        stateForPt: 'ANDHRA_PRADESH',
        pfEligible: true
      }
    };

    const { status, data } = await request('/api/payroll/monthly-salary/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.message, 'Monthly salary breakdown calculated successfully.');

    const res = data.data;
    assert.equal(res.employeeId, 'EMP_API_TEST');
    assert.equal(res.period.month, 6);
    assert.ok(res.earnings.grossEarnings > 0);
    assert.ok(res.deductions.totalDeductions > 0);
    assert.ok(res.netSalary > 0);
    assert.equal(res.attendance.doubleNcpDeductionPrevented, true);
  });

  test('Rejects invalid negative salary input with 400 Validation Error', async () => {
    const payload = {
      monthlyBasicSalary: -25000
    };

    const { status, data } = await request('/api/payroll/monthly-salary/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
    assert.ok(data.error.details.some((d) => d.includes('monthlyBasicSalary must be a non-negative number')));
  });

  test('Rejects when paidDays + ncpDays exceeds workingDays', async () => {
    const payload = {
      workingDays: 30,
      paidDays: 25,
      ncpDays: 10 // sum = 35 > 30
    };

    const { status, data } = await request('/api/payroll/monthly-salary/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
    assert.ok(data.error.details.some((d) => d.includes('cannot exceed workingDays')));
  });
});
