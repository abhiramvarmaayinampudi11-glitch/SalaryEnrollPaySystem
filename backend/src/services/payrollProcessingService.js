/**
 * Unified Payroll Processing Service
 * 
 * Orchestrates and integrates:
 * 1. Employee profile retrieval & eligibility validation
 * 2. Active salary revision / structure lookup
 * 3. Dynamic statutory rule resolution for the period
 * 4. Attendance proration & monthly payable salary calculation (Monthly Salary Engine)
 * 5. Independent statutory contributions (EPF, EPS, EDLI, ESIC, PT, TDS)
 * 6. Non-statutory deductions (Advance recovery, other deductions)
 * 7. Take-home net salary & isolated employer CTC calculation
 * 8. Period uniqueness and concurrency protection (Compound unique index)
 * 9. Status locking guard: Recalculation allowed ONLY in 'DRAFT' status; rejects 'FINALIZED'/'PAID' with 409 Conflict
 * 10. Concurrency transactions where supported by MongoDB, with atomic fallback
 */

const mongoose = require('mongoose');
const MonthlyPayroll = require('../models/MonthlyPayroll');
const Employee = require('../models/Employee');
const SalaryStructure = require('../models/SalaryStructure');
const { resolveApplicableRule } = require('../controllers/statutoryRuleController');
const { calculateStatutoryContributions } = require('./statutoryContributionEngine');
const { calculateProfessionalTax, estimateTds } = require('./ptAndTaxCalculator');
const { round2, safeSum } = require('../utils/mathUtils');
const inMemoryStore = require('./inMemoryStore');
const { isDbConnected } = require('../config/database');

/**
 * Processes and persists monthly payroll for a single employee.
 *
 * @param {Object} input
 * @param {string} input.employeeId - Employee identifier
 * @param {number} input.month - Payroll month (1-12)
 * @param {number} input.year - Payroll year (>= 2000)
 * @param {number} [input.workingDays=30] - Total calendar or scheduled working days
 * @param {number} [input.paidDays] - Paid working days
 * @param {number} [input.ncpDays=0] - Non-Contributing Period / unpaid leave days
 * @param {number} [input.overtimeHours=0] - Overtime hours worked
 * @param {number} [input.overtimeHourlyRate=0] - Hourly overtime rate
 * @param {number} [input.overtimeAmount=0] - Explicit overtime pay (overrides hours * rate)
 * @param {number} [input.bonus=0] - Performance bonus / incentive
 * @param {number} [input.advanceRecovery=0] - Salary advance / loan deduction
 * @param {number} [input.otherDeductions=0] - Other non-statutory deductions
 * @param {string} [input.prorationMethod='CALENDAR_DAYS'] - Proration method
 * @param {Object} [input.statutoryOptions={}] - Individual statutory options override
 * @param {Object} [input.configOverrides={}] - Rule configuration overrides
 * @param {string} [input.status='DRAFT'] - Initial record status ('DRAFT' | 'PROCESSED')
 * @param {string} [input.remarks=''] - Processing remarks
 * @param {Object} [options={}] - Processing options (e.g. forceRecalculate)
 * @returns {Promise<Object>} Detailed payroll breakdown and persisted MonthlyPayroll record
 */
async function processEmployeePayroll(input, options = {}) {
  // 1. Sanitize & Normalize Required Inputs
  const normalizedEmpId = String(input.employeeId || '').toUpperCase().trim();
  if (!normalizedEmpId) {
    const err = new Error('employeeId is required.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const month = Number(input.month);
  const year = Number(input.year);

  if (!month || isNaN(month) || month < 1 || month > 12) {
    const err = new Error('month is required and must be an integer between 1 and 12.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (!year || isNaN(year) || year < 2000) {
    const err = new Error('year is required and must be a valid 4-digit year >= 2000.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  // 2. Recalculation Guard: Verify existing record status
  // Recalculation is permitted ONLY if existing record is in 'DRAFT' status
  let existing = null;
  if (isDbConnected()) {
    existing = await MonthlyPayroll.findOne({
      employeeId: normalizedEmpId,
      month,
      year
    }).lean();
  } else {
    const key = `${normalizedEmpId}_${year}_${month}`;
    existing = inMemoryStore.payrollRecords.get(key) || null;
  }

  if (existing) {
    const currentStatus = existing.status || 'DRAFT';
    if (currentStatus !== 'DRAFT' && !options.forceRecalculate) {
      const lockError = new Error(
        `Recalculation rejected: Payroll record for employee ${normalizedEmpId} for period ${month}/${year} is locked in '${currentStatus}' status. Only records in 'DRAFT' status can be recalculated.`
      );
      lockError.status = 409;
      lockError.code = 'RECALCULATION_LOCKED';
      throw lockError;
    }
  }

  // 3. Retrieve Employee Profile
  let employee = null;
  if (isDbConnected()) {
    employee = await Employee.findOne({ employeeId: normalizedEmpId }).lean();
  } else {
    employee = inMemoryStore.findEmployee({ employeeId: normalizedEmpId });
  }

  if (!employee) {
    const notFoundError = new Error(`Employee with ID ${normalizedEmpId} not found. Please enroll employee first.`);
    notFoundError.status = 404;
    notFoundError.code = 'NOT_FOUND';
    throw notFoundError;
  }

  // 4. Retrieve Active Salary Structure / Revision
  let salaryStructure = null;
  if (isDbConnected()) {
    salaryStructure = await SalaryStructure.findOne({ employeeId: normalizedEmpId, isActive: true }).lean();
  } else {
    salaryStructure = inMemoryStore.findSalaryStructure(normalizedEmpId);
  }

  if (!salaryStructure) {
    const structureError = new Error(`Active salary structure not defined for employee ${normalizedEmpId}.`);
    structureError.status = 400;
    structureError.code = 'MISSING_SALARY_STRUCTURE';
    throw structureError;
  }

  // 5. Resolve Applicable Statutory Rule for the Payroll Period
  const periodDate = new Date(year, month - 1, 15);
  const applicableRule = await resolveApplicableRule(periodDate);

  if (!applicableRule) {
    const ruleError = new Error(
      `No applicable statutory rule found for payroll period ${month}/${year}. Please configure an effective statutory rule before running payroll.`
    );
    ruleError.status = 422;
    ruleError.code = 'NO_APPLICABLE_STATUTORY_RULE';
    throw ruleError;
  }

  // 6. Extract Attendance & Normalize NCP Days
  const workingDays = input.workingDays ?? input.attendance?.workingDays ?? input.attendance?.totalDays ?? 30;
  const paidDays = input.paidDays ?? input.attendance?.paidDays ?? input.attendance?.presentDays;
  const ncpDays = input.ncpDays ?? input.attendance?.ncpDays ?? input.attendance?.unpaidLeaveDays ?? 0;
  const overtimeHours = input.overtimeHours ?? input.attendance?.overtimeHours ?? 0;
  const overtimeHourlyRate = input.overtimeHourlyRate ?? input.attendance?.overtimeHourlyRate ?? 0;
  const overtimeAmount = input.overtimeAmount ?? input.attendance?.overtimeAmount ?? input.variablePay?.overtimeAmount ?? 0;
  const bonus = input.bonus ?? input.variablePay?.bonus ?? 0;
  const advanceRecovery = input.advanceRecovery ?? input.deductions?.advanceRecovery ?? 0;
  const otherDeductions = input.otherDeductions ?? input.deductions?.otherDeductions ?? 0;
  const prorationMethod = input.prorationMethod || 'CALENDAR_DAYS';
  const targetStatus = input.status || (existing ? existing.status : 'DRAFT');

  const totalDays = Math.max(1, Number(workingDays) || 30);
  let effectivePaidDays;
  let effectiveNcpDays;

  if (paidDays !== undefined && paidDays !== null) {
    effectivePaidDays = Math.max(0, Math.min(totalDays, Number(paidDays)));
    effectiveNcpDays = Math.max(0, totalDays - effectivePaidDays);
  } else {
    effectiveNcpDays = Math.max(0, Math.min(totalDays, Number(ncpDays) || 0));
    effectivePaidDays = Math.max(0, totalDays - effectiveNcpDays);
  }

  // Proration factor
  const prorationDivisor = prorationMethod === 'FIXED_30' ? 30 : totalDays;
  const prorationRatio = round2(effectivePaidDays / prorationDivisor);

  // 7. Base Earnings from Salary Structure (Nominal vs Attendance Payable)
  const nomBasic = Math.max(0, Number(salaryStructure.basic) || 0);
  const nomDa = Math.max(0, Number(salaryStructure.da) || 0);
  const nomHra = Math.max(0, Number(salaryStructure.hra) || 0);
  const nomConveyance = Math.max(0, Number(salaryStructure.conveyance) || 0);
  const nomSpecial = Math.max(0, Number(salaryStructure.specialAllowance) || 0);
  const nomOther = Math.max(0, Number(salaryStructure.otherAllowances) || 0);

  const totalNominalAllowances = safeSum(nomHra, nomConveyance, nomSpecial, nomOther);
  const nominalMonthlySalary = safeSum(nomBasic, nomDa, totalNominalAllowances);

  // Attendance-prorated components
  const earnedBasic = round2(nomBasic * prorationRatio);
  const earnedDa = round2(nomDa * prorationRatio);
  const earnedHra = round2(nomHra * prorationRatio);
  const earnedConveyance = round2(nomConveyance * prorationRatio);
  const earnedSpecial = round2(nomSpecial * prorationRatio);
  const earnedOther = round2(nomOther * prorationRatio);
  const totalEarnedAllowances = safeSum(earnedHra, earnedConveyance, earnedSpecial, earnedOther);

  const attendancePayableSalary = safeSum(earnedBasic, earnedDa, totalEarnedAllowances);
  // NCP Adjustment Amount is reported for audit transparency, NEVER double-deducted
  const ncpAdjustmentAmount = round2(Math.max(0, nominalMonthlySalary - attendancePayableSalary));

  // Overtime and Bonus calculation
  const resolvedOt = Number(overtimeAmount) > 0
    ? Number(overtimeAmount)
    : round2((Number(overtimeHours) || 0) * (Number(overtimeHourlyRate) || 0));
  const earnedBonus = Math.max(0, Number(bonus) || 0);

  // Gross Earnings = Basic + DA + Allowances + OT + Bonus
  const grossEarnings = safeSum(attendancePayableSalary, resolvedOt, earnedBonus);

  // 8. Individual Statutory Eligibility Evaluation
  let age = input.age || employee.age;
  if (!age && employee.dateOfBirth) {
    const dob = new Date(employee.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      age = Math.floor((periodDate - dob) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }

  // EPS ceases at age 58 under EPFO regulations
  let isEpsEligible = true;
  if (age !== null && age !== undefined && Number(age) >= 58) {
    isEpsEligible = false;
  } else if (input.statutoryOptions?.isEpsEligible !== undefined) {
    isEpsEligible = input.statutoryOptions.isEpsEligible;
  } else if (employee.isEpsEligible !== undefined) {
    isEpsEligible = employee.isEpsEligible;
  }

  const isPfEligible = input.statutoryOptions?.pfEligible ?? input.statutoryOptions?.isPfEligible ?? employee.pfEligible ?? true;
  const capPfAtWageCeiling = input.statutoryOptions?.capPfAtWageCeiling ?? employee.capPfAtWageCeiling ?? true;
  const isEsicEligible = input.statutoryOptions?.esicEligible ?? input.statutoryOptions?.isEsicEligible ?? employee.esicEligible ?? null;
  const hasDisability = Boolean(input.statutoryOptions?.hasDisability ?? employee.hasDisability);
  const stateForPt = input.statutoryOptions?.stateForPt ?? employee.stateForPt ?? 'DEFAULT';

  // 9. Statutory Calculations via Dedicated Engine
  const statutoryBreakdown = await calculateStatutoryContributions({
    employeeId: normalizedEmpId,
    age,
    isPfEligible,
    isEpsEligible,
    isEdliEligible: employee.isEdliEligible !== undefined ? employee.isEdliEligible : true,
    capPfAtWageCeiling,
    voluntaryPfRate: employee.voluntaryPfRate || null,
    isEsicEligible,
    hasDisability,
    workingDays: totalDays,
    paidDays: effectivePaidDays,
    ncpDays: effectiveNcpDays,
    basicSalary: nomBasic,
    da: nomDa,
    allowances: {
      hra: nomHra,
      conveyance: nomConveyance,
      specialAllowance: nomSpecial,
      otherAllowances: nomOther
    },
    overtimeAmount: resolvedOt,
    bonus: earnedBonus,
    payrollDate: periodDate,
    customRule: applicableRule
  });

  const employeePf = statutoryBreakdown.employeeDeductions?.epf || 0;
  const employerEpf = statutoryBreakdown.employerContributions?.pf?.epf || 0;
  const employerEps = statutoryBreakdown.employerContributions?.pf?.eps || 0;
  const employerEdli = statutoryBreakdown.employerContributions?.pf?.edli || 0;
  const employerAdminCharges = statutoryBreakdown.employerContributions?.pf?.adminCharges || 0;
  const totalEmployerPf = statutoryBreakdown.employerContributions?.pf?.total || round2(employerEpf + employerEps + employerEdli + employerAdminCharges);

  const employeeEsic = statutoryBreakdown.employeeDeductions?.esic || 0;
  const employerEsic = statutoryBreakdown.employerContributions?.esic?.employerEsic || 0;
  const totalEmployerEsic = statutoryBreakdown.employerContributions?.esic?.total || employerEsic;
  const totalEmployerContributions = statutoryBreakdown.employerContributions?.totalEmployerContributions || safeSum(totalEmployerPf, totalEmployerEsic);

  // 10. Professional Tax & TDS Calculation
  const ptResult = calculateProfessionalTax(grossEarnings, stateForPt, {
    month,
    gender: employee.gender || 'MALE'
  });
  const professionalTax = ptResult.taxAmount || 0;

  const enableTds = Boolean(employee.enableTds || input.enableTds || input.statutoryOptions?.enableTds);
  let tds = 0;
  let tdsDetails = null;
  if (enableTds) {
    tdsDetails = estimateTds(grossEarnings, 0);
    tds = tdsDetails.monthlyTds || 0;
  }

  // 11. Deductions Breakdown & Net Take-Home Salary
  const numAdvance = Math.max(0, Number(advanceRecovery) || 0);
  const numOtherDeductions = Math.max(0, Number(otherDeductions) || 0);

  const totalDeductions = safeSum(
    employeePf,
    employeeEsic,
    professionalTax,
    tds,
    numAdvance,
    numOtherDeductions
  );

  const netSalary = round2(Math.max(0, grossEarnings - totalDeductions));

  // 12. Employer CTC (Cost to Company) Isolation
  // Employer contributions are NEVER deducted from employee net salary
  const monthlyCtc = round2(grossEarnings + totalEmployerContributions);
  const annualizedCtc = round2(monthlyCtc * 12);

  // 13. Build Complete MonthlyPayroll Record Payload
  const employeeName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.name || normalizedEmpId;
  const version = existing ? (existing.version || 1) + 1 : 1;
  const recalculatedAt = existing ? new Date() : null;

  const recordPayload = {
    employee: employee._id,
    employeeId: normalizedEmpId,
    employeeName,
    department: employee.department || '',
    designation: employee.designation || '',
    month,
    year,

    attendance: {
      workingDays: totalDays,
      paidDays: effectivePaidDays,
      ncpDays: effectiveNcpDays,
      prorationRatio,
      overtimeHours: Number(overtimeHours) || 0,
      overtimeHourlyRate: Number(overtimeHourlyRate) || 0,
      overtimeAmount: resolvedOt,
      doubleNcpDeductionPrevented: true,
      totalDays,
      presentDays: effectivePaidDays,
      unpaidLeaveDays: effectiveNcpDays
    },

    salaryComparison: {
      nominalMonthlySalary,
      attendancePayableSalary,
      ncpAdjustmentAmount
    },

    earnings: {
      basic: earnedBasic,
      da: earnedDa,
      hra: earnedHra,
      conveyance: earnedConveyance,
      specialAllowance: earnedSpecial,
      otherAllowances: earnedOther,
      totalAllowances: totalEarnedAllowances,
      overtimeAmount: resolvedOt,
      bonus: earnedBonus,
      grossEarnings,
      grossSalary: grossEarnings
    },

    deductions: {
      employeePf,
      employeeEsic,
      professionalTax,
      tds,
      advanceRecovery: numAdvance,
      otherDeductions: numOtherDeductions,
      totalDeductions
    },

    netSalary,

    employerContributions: {
      pf: {
        epf: employerEpf,
        eps: employerEps,
        edli: employerEdli,
        adminCharges: employerAdminCharges,
        total: totalEmployerPf
      },
      esic: {
        employerEsic,
        total: employerEsic
      },
      totalEmployerContributions,
      totalEmployerContribution: totalEmployerContributions
    },

    costToCompany: {
      monthlyCtc,
      annualizedCtc
    },

    statutoryDetails: {
      pf: {
        pfWageSubjectToEpf: statutoryBreakdown.wageBreakdown?.pfWageSubjectToEpf ?? 0,
        pfWageSubjectToEps: statutoryBreakdown.wageBreakdown?.epsWages ?? 0,
        employeeContribution: employeePf,
        employerContribution: {
          epf: employerEpf,
          eps: employerEps,
          edli: employerEdli,
          adminCharges: employerAdminCharges,
          total: totalEmployerPf
        },
        ...statutoryBreakdown.eligibilitySummary
      },
      esic: {
        grossWages,
        esicWages: statutoryBreakdown.wageBreakdown?.esicWages ?? grossEarnings,
        employeeContribution: employeeEsic,
        employerContribution: employerEsic,
        isEligible: statutoryBreakdown.eligibilitySummary?.isEsicCovered ?? false
      },
      pt: ptResult,
      tds: tdsDetails,
      statutoryBreakdown
    },

    statutoryRuleSnapshot: {
      ...statutoryBreakdown.ruleSnapshot,
      appliedAt: statutoryBreakdown.ruleSnapshot?.appliedAt || new Date().toISOString()
    },
    status: targetStatus,
    version,
    recalculatedAt,
    remarks: input.remarks || ''
  };

  // 14. Persistence with Concurrency Protection & Transactions
  if (isDbConnected()) {
    let savedRecord;
    let session = null;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_) {
      // Replica set transaction not available (e.g. standalone MongoDB instance)
      session = null;
    }

    try {
      if (existing) {
        // Enforce concurrency lock: record must still be in 'DRAFT' status
        savedRecord = await MonthlyPayroll.findOneAndUpdate(
          { _id: existing._id, status: 'DRAFT' },
          recordPayload,
          { new: true, session: session || undefined }
        );

        if (!savedRecord) {
          const lockErr = new Error(
            `Recalculation conflict: Payroll record for employee ${normalizedEmpId} for period ${month}/${year} is no longer in 'DRAFT' status.`
          );
          lockErr.status = 409;
          lockErr.code = 'RECALCULATION_LOCKED';
          throw lockErr;
        }
      } else {
        if (session) {
          const created = await MonthlyPayroll.create([recordPayload], { session });
          savedRecord = created[0];
        } else {
          savedRecord = await MonthlyPayroll.create(recordPayload);
        }
      }

      if (session) await session.commitTransaction();
    } catch (dbErr) {
      if (session) {
        try { await session.abortTransaction(); } catch (_) {}
      }

      // MongoDB Unique Index Violation ({ employeeId, month, year })
      if (dbErr.code === 11000) {
        const dupErr = new Error(
          `Duplicate payroll record: A record already exists for employee ${normalizedEmpId} for period ${month}/${year}.`
        );
        dupErr.status = 409;
        dupErr.code = 'DUPLICATE_ENTITY';
        throw dupErr;
      }
      throw dbErr;
    } finally {
      if (session) {
        try { await session.endSession(); } catch (_) {}
      }
    }

    return {
      record: savedRecord,
      isRecalculation: Boolean(existing)
    };
  }

  // In-Memory Fallback Persistence
  const savedMemRecord = inMemoryStore.savePayrollRecord(recordPayload, options);
  return {
    record: savedMemRecord,
    isRecalculation: Boolean(existing)
  };
}

/**
 * Batch processes monthly payroll for multiple employees.
 *
 * @param {Object} batchInput
 * @param {Array<Object>} batchInput.employees - Array of employee payroll input objects
 * @param {number} [batchInput.month] - Default month if not specified in employee object
 * @param {number} [batchInput.year] - Default year if not specified in employee object
 * @param {number} [batchInput.workingDays=30] - Default working days
 * @param {Object} [options={}] - Processing options
 * @returns {Promise<Object>} Batch processing summary with successful and failed records
 */
async function processPayrollBatch(batchInput, options = {}) {
  const { employees = [], month, year, workingDays = 30 } = batchInput;

  if (!Array.isArray(employees) || employees.length === 0) {
    const err = new Error('employees must be a non-empty array of employee payroll records.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const results = {
    total: employees.length,
    processed: 0,
    successful: [],
    failed: []
  };

  for (const empItem of employees) {
    const mergedInput = {
      month,
      year,
      workingDays,
      ...empItem
    };

    try {
      const outcome = await processEmployeePayroll(mergedInput, options);
      results.successful.push({
        employeeId: outcome.record.employeeId,
        recordId: outcome.record._id,
        grossEarnings: outcome.record.earnings.grossEarnings,
        netSalary: outcome.record.netSalary,
        status: outcome.record.status,
        version: outcome.record.version,
        isRecalculation: outcome.isRecalculation
      });
      results.processed += 1;
    } catch (err) {
      results.failed.push({
        employeeId: empItem.employeeId || 'UNKNOWN',
        error: err.message,
        code: err.code || 'PROCESSING_ERROR',
        status: err.status || 500
      });
    }
  }

  return results;
}

/**
 * Updates the workflow status of a payroll record.
 * Transitions between: 'DRAFT' -> 'PROCESSED' -> 'FINALIZED' -> 'PAID'
 *
 * @param {string} recordId - Payroll record identifier
 * @param {string} newStatus - Target status
 * @returns {Promise<Object>} Updated payroll record
 */
async function updatePayrollStatus(recordId, newStatus) {
  const validStatuses = ['DRAFT', 'PROCESSED', 'FINALIZED', 'PAID'];
  const upperStatus = String(newStatus || '').toUpperCase().trim();

  if (!validStatuses.includes(upperStatus)) {
    const err = new Error(`Invalid status '${newStatus}'. Allowed statuses: ${validStatuses.join(', ')}.`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (isDbConnected()) {
    const updated = await MonthlyPayroll.findByIdAndUpdate(
      recordId,
      { status: upperStatus },
      { new: true }
    );

    if (!updated) {
      const err = new Error(`Payroll record not found with ID: ${recordId}`);
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    return updated;
  }

  const updatedMem = inMemoryStore.updatePayrollStatus(recordId, upperStatus);
  if (!updatedMem) {
    const err = new Error(`Payroll record not found with ID: ${recordId}`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  return updatedMem;
}

module.exports = {
  processEmployeePayroll,
  processPayrollBatch,
  updatePayrollStatus
};
