/**
 * Automated Unit Test Suite for Statutory Contribution Calculation Engine
 * Verifies independent calculations, eligibility flags, age-based EPS rules,
 * wage ceilings, distinct wage definitions (PF != ESIC != Gross), zero NCP vs NCP proration,
 * employer EPF allocation after EPS, statutory rounding, and rule snapshot preservation.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { calculateStatutoryContributions } = require('../src/services/statutoryContributionEngine');
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

describe('Statutory Contribution Engine - Distinct Wages & Ceilings', () => {
  test('Distinct wage definitions: PF wages (Basic+DA) != ESIC wages (Gross)', async () => {
    const input = {
      basicSalary: 14000,
      da: 0,
      allowances: {
        hra: 5000,
        conveyance: 1000
      },
      overtimeAmount: 1000,
      bonus: 0,
      workingDays: 30,
      paidDays: 30,
      ncpDays: 0
    };

    const result = await calculateStatutoryContributions(input);

    // 1. Verify wage distinction
    assert.equal(result.wageBreakdown.pfWages, 14000); // 14,000 Basic
    assert.equal(result.wageBreakdown.esicWages, 21000); // 14,000 + 5,000 + 1,000 + 1,000 = 21,000
    assert.equal(result.wageBreakdown.wagesDistinct, true);

    // 2. PF computed on 14,000 (12% = 1,680)
    assert.equal(result.employeeDeductions.epf, 1680);

    // 3. ESIC computed on 21,000 (0.75% = 158)
    assert.equal(result.employeeDeductions.esic, 158);
  });

  test('Standard statutory wage ceiling check (PF capped at ₹15,000 for high basic)', async () => {
    const input = {
      basicSalary: 35000,
      da: 0,
      capPfAtWageCeiling: true,
      workingDays: 30,
      paidDays: 30,
      ncpDays: 0
    };

    const result = await calculateStatutoryContributions(input);

    assert.equal(result.wageBreakdown.pfWageSubjectToEpf, 15000);

    // Employee EPF: 12% of 15,000 = 1,800
    assert.equal(result.employeeDeductions.epf, 1800);

    // Employer EPS: 8.33% of 15,000 capped at 1,250
    assert.equal(result.employerContributions.pf.eps, 1250);

    // Employer EPF: 1,800 - 1,250 = 550
    assert.equal(result.employerContributions.pf.epf, 550);

    // EDLI: 0.5% of 15,000 = 75
    assert.equal(result.employerContributions.pf.edli, 75);

    // Admin Charges: 0.5% of 15,000 = 75
    assert.equal(result.employerContributions.pf.adminCharges, 75);

    // Total Employer PF: 550 + 1250 + 75 + 75 = 1,950
    assert.equal(result.employerContributions.pf.total, 1950);
  });

  test('Voluntary excess PF without wage ceiling (Basic: ₹30,000, capPfAtWageCeiling: false)', async () => {
    const input = {
      basicSalary: 30000,
      capPfAtWageCeiling: false,
      workingDays: 30,
      paidDays: 30,
      ncpDays: 0
    };

    const result = await calculateStatutoryContributions(input);

    // Employee EPF on full 30,000 = 3,600
    assert.equal(result.employeeDeductions.epf, 3600);

    // Employer EPS remains strictly statutorily capped at ₹1,250
    assert.equal(result.employerContributions.pf.eps, 1250);

    // Employer EPF: (12% of 30,000 = 3600) - 1250 = 2,350
    assert.equal(result.employerContributions.pf.epf, 2350);
  });
});

describe('Statutory Contribution Engine - Eligibility & Age-Based Pension Rules', () => {
  test('Ineligible PF employee yields zero PF deductions and zero employer contributions', async () => {
    const input = {
      basicSalary: 20000,
      isPfEligible: false
    };

    const result = await calculateStatutoryContributions(input);

    assert.equal(result.eligibilitySummary.isPfEligible, false);
    assert.equal(result.employeeDeductions.epf, 0);
    assert.equal(result.employerContributions.pf.total, 0);
  });

  test('Pension (EPS) age 58+ rule: EPS is 0 and full employer 12% is allocated to Employer EPF', async () => {
    const input = {
      basicSalary: 20000,
      age: 60, // Senior employee age >= 58
      capPfAtWageCeiling: true
    };

    const result = await calculateStatutoryContributions(input);

    assert.equal(result.eligibilitySummary.epsAgeRestricted, true);
    assert.equal(result.eligibilitySummary.isEpsEligible, false);

    // EPS contribution must be 0 for senior employee
    assert.equal(result.employerContributions.pf.eps, 0);

    // Total Employer 12% on 15,000 = 1,800.
    // Because EPS is 0, the entire 1,800 goes to Employer EPF!
    assert.equal(result.employerContributions.pf.epf, 1800);

    // Total Employer PF: 1800 (EPF) + 0 (EPS) + 75 (EDLI) + 75 (Admin) = 1,950
    assert.equal(result.employerContributions.pf.total, 1950);
  });

  test('ESIC Disability threshold rule (₹25,000 vs standard ₹21,000)', async () => {
    // Gross: 23,000
    const standardInput = {
      basicSalary: 15000,
      allowances: { hra: 8000 }, // Gross = 23,000
      hasDisability: false
    };
    const standardRes = await calculateStatutoryContributions(standardInput);
    // Standard limit is 21,000 -> 23,000 is INELIGIBLE
    assert.equal(standardRes.eligibilitySummary.isEsicCovered, false);
    assert.equal(standardRes.employeeDeductions.esic, 0);

    const disabilityInput = {
      basicSalary: 15000,
      allowances: { hra: 8000 }, // Gross = 23,000
      hasDisability: true // Higher limit of 25,000 applies
    };
    const disabilityRes = await calculateStatutoryContributions(disabilityInput);
    // Eligible under 25,000 ceiling!
    assert.equal(disabilityRes.eligibilitySummary.isEsicCovered, true);
    assert.equal(disabilityRes.eligibilitySummary.applicableEsicLimit, 25000);
    assert.ok(disabilityRes.employeeDeductions.esic > 0);
  });
});

describe('Statutory Contribution Engine - Zero NCP vs NCP Cases', () => {
  test('Zero NCP (Full Attendance): Full wages subject to calculation', async () => {
    const input = {
      basicSalary: 20000,
      workingDays: 30,
      paidDays: 30,
      ncpDays: 0
    };

    const result = await calculateStatutoryContributions(input);

    assert.equal(result.period.ncpDays, 0);
    assert.equal(result.period.prorationRatio, 1);
    assert.equal(result.wageBreakdown.pfWages, 20000);
  });

  test('NCP Case (50% attendance / 15 days NCP): Wages prorated accurately', async () => {
    const input = {
      basicSalary: 20000,
      workingDays: 30,
      paidDays: 15,
      ncpDays: 15 // 15 days unpaid
    };

    const result = await calculateStatutoryContributions(input);

    assert.equal(result.period.ncpDays, 15);
    assert.equal(result.period.prorationRatio, 0.5);

    // Prorated Basic: 20000 * 0.5 = 10,000
    assert.equal(result.wageBreakdown.pfWages, 10000);
    // Employee EPF on 10,000 = 1,200
    assert.equal(result.employeeDeductions.epf, 1200);
  });
});

describe('Statutory Contribution Engine - Snapshot & API Integration', () => {
  test('Returns immutable rule snapshot with version and applied rates', async () => {
    const input = {
      basicSalary: 12000,
      allowances: { hra: 4000 }
    };

    const result = await calculateStatutoryContributions(input);

    assert.ok(result.ruleSnapshot);
    assert.ok(result.ruleSnapshot.ruleCode);
    assert.ok(result.ruleSnapshot.version);
    assert.ok(result.ruleSnapshot.pf.wageCeiling);
    assert.ok(result.ruleSnapshot.esic.wageLimit);
    assert.equal(result.auditTrail.zeroDoubleCounting, true);
    assert.equal(result.auditTrail.employerCostsExcludedFromEmployeeDeductions, true);
  });

  test('POST /api/payroll/statutory/calculate (REST API Endpoint)', async () => {
    const payload = {
      employeeId: 'EMP_STAT_TEST',
      age: 32,
      basicSalary: 18000,
      allowances: { hra: 6000 },
      overtimeAmount: 1500,
      workingDays: 30,
      paidDays: 28,
      ncpDays: 2
    };

    const { status, data } = await request('/api/payroll/statutory/calculate', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.message, 'Statutory contributions and compliance breakdown calculated successfully.');

    const res = data.data;
    assert.equal(res.employeeId, 'EMP_STAT_TEST');
    assert.ok(res.employeeDeductions.totalEmployeeDeductions > 0);
    assert.ok(res.employerContributions.totalEmployerContributions > 0);
    assert.ok(res.ruleSnapshot);
  });
});
