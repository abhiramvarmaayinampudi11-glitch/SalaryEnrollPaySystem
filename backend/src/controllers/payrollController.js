/**
 * Payroll Controller
 * Handles incoming REST requests for payroll, PF, ESIC, tax, gratuity,
 * monthly salary calculations, statutory contribution engine, and payroll record persistence.
 */

const { calculatePayroll } = require('../services/payrollCalculator');
const { calculateMonthlySalary } = require('../services/monthlySalaryCalculator');
const { calculateStatutoryContributions } = require('../services/statutoryContributionEngine');
const { calculatePf } = require('../services/pfCalculator');
const { calculateEsic } = require('../services/esicCalculator');
const { calculateProfessionalTax, estimateGratuity, estimateTds } = require('../services/ptAndTaxCalculator');
const { resolveApplicableRule } = require('./statutoryRuleController');
const {
  processEmployeePayroll,
  processPayrollBatch,
  updatePayrollStatus
} = require('../services/payrollProcessingService');
const PayrollRecord = require('../models/PayrollRecord');
const Employee = require('../models/Employee');
const SalaryStructure = require('../models/SalaryStructure');
const inMemoryStore = require('../services/inMemoryStore');
const { isDbConnected } = require('../config/database');

/**
 * POST /api/payroll/statutory/calculate
 * Separate Statutory Contribution Calculation Engine endpoint.
 * Calculates Employee EPF & ESIC, Employer EPF, EPS, EDLI, and Employer ESIC independently.
 * Fetches dynamic rules from MongoDB/In-Memory store, respects employee eligibility & age,
 * and maintains immutable rule snapshot.
 */
async function calculateStatutoryContributionsEndpoint(req, res, next) {
  try {
    const result = await calculateStatutoryContributions(req.body);

    return res.status(200).json({
      success: true,
      message: 'Statutory contributions and compliance breakdown calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/monthly-salary/calculate
 * Reusable Monthly Salary Calculation Engine
 * Gross = Basic Pay + Allowances + OT + Bonus
 * Total Deductions = Employee PF + Employee ESIC + Advance Recovery + Other Deductions (+ PT + TDS)
 * Net = Gross - Total Deductions
 */
async function calculateMonthlySalaryEndpoint(req, res, next) {
  try {
    const result = calculateMonthlySalary(req.body);

    return res.status(200).json({
      success: true,
      message: 'Monthly salary breakdown calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/calculate
 * Pure in-memory calculation of an employee's monthly payroll breakdown.
 */
async function calculateFullPayroll(req, res, next) {
  try {
    const {
      salaryStructure,
      attendance,
      variablePay,
      statutoryOptions,
      configOverrides,
      effectiveDate,
      month,
      year
    } = req.body;

    let resolvedOverrides = { ...(configOverrides || {}) };

    let targetDate = null;
    if (effectiveDate) targetDate = new Date(effectiveDate);
    else if (month && year) targetDate = new Date(Number(year), Number(month) - 1, 15);

    if (targetDate && !isNaN(targetDate.getTime())) {
      const applicableRule = await resolveApplicableRule(targetDate);
      if (applicableRule) {
        resolvedOverrides = {
          pf: applicableRule.pf,
          esic: applicableRule.esic,
          pt: applicableRule.pt,
          ...resolvedOverrides
        };
      }
    }

    const result = calculatePayroll({
      salaryStructure,
      attendance,
      variablePay,
      statutoryOptions,
      configOverrides: resolvedOverrides
    });

    return res.status(200).json({
      success: true,
      message: 'Monthly payroll calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/process
 * Unified monthly payroll processing endpoint.
 * Accepts single employee payload or batch employees array.
 * Retrieves employee, active salary structure, resolves applicable statutory rules,
 * computes attendance proration, gross, independent statutory contributions (EPF, EPS, EDLI, ESIC),
 * non-statutory deductions, net salary, and isolated employer CTC.
 * Enforces period uniqueness and allows recalculation ONLY in 'DRAFT' status.
 */
async function processPayrollEndpoint(req, res, next) {
  try {
    const { employees } = req.body || {};

    if (Array.isArray(employees) && employees.length > 0) {
      const batchResult = await processPayrollBatch(req.body);
      return res.status(200).json({
        success: true,
        message: `Batch payroll processing completed. Processed ${batchResult.processed} of ${batchResult.total} employees.`,
        data: batchResult
      });
    }

    const outcome = await processEmployeePayroll(req.body);
    const statusCode = outcome.isRecalculation ? 200 : 201;
    const message = outcome.isRecalculation
      ? `Payroll for ${outcome.record.employeeId} for period ${outcome.record.month}/${outcome.record.year} recalculated successfully (Version ${outcome.record.version}).`
      : `Payroll for ${outcome.record.employeeId} for period ${outcome.record.month}/${outcome.record.year} processed and saved successfully.`;

    return res.status(statusCode).json({
      success: true,
      message,
      data: outcome.record,
      isRecalculation: outcome.isRecalculation
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/process/:employeeId
 * Processes monthly payroll for an enrolled employee via URL parameter (backwards compatibility).
 */
async function processAndSavePayroll(req, res, next) {
  try {
    const payload = {
      ...req.body,
      employeeId: req.params.employeeId
    };
    const outcome = await processEmployeePayroll(payload);
    const statusCode = outcome.isRecalculation ? 200 : 201;

    return res.status(statusCode).json({
      success: true,
      message: `Payroll for ${outcome.record.employeeId} for period ${outcome.record.month}/${outcome.record.year} processed and saved successfully.`,
      data: outcome.record,
      isRecalculation: outcome.isRecalculation
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * PATCH /api/payroll/records/:id/status
 * Updates workflow status of a payroll record ('DRAFT' -> 'PROCESSED' -> 'FINALIZED' -> 'PAID').
 * Records in 'FINALIZED' or 'PAID' status are locked against recalculation.
 */
async function updatePayrollStatusEndpoint(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await updatePayrollStatus(id, status);

    return res.status(200).json({
      success: true,
      message: `Payroll record ${id} status updated to '${updated.status}' successfully.`,
      data: updated
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/payroll/records
 * Query historical payroll records with filters.
 */
async function getPayrollRecords(req, res, next) {
  try {
    const { employeeId, month, year } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (employeeId) filter.employeeId = employeeId.toUpperCase().trim();
      if (month) filter.month = Number(month);
      if (year) filter.year = Number(year);

      const records = await PayrollRecord.find(filter).sort({ year: -1, month: -1 }).lean();
      return res.status(200).json({
        success: true,
        count: records.length,
        data: records
      });
    }

    const records = inMemoryStore.findPayrollRecords({ employeeId, month, year });
    return res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/payroll/records/:id
 * Retrieve a specific payroll record / salary slip by ID.
 */
async function getPayrollRecordById(req, res, next) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      let record = null;
      if (id.match(/^[0-9a-fA-F]{24}$/)) {
        record = await PayrollRecord.findById(id).lean();
      }
      if (!record) {
        record = await PayrollRecord.findOne({ _id: id }).lean();
      }

      if (!record) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Payroll record not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: record
      });
    }

    const record = inMemoryStore.findPayrollRecordById(id);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Payroll record not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: record
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/pf/calculate
 * Calculate PF, EPS, EDLI and employer contributions
 */
async function calculatePfEndpoint(req, res, next) {
  try {
    const { earnedBasic, earnedDa = 0, options = {} } = req.body;
    const result = calculatePf(earnedBasic, earnedDa, options);

    return res.status(200).json({
      success: true,
      message: 'PF contributions and statutory breakdown calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/esic/calculate
 * Calculate ESIC employee and employer contributions
 */
async function calculateEsicEndpoint(req, res, next) {
  try {
    const { grossWages, workingDays = 30, presentDays = 30, options = {} } = req.body;
    const result = calculateEsic(grossWages, workingDays, presentDays, options);

    return res.status(200).json({
      success: true,
      message: 'ESIC contributions and eligibility calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/tax/calculate
 * Calculate Professional Tax and applicable TDS estimates
 */
async function calculateTaxEndpoint(req, res, next) {
  try {
    const {
      monthlyGrossSalary,
      state = 'DEFAULT',
      month,
      gender = 'MALE',
      enableTds = false,
      otherAnnualIncome = 0,
      customConfig = {}
    } = req.body;

    const ptResult = calculateProfessionalTax(monthlyGrossSalary, state, {
      month,
      gender,
      customConfig
    });

    let tdsResult = null;
    if (enableTds) {
      tdsResult = estimateTds(monthlyGrossSalary, otherAnnualIncome, { customConfig });
    }

    return res.status(200).json({
      success: true,
      message: 'Tax calculations and estimates generated successfully.',
      data: {
        professionalTax: ptResult,
        tds: tdsResult
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/payroll/gratuity/calculate
 * Calculate gratuity estimate under Payment of Gratuity Act
 */
async function calculateGratuityEndpoint(req, res, next) {
  try {
    const {
      lastDrawnBasic,
      lastDrawnDa = 0,
      completedYears,
      options = {}
    } = req.body;

    const result = estimateGratuity(lastDrawnBasic, lastDrawnDa, completedYears, options);

    return res.status(200).json({
      success: true,
      message: 'Gratuity estimate calculated successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  calculateStatutoryContributionsEndpoint,
  calculateMonthlySalaryEndpoint,
  calculateFullPayroll,
  processPayrollEndpoint,
  processAndSavePayroll,
  updatePayrollStatusEndpoint,
  getPayrollRecords,
  getPayrollRecordById,
  calculatePfEndpoint,
  calculateEsicEndpoint,
  calculateTaxEndpoint,
  calculateGratuityEndpoint
};
