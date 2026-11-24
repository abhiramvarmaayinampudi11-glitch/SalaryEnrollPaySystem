/**
 * Automated REST API Test Suite for Payroll, PF, ESIC, Tax, Gratuity & Health Endpoints
 * Tests valid inputs, missing fields, validation rejections, and statutory edge cases.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
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

/**
 * Helper to make JSON HTTP requests
 */
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

describe('Health API Check', () => {
  test('GET /api/health returns 200 and preserves system health structure', async () => {
    const { status, data } = await request('/api/health');

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.status, 'UP');
    assert.equal(data.data.service, 'Salary Enroll Pay System – Backend Engine');
    assert.ok(data.data.modules.calculations);
    assert.ok(data.data.modules.database);
    assert.ok(data.data.modules.groqAi);
  });
});

describe('POST /api/payroll/calculate (Full Monthly Payroll)', () => {
  test('Valid input: Calculates full payroll with attendance proration and net salary', async () => {
    const payload = {
      salaryStructure: {
        basic: 30000,
        hra: 12000,
        conveyance: 2000,
        specialAllowance: 6000
      },
      attendance: {
        totalDays: 30,
        presentDays: 25,
        paidLeaveDays: 2,
        unpaidLeaveDays: 3,
        overtimeHours: 4,
        overtimeHourlyRate: 250
      },
      variablePay: {
        bonus: 3000
      },
      statutoryOptions: {
        pfEligible: true,
        capPfAtWageCeiling: true,
        stateForPt: 'KARNATAKA'
      }
    };

    const { status, data } = await request('/api/payroll/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.message, 'Monthly payroll calculated successfully.');

    const result = data.data;
    // Payable days = 25 present + 2 paid leave = 27 days
    assert.equal(result.attendanceSummary.payableDays, 27);
    assert.equal(result.attendanceSummary.lopDays, 3);
    assert.equal(result.attendanceSummary.overtimePay, 1000); // 4 * 250

    // Accounting invariant: Net Salary + Total Employee Deductions === Gross Salary
    const calculatedSum = Math.round((result.netSalary + result.deductionsBreakdown.totalEmployeeDeductions) * 100) / 100;
    assert.equal(calculatedSum, result.earningsBreakdown.grossSalary);

    // Employer shares must NOT be deducted from Net Salary
    assert.equal(result.auditTrail.employerDeductionExcludedFromNetPay, true);
    assert.ok(result.employerContributions.totalEmployerContribution > 0);
  });

  test('Missing required field: Rejects when salaryStructure.basic is omitted', async () => {
    const payload = {
      salaryStructure: {
        hra: 5000
      }
    };

    const { status, data } = await request('/api/payroll/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
    assert.ok(data.error.details.some((msg) => msg.includes('salaryStructure.basic is required')));
  });

  test('Invalid value: Rejects negative basic salary', async () => {
    const payload = {
      salaryStructure: {
        basic: -15000
      }
    };

    const { status, data } = await request('/api/payroll/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('non-negative number')));
  });

  test('Constraint violation: Rejects when presentDays exceeds totalDays', async () => {
    const payload = {
      salaryStructure: {
        basic: 20000
      },
      attendance: {
        totalDays: 30,
        presentDays: 35
      }
    };

    const { status, data } = await request('/api/payroll/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('cannot exceed totalDays')));
  });
});

describe('POST /api/payroll/pf/calculate', () => {
  test('Valid input: Calculates PF with wage ceiling and returns isolated employer shares', async () => {
    const payload = {
      earnedBasic: 25000,
      earnedDa: 0,
      options: {
        capAtWageCeiling: true
      }
    };

    const { status, data } = await request('/api/payroll/pf/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.pfWages, 25000);
    assert.equal(data.data.pfWageSubjectToEpf, 15000);

    // Employee share (12% of 15,000)
    assert.equal(data.data.employeeDeduction.epf, 1800);

    // Employer shares
    assert.equal(data.data.employerContribution.eps, 1250); // Capped at 1250
    assert.equal(data.data.employerContribution.epf, 550); // 1800 - 1250
    assert.equal(data.data.employerContribution.edli, 75);
    assert.equal(data.data.employerContribution.adminCharges, 75);
    assert.equal(data.data.employerContribution.total, 1950);
  });

  test('Rejects when earnedBasic is missing or invalid', async () => {
    const { status, data } = await request('/api/payroll/pf/calculate', {
      method: 'POST',
      body: {}
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('earnedBasic is required')));
  });

  test('Configurable rules: Accepts custom configuration without hardcoding', async () => {
    const payload = {
      earnedBasic: 20000,
      options: {
        capAtWageCeiling: true,
        customConfig: {
          pf: {
            wageCeiling: 18000,
            employeeRate: 0.10
          }
        }
      }
    };

    const { status, data } = await request('/api/payroll/pf/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.data.pfWageSubjectToEpf, 18000);
    assert.equal(data.data.employeeDeduction.epf, 1800); // 10% of 18,000
  });
});

describe('POST /api/payroll/esic/calculate', () => {
  test('Valid input: Calculates standard ESIC for eligible wage', async () => {
    const payload = {
      grossWages: 16000,
      workingDays: 30,
      presentDays: 30
    };

    const { status, data } = await request('/api/payroll/esic/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.isEsicEligible, true);
    assert.equal(data.data.employeeDeduction.esic, 120); // 0.75% of 16,000 = 120
    assert.equal(data.data.employerContribution.esic, 520); // 3.25% of 16,000 = 520
  });

  test('Rejects when grossWages is missing', async () => {
    const { status, data } = await request('/api/payroll/esic/calculate', {
      method: 'POST',
      body: {}
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('grossWages is required')));
  });

  test('Rejects when presentDays exceeds workingDays', async () => {
    const payload = {
      grossWages: 15000,
      workingDays: 26,
      presentDays: 28
    };

    const { status, data } = await request('/api/payroll/esic/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('cannot exceed workingDays')));
  });
});

describe('POST /api/payroll/tax/calculate', () => {
  test('Valid input: Calculates state Professional Tax and optional TDS', async () => {
    const payload = {
      monthlyGrossSalary: 28000,
      state: 'MAHARASHTRA',
      month: 2, // February special amount
      gender: 'MALE',
      enableTds: true
    };

    const { status, data } = await request('/api/payroll/tax/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.professionalTax.professionalTax, 300); // 300 in Feb for MH
    assert.ok(data.data.tds !== null);
    assert.equal(data.data.tds.regime, 'NEW');
  });

  test('Rejects when monthlyGrossSalary is missing', async () => {
    const { status, data } = await request('/api/payroll/tax/calculate', {
      method: 'POST',
      body: {}
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('monthlyGrossSalary is required')));
  });
});

describe('POST /api/payroll/gratuity/calculate', () => {
  test('Valid input: Calculates gratuity for eligible service (>= 5 years)', async () => {
    const payload = {
      lastDrawnBasic: 26000,
      lastDrawnDa: 0,
      completedYears: 5
    };

    const { status, data } = await request('/api/payroll/gratuity/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.isEligible, true);
    assert.equal(data.data.gratuityAmount, 75000); // (15 * 26000 * 5) / 26
    assert.ok(data.data.assumptions.length > 0);
  });

  test('Valid input: Ineligible tenure (< 5 years) returns 0 with clear assumption explanation', async () => {
    const payload = {
      lastDrawnBasic: 30000,
      completedYears: 3
    };

    const { status, data } = await request('/api/payroll/gratuity/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.data.isEligible, false);
    assert.equal(data.data.gratuityAmount, 0);
  });

  test('Rejects when completedYears is missing', async () => {
    const payload = {
      lastDrawnBasic: 25000
    };

    const { status, data } = await request('/api/payroll/gratuity/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.details.some((msg) => msg.includes('completedYears is required')));
  });
});

describe('Unmatched Route 404 Handler', () => {
  test('GET /api/nonexistent returns structured 404', async () => {
    const { status, data } = await request('/api/nonexistent');

    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'NOT_FOUND');
    assert.ok(data.error.message.includes('Resource not found'));
  });
});
