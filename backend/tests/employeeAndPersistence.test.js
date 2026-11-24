/**
 * Automated Test Suite for Employee Management and Payroll Persistence APIs
 * Tests employee enrollment, salary structure attachment, payroll processing,
 * persistence queries, validation rejections, and offline fallback.
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

describe('Employee Enrollment & Management APIs', () => {
  const testEmpId = `EMP_TEST_${Date.now()}`;
  const testEmail = `employee_${Date.now()}@example.com`;

  test('POST /api/employees: Enrolls new employee with salary structure', async () => {
    const payload = {
      employeeId: testEmpId,
      firstName: 'Aarav',
      lastName: 'Sharma',
      email: testEmail,
      department: 'Engineering',
      designation: 'Software Engineer',
      stateForPt: 'KARNATAKA',
      pfEligible: true,
      salaryStructure: {
        basic: 35000,
        da: 0,
        hra: 14000,
        conveyance: 2000,
        specialAllowance: 5000
      }
    };

    const { status, data } = await request('/api/employees', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 201);
    assert.equal(data.success, true);
    assert.equal(data.data.employee.employeeId, testEmpId);
    assert.equal(data.data.employee.firstName, 'Aarav');
    assert.ok(data.data.salaryStructure);
    assert.equal(data.data.salaryStructure.basic, 35000);
  });

  test('POST /api/employees: Prevents duplicate employeeId or email', async () => {
    const payload = {
      employeeId: testEmpId,
      firstName: 'Duplicate',
      lastName: 'User',
      email: testEmail
    };

    const { status, data } = await request('/api/employees', {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 409);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'DUPLICATE_ENTITY');
  });

  test('POST /api/employees: Rejects missing required fields', async () => {
    const { status, data } = await request('/api/employees', {
      method: 'POST',
      body: { firstName: 'MissingFields' }
    });

    assert.equal(status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
    assert.ok(data.error.details.some((d) => d.includes('employeeId is required')));
  });

  test('GET /api/employees: Lists all enrolled employees', async () => {
    const { status, data } = await request('/api/employees');

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data));
    assert.ok(data.data.length > 0);

    const found = data.data.find((e) => e.employeeId === testEmpId);
    assert.ok(found);
    assert.ok(found.salaryStructure);
  });

  test('GET /api/employees/:id: Fetches single employee details', async () => {
    const { status, data } = await request(`/api/employees/${testEmpId}`);

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.employeeId, testEmpId);
    assert.equal(data.data.salaryStructure.basic, 35000);
  });

  test('GET /api/employees/:id: Returns 404 for non-existent employee', async () => {
    const { status, data } = await request('/api/employees/NON_EXISTENT_999');

    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('PUT /api/employees/:id: Updates employee department and salary structure', async () => {
    const updates = {
      department: 'Cloud Infrastructure',
      salaryStructure: {
        basic: 40000,
        hra: 16000
      }
    };

    const { status, data } = await request(`/api/employees/${testEmpId}`, {
      method: 'PUT',
      body: updates
    });

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.employee.department, 'Cloud Infrastructure');
    assert.equal(data.data.salaryStructure.basic, 40000);
  });
});

describe('Payroll Processing and Persistence APIs', () => {
  const persistEmpId = `EMP_PAYROLL_${Date.now()}`;
  let savedRecordId;

  before(async () => {
    // Enroll employee for payroll processing
    await request('/api/employees', {
      method: 'POST',
      body: {
        employeeId: persistEmpId,
        firstName: 'Sneha',
        lastName: 'Patel',
        email: `sneha_${Date.now()}@example.com`,
        department: 'Operations',
        stateForPt: 'MAHARASHTRA',
        pfEligible: true,
        salaryStructure: {
          basic: 28000,
          hra: 11200,
          conveyance: 2000,
          specialAllowance: 3800
        }
      }
    });
  });

  test('POST /api/payroll/process/:employeeId: Processes and persists monthly payroll', async () => {
    const payload = {
      month: 5,
      year: 2026,
      attendance: {
        totalDays: 31,
        presentDays: 28,
        paidLeaveDays: 2,
        unpaidLeaveDays: 1,
        overtimeHours: 6,
        overtimeHourlyRate: 200
      },
      variablePay: {
        bonus: 2500
      },
      remarks: 'May 2026 Monthly Payroll Run'
    };

    const { status, data } = await request(`/api/payroll/process/${persistEmpId}`, {
      method: 'POST',
      body: payload
    });

    assert.equal(status, 201);
    assert.equal(data.success, true);

    const record = data.data;
    assert.equal(record.employeeId, persistEmpId);
    assert.equal(record.month, 5);
    assert.equal(record.year, 2026);
    assert.ok(record.earnings.grossSalary > 0);
    assert.ok(record.netSalary > 0);
    assert.ok(record.employerContributions.totalEmployerContribution > 0);

    // Save record ID for lookup
    savedRecordId = record._id;
  });

  test('POST /api/payroll/process/:employeeId: Rejects non-existent employee', async () => {
    const { status, data } = await request('/api/payroll/process/UNKNOWN_EMP', {
      method: 'POST',
      body: { month: 5, year: 2026 }
    });

    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'NOT_FOUND');
  });

  test('GET /api/payroll/records: Queries persisted payroll records by employeeId', async () => {
    const { status, data } = await request(`/api/payroll/records?employeeId=${persistEmpId}`);

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data));
    assert.equal(data.data.length, 1);
    assert.equal(data.data[0].employeeId, persistEmpId);
    assert.equal(data.data[0].month, 5);
    assert.equal(data.data[0].year, 2026);
  });

  test('GET /api/payroll/records/:id: Retrieves specific salary slip by ID', async () => {
    assert.ok(savedRecordId);
    const { status, data } = await request(`/api/payroll/records/${savedRecordId}`);

    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data._id, savedRecordId);
    assert.equal(data.data.employeeId, persistEmpId);
  });

  test('GET /api/payroll/records/:id: Returns 404 for unknown record ID', async () => {
    const { status, data } = await request('/api/payroll/records/PAY_INVALID_999');

    assert.equal(status, 404);
    assert.equal(data.success, false);
    assert.equal(data.error.code, 'NOT_FOUND');
  });
});
