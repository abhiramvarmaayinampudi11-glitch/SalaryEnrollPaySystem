/**
 * Automated Test Suite for Statutory Rules Management APIs & Payroll Snapshotting
 * Tests admin authorization, rule creation, versioning, date-based applicability resolution,
 * error handling when no rule exists, and immutable payroll snapshotting.
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

describe('Statutory Rules Management & Admin Authorization', () => {
  const testRuleCode = `STATUTORY_RULE_${Date.now()}`;
  let createdRuleId;

  test('POST /api/statutory-rules: Enforces admin authorization (rejects unauthorized)', async () => {
    const payload = {
      ruleCode: testRuleCode,
      effectiveFrom: '2025-01-01'
    };

    // Request WITHOUT admin header
    const { status, data } = await request('/api/statutory-rules', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 403);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'UNAUTHORIZED_ADMIN');
    assert.ok(data.error.message.includes('Administrator privileges required'));
  });

  test('POST /api/statutory-rules: Successfully creates rule with admin authorization', async () => {
    const payload = {
      ruleCode: testRuleCode,
      name: 'FY 2025-2026 Enhanced Statutory Rule',
      effectiveFrom: '2025-01-01',
      pf: {
        employeeRate: 0.12,
        employerTotalRate: 0.12,
        wageCeiling: 18000, // Configurable ceiling override
        epsMaxCap: 1500
      },
      esic: {
        wageLimit: 25000,
        employeeRate: 0.0075,
        employerRate: 0.0325
      },
      remarks: 'Admin verified revision for 2025+'
    };

    const { status, data } = await request('/api/statutory-rules', {
      method: 'POST',
      headers: { 'x-admin-role': 'admin' },
      body: payload
    });

    assert.equal(status, 201);
    assert.equal(data.success, true);
    assert.equal(data.data.ruleCode, testRuleCode);
    assert.equal(data.data.version, 1);
    assert.equal(data.data.pf.wageCeiling, 18000);
    assert.equal(data.data.esic.wageLimit, 25000);
    assert.equal(data.data.verifiedByAdmin, true);

    createdRuleId = data.data._id;
  });

  test('POST /api/statutory-rules: Rejects validation when effectiveTo < effectiveFrom', async () => {
    const payload = {
      ruleCode: 'INVALID_DATES',
      effectiveFrom: '2026-05-01',
      effectiveTo: '2026-01-01' // Invalid: earlier than effectiveFrom
    };

    const { status, data } = await request('/api/statutory-rules', {
      method: 'POST',
      headers: { 'x-admin-role': 'admin' },
      body: payload
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
    assert.ok(data.error.details.some((d) => d.includes('effectiveTo date cannot be earlier')));
  });

  test('POST /api/statutory-rules: Versioning increments when updating existing ruleCode', async () => {
    const payload = {
      ruleCode: testRuleCode,
      name: 'FY 2027 Projected Revision',
      effectiveFrom: '2027-01-01',
      pf: {
        wageCeiling: 21000
      }
    };

    const { status, data } = await request('/api/statutory-rules', {
      method: 'POST',
      headers: { 'x-admin-role': 'admin' },
      body: payload
    });

    assert.equal(status, 201);
    assert.equal(data.success, true);
    assert.equal(data.data.ruleCode, testRuleCode);
    assert.equal(data.data.version, 2); // Version auto-incremented
    assert.equal(data.data.pf.wageCeiling, 21000);
  });

  test('GET /api/statutory-rules/versions: Retrieves version history for a ruleCode', async () => {
    const { status, data } = await request(`/api/statutory-rules/versions?ruleCode=${testRuleCode}`);

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data));
    assert.equal(data.data.length, 2);
    assert.equal(data.data[0].version, 2);
    assert.equal(data.data[1].version, 1);
  });

  test('GET /api/statutory-rules/active: Retrieves currently active baseline rule', async () => {
    const { status, data } = await request('/api/statutory-rules/active');

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.pf);
    assert.ok(data.data.esic);
    assert.equal(data.data.isActive, true);
  });

  test('GET /api/statutory-rules/applicable: Resolves applicable rule for payroll period', async () => {
    // Check for May 2026
    const { status, data } = await request('/api/statutory-rules/applicable?month=5&year=2026');

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.effectiveFrom);
    // Should match version 1 since version 2 is effective from 2027
    assert.equal(data.data.ruleCode, testRuleCode);
    assert.equal(data.data.version, 1);
    assert.equal(data.data.pf.wageCeiling, 18000);
  });

  test('GET /api/statutory-rules/applicable: Returns clear error if no rule exists for date', async () => {
    // Extremely early historical date prior to any effectiveFrom (e.g. year 1970)
    const { status, data } = await request('/api/statutory-rules/applicable?date=1970-01-01');

    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'NO_APPLICABLE_STATUTORY_RULE');
    assert.ok(data.error.message.includes('No applicable statutory rule found'));
  });

  test('GET /api/statutory-rules/:id: Retrieves rule by ID', async () => {
    assert.ok(createdRuleId);
    const { status, data } = await request(`/api/statutory-rules/${createdRuleId}`);

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data._id, createdRuleId);
  });

  test('PUT /api/statutory-rules/:id: Updates rule with admin authentication', async () => {
    const updates = {
      remarks: 'Updated remark by verified admin'
    };

    const { status, data } = await request(`/api/statutory-rules/${createdRuleId}`, {
      method: 'PUT',
      headers: { 'x-admin-role': 'admin' },
      body: updates
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.remarks, 'Updated remark by verified admin');
  });
});

describe('Payroll Calculation Integration & Statutory Rule Snapshotting', () => {
  const empId = `EMP_RULE_SNAP_${Date.now()}`;

  before(async () => {
    // Enroll employee
    await request('/api/employees', {
      method: 'POST',
      body: {
        employeeId: empId,
        firstName: 'Divya',
        lastName: 'Nair',
        email: `divya_${Date.now()}@example.com`,
        department: 'Legal & Compliance',
        stateForPt: 'KARNATAKA',
        pfEligible: true,
        salaryStructure: {
          basic: 25000,
          hra: 10000,
          conveyance: 2000
        }
      }
    });
  });

  test('POST /api/payroll/process/:employeeId: Embeds statutoryRuleSnapshot into PayrollRecord', async () => {
    const { status, data } = await request(`/api/payroll/process/${empId}`, {
      method: 'POST',
      body: {
        month: 6,
        year: 2026,
        attendance: { totalDays: 30, presentDays: 30 }
      }
    });

    assert.equal(status, 201);
    assert.equal(data.success, true);

    const record = data.data;
    // Verify that the rule snapshot is immutably stored in the record
    assert.ok(record.statutoryRuleSnapshot);
    assert.ok(record.statutoryRuleSnapshot.ruleCode);
    assert.ok(record.statutoryRuleSnapshot.version);
    assert.ok(record.statutoryRuleSnapshot.pf);
    assert.ok(record.statutoryRuleSnapshot.esic);
    assert.ok(record.statutoryRuleSnapshot.appliedAt);

    // Verify rates were applied from the resolved statutory rule
    assert.equal(record.statutoryDetails.pf.pfWageSubjectToEpf, record.statutoryRuleSnapshot.pf.wageCeiling);
  });
});
