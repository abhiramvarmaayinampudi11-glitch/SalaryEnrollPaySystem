/**
 * Request Validation Middleware for Payroll, Employee, and Statutory Rules API Endpoints
 * Validates types, required fields, numeric constraints, and business logic invariants.
 */

/**
 * Creates a standardized 400 Validation Error.
 */
function createValidationError(res, path, details) {
  return res.status(400).json({
    success: false,
    error: {
      message: 'Validation failed: Invalid or missing request parameters.',
      status: 400,
      code: 'VALIDATION_ERROR',
      details,
      timestamp: new Date().toISOString(),
      path
    }
  });
}

/**
 * Validates POST /api/payroll/statutory/calculate
 */
function validateCalculateStatutoryContributions(req, res, next) {
  const errors = [];
  const {
    workingDays,
    paidDays,
    ncpDays,
    basicSalary,
    da,
    overtimeAmount,
    bonus,
    pfWages,
    esicWages,
    age
  } = req.body || {};

  if (age !== undefined && age !== null && (typeof age !== 'number' || age < 14 || age > 100)) {
    errors.push('age must be a reasonable number between 14 and 100 if provided.');
  }

  const effectiveWorkingDays = workingDays !== undefined ? workingDays : 30;
  if (workingDays !== undefined && (typeof workingDays !== 'number' || isNaN(workingDays) || workingDays <= 0 || workingDays > 31)) {
    errors.push('workingDays must be a positive number between 1 and 31.');
  }

  if (paidDays !== undefined && (typeof paidDays !== 'number' || isNaN(paidDays) || paidDays < 0 || paidDays > effectiveWorkingDays)) {
    errors.push(`paidDays must be between 0 and workingDays (${effectiveWorkingDays}).`);
  }

  if (ncpDays !== undefined && (typeof ncpDays !== 'number' || isNaN(ncpDays) || ncpDays < 0 || ncpDays > effectiveWorkingDays)) {
    errors.push(`ncpDays must be between 0 and workingDays (${effectiveWorkingDays}).`);
  }

  const numericFields = [
    { name: 'basicSalary', val: basicSalary },
    { name: 'da', val: da },
    { name: 'overtimeAmount', val: overtimeAmount },
    { name: 'bonus', val: bonus },
    { name: 'pfWages', val: pfWages },
    { name: 'esicWages', val: esicWages }
  ];

  for (const field of numericFields) {
    if (field.val !== undefined && field.val !== null && (typeof field.val !== 'number' || isNaN(field.val) || field.val < 0)) {
      errors.push(`${field.name} must be a non-negative number if provided.`);
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/monthly-salary/calculate
 */
function validateCalculateMonthlySalary(req, res, next) {
  const errors = [];
  const {
    monthlyBasicSalary,
    workingDays,
    paidDays,
    ncpDays,
    allowances,
    overtimeHours,
    overtimeAmount,
    overtimeHourlyRate,
    bonus,
    advanceRecovery,
    otherDeductions,
    pfWages,
    esicWages,
    prorationMethod
  } = req.body || {};

  if (monthlyBasicSalary !== undefined && (typeof monthlyBasicSalary !== 'number' || isNaN(monthlyBasicSalary) || monthlyBasicSalary < 0)) {
    errors.push('monthlyBasicSalary must be a non-negative number.');
  }

  const effectiveWorkingDays = workingDays !== undefined ? workingDays : 30;
  if (workingDays !== undefined && (typeof workingDays !== 'number' || isNaN(workingDays) || workingDays <= 0 || workingDays > 31)) {
    errors.push('workingDays must be a positive number between 1 and 31.');
  }

  if (paidDays !== undefined) {
    if (typeof paidDays !== 'number' || isNaN(paidDays) || paidDays < 0) {
      errors.push('paidDays must be a non-negative number.');
    } else if (typeof effectiveWorkingDays === 'number' && paidDays > effectiveWorkingDays) {
      errors.push(`paidDays (${paidDays}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (ncpDays !== undefined) {
    if (typeof ncpDays !== 'number' || isNaN(ncpDays) || ncpDays < 0) {
      errors.push('ncpDays must be a non-negative number.');
    } else if (typeof effectiveWorkingDays === 'number' && ncpDays > effectiveWorkingDays) {
      errors.push(`ncpDays (${ncpDays}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (paidDays !== undefined && ncpDays !== undefined) {
    if (paidDays + ncpDays > effectiveWorkingDays) {
      errors.push(`The sum of paidDays (${paidDays}) and ncpDays (${ncpDays}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (allowances !== undefined && typeof allowances !== 'object' && typeof allowances !== 'number') {
    errors.push('allowances must be an object or a positive number.');
  }

  const nonNegativeFields = [
    { name: 'overtimeHours', val: overtimeHours },
    { name: 'overtimeAmount', val: overtimeAmount },
    { name: 'overtimeHourlyRate', val: overtimeHourlyRate },
    { name: 'bonus', val: bonus },
    { name: 'advanceRecovery', val: advanceRecovery },
    { name: 'otherDeductions', val: otherDeductions },
    { name: 'pfWages', val: pfWages },
    { name: 'esicWages', val: esicWages }
  ];

  for (const field of nonNegativeFields) {
    if (field.val !== undefined && field.val !== null && (typeof field.val !== 'number' || isNaN(field.val) || field.val < 0)) {
      errors.push(`${field.name} must be a non-negative number.`);
    }
  }

  if (prorationMethod !== undefined) {
    const validMethods = ['CALENDAR_DAYS', 'FIXED_30', 'ACTUAL_WORKING_DAYS'];
    if (!validMethods.includes(prorationMethod)) {
      errors.push(`prorationMethod must be one of: ${validMethods.join(', ')}.`);
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/statutory-rules
 */
function validateCreateStatutoryRule(req, res, next) {
  const errors = [];
  const { ruleCode, effectiveFrom, effectiveTo, pf, esic } = req.body || {};

  if (!ruleCode || typeof ruleCode !== 'string' || ruleCode.trim().length === 0) {
    errors.push('ruleCode is required and must be a non-empty string.');
  }

  if (!effectiveFrom) {
    errors.push('effectiveFrom is required (ISO 8601 Date string, e.g. YYYY-MM-DD).');
  } else if (isNaN(Date.parse(effectiveFrom))) {
    errors.push('effectiveFrom must be a valid date.');
  }

  if (effectiveTo && isNaN(Date.parse(effectiveTo))) {
    errors.push('effectiveTo must be a valid date if provided.');
  }

  if (effectiveFrom && effectiveTo && !isNaN(Date.parse(effectiveFrom)) && !isNaN(Date.parse(effectiveTo))) {
    if (new Date(effectiveTo) < new Date(effectiveFrom)) {
      errors.push('effectiveTo date cannot be earlier than effectiveFrom date.');
    }
  }

  if (pf !== undefined) {
    if (typeof pf !== 'object' || Array.isArray(pf)) {
      errors.push('pf must be an object if provided.');
    } else {
      if (pf.employeeRate !== undefined && (typeof pf.employeeRate !== 'number' || pf.employeeRate < 0 || pf.employeeRate > 1)) {
        errors.push('pf.employeeRate must be a number between 0 and 1 (e.g. 0.12).');
      }
      if (pf.wageCeiling !== undefined && (typeof pf.wageCeiling !== 'number' || pf.wageCeiling < 0)) {
        errors.push('pf.wageCeiling must be a non-negative number.');
      }
      if (pf.epsMaxCap !== undefined && (typeof pf.epsMaxCap !== 'number' || pf.epsMaxCap < 0)) {
        errors.push('pf.epsMaxCap must be a non-negative number.');
      }
    }
  }

  if (esic !== undefined) {
    if (typeof esic !== 'object' || Array.isArray(esic)) {
      errors.push('esic must be an object if provided.');
    } else {
      if (esic.wageLimit !== undefined && (typeof esic.wageLimit !== 'number' || esic.wageLimit < 0)) {
        errors.push('esic.wageLimit must be a non-negative number.');
      }
      if (esic.employeeRate !== undefined && (typeof esic.employeeRate !== 'number' || esic.employeeRate < 0 || esic.employeeRate > 1)) {
        errors.push('esic.employeeRate must be a number between 0 and 1 (e.g. 0.0075).');
      }
      if (esic.employerRate !== undefined && (typeof esic.employerRate !== 'number' || esic.employerRate < 0 || esic.employerRate > 1)) {
        errors.push('esic.employerRate must be a number between 0 and 1 (e.g. 0.0325).');
      }
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/employees
 */
function validateCreateEmployee(req, res, next) {
  const errors = [];
  const { employeeId, firstName, lastName, email, salaryStructure } = req.body || {};

  if (!employeeId || typeof employeeId !== 'string' || employeeId.trim().length === 0) {
    errors.push('employeeId is required and must be a non-empty string.');
  }

  if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
    errors.push('firstName is required and must be a non-empty string.');
  }

  if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
    errors.push('lastName is required and must be a non-empty string.');
  }

  const emailRegex = /\S+@\S+\.\S+/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
    errors.push('email is required and must be a valid email address.');
  }

  if (salaryStructure !== undefined) {
    if (typeof salaryStructure !== 'object' || Array.isArray(salaryStructure)) {
      errors.push('salaryStructure must be an object if provided.');
    } else {
      if (salaryStructure.basic === undefined || salaryStructure.basic === null) {
        errors.push('salaryStructure.basic is required if salaryStructure is provided.');
      } else if (typeof salaryStructure.basic !== 'number' || isNaN(salaryStructure.basic) || salaryStructure.basic < 0) {
        errors.push('salaryStructure.basic must be a non-negative number.');
      }
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/calculate
 */
function validateCalculatePayroll(req, res, next) {
  const errors = [];
  const { salaryStructure, attendance, variablePay, statutoryOptions } = req.body || {};

  if (!salaryStructure || typeof salaryStructure !== 'object' || Array.isArray(salaryStructure)) {
    errors.push('salaryStructure is required and must be an object.');
  } else {
    if (salaryStructure.basic === undefined || salaryStructure.basic === null) {
      errors.push('salaryStructure.basic is required.');
    } else if (typeof salaryStructure.basic !== 'number' || isNaN(salaryStructure.basic) || salaryStructure.basic < 0) {
      errors.push('salaryStructure.basic must be a non-negative number.');
    }

    const optionalNumericFields = ['da', 'hra', 'conveyance', 'specialAllowance', 'otherAllowances'];
    for (const field of optionalNumericFields) {
      if (salaryStructure[field] !== undefined && (typeof salaryStructure[field] !== 'number' || isNaN(salaryStructure[field]) || salaryStructure[field] < 0)) {
        errors.push(`salaryStructure.${field} must be a non-negative number if provided.`);
      }
    }
  }

  if (attendance !== undefined) {
    if (typeof attendance !== 'object' || Array.isArray(attendance)) {
      errors.push('attendance must be an object if provided.');
    } else {
      const totalDays = attendance.totalDays !== undefined ? attendance.totalDays : 30;
      if (typeof totalDays !== 'number' || isNaN(totalDays) || totalDays <= 0 || totalDays > 31) {
        errors.push('attendance.totalDays must be a positive number between 1 and 31.');
      }

      if (attendance.presentDays !== undefined) {
        if (typeof attendance.presentDays !== 'number' || isNaN(attendance.presentDays) || attendance.presentDays < 0) {
          errors.push('attendance.presentDays must be a non-negative number.');
        } else if (typeof totalDays === 'number' && attendance.presentDays > totalDays) {
          errors.push(`attendance.presentDays (${attendance.presentDays}) cannot exceed totalDays (${totalDays}).`);
        }
      }

      const numericAttendanceFields = ['paidLeaveDays', 'unpaidLeaveDays', 'overtimeHours', 'overtimeHourlyRate'];
      for (const field of numericAttendanceFields) {
        if (attendance[field] !== undefined && (typeof attendance[field] !== 'number' || isNaN(attendance[field]) || attendance[field] < 0)) {
          errors.push(`attendance.${field} must be a non-negative number if provided.`);
        }
      }
    }
  }

  if (variablePay !== undefined) {
    if (typeof variablePay !== 'object' || Array.isArray(variablePay)) {
      errors.push('variablePay must be an object if provided.');
    } else {
      const numericVariableFields = ['bonus', 'incentives', 'arrears', 'otherEarnings'];
      for (const field of numericVariableFields) {
        if (variablePay[field] !== undefined && (typeof variablePay[field] !== 'number' || isNaN(variablePay[field]) || variablePay[field] < 0)) {
          errors.push(`variablePay.${field} must be a non-negative number if provided.`);
        }
      }
    }
  }

  if (statutoryOptions !== undefined) {
    if (typeof statutoryOptions !== 'object' || Array.isArray(statutoryOptions)) {
      errors.push('statutoryOptions must be an object if provided.');
    } else {
      if (statutoryOptions.customDeductions !== undefined && (typeof statutoryOptions.customDeductions !== 'number' || isNaN(statutoryOptions.customDeductions) || statutoryOptions.customDeductions < 0)) {
        errors.push('statutoryOptions.customDeductions must be a non-negative number if provided.');
      }
      if (statutoryOptions.customTds !== undefined && (typeof statutoryOptions.customTds !== 'number' || isNaN(statutoryOptions.customTds) || statutoryOptions.customTds < 0)) {
        errors.push('statutoryOptions.customTds must be a non-negative number if provided.');
      }
      if (statutoryOptions.ptMonth !== undefined && (!Number.isInteger(statutoryOptions.ptMonth) || statutoryOptions.ptMonth < 1 || statutoryOptions.ptMonth > 12)) {
        errors.push('statutoryOptions.ptMonth must be an integer between 1 and 12.');
      }
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/process/:employeeId
 */
function validateProcessPayroll(req, res, next) {
  const errors = [];
  const { month, year, attendance } = req.body || {};

  if (month === undefined || month === null || !Number.isInteger(month) || month < 1 || month > 12) {
    errors.push('month is required and must be an integer between 1 and 12.');
  }

  if (year === undefined || year === null || !Number.isInteger(year) || year < 2000) {
    errors.push('year is required and must be an integer (e.g. 2026).');
  }

  if (attendance !== undefined) {
    const totalDays = attendance.totalDays !== undefined ? attendance.totalDays : 30;
    if (attendance.presentDays !== undefined && attendance.presentDays > totalDays) {
      errors.push(`attendance.presentDays (${attendance.presentDays}) cannot exceed totalDays (${totalDays}).`);
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/process (Unified single & batch payroll processing)
 */
function validateProcessPayrollPayload(req, res, next) {
  const errors = [];
  const body = req.body || {};

  if (body.employees !== undefined) {
    if (!Array.isArray(body.employees) || body.employees.length === 0) {
      errors.push('employees must be a non-empty array of employee payroll records.');
    } else {
      body.employees.forEach((emp, index) => {
        if (!emp || typeof emp !== 'object') {
          errors.push(`employees[${index}] must be a valid object.`);
        } else if (!emp.employeeId || typeof emp.employeeId !== 'string' || emp.employeeId.trim().length === 0) {
          errors.push(`employees[${index}].employeeId is required.`);
        }
      });
    }
    if (errors.length > 0) {
      return createValidationError(res, req.originalUrl, errors);
    }
    return next();
  }

  const {
    employeeId,
    month,
    year,
    workingDays,
    paidDays,
    ncpDays,
    overtimeHours,
    overtimeHourlyRate,
    overtimeAmount,
    bonus,
    advanceRecovery,
    otherDeductions,
    status
  } = body;

  if (!employeeId || typeof employeeId !== 'string' || employeeId.trim().length === 0) {
    errors.push('employeeId is required and must be a non-empty string.');
  }

  if (month === undefined || month === null || !Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12) {
    errors.push('month is required and must be an integer between 1 and 12.');
  }

  if (year === undefined || year === null || !Number.isInteger(Number(year)) || Number(year) < 2000) {
    errors.push('year is required and must be an integer (e.g. 2026).');
  }

  const effectiveWorkingDays = workingDays !== undefined ? Number(workingDays) : 30;
  if (workingDays !== undefined && (isNaN(effectiveWorkingDays) || effectiveWorkingDays <= 0 || effectiveWorkingDays > 31)) {
    errors.push('workingDays must be a positive number between 1 and 31.');
  }

  if (paidDays !== undefined) {
    const numPaid = Number(paidDays);
    if (isNaN(numPaid) || numPaid < 0) {
      errors.push('paidDays must be a non-negative number.');
    } else if (numPaid > effectiveWorkingDays) {
      errors.push(`paidDays (${numPaid}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (ncpDays !== undefined) {
    const numNcp = Number(ncpDays);
    if (isNaN(numNcp) || numNcp < 0) {
      errors.push('ncpDays must be a non-negative number.');
    } else if (numNcp > effectiveWorkingDays) {
      errors.push(`ncpDays (${numNcp}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (paidDays !== undefined && ncpDays !== undefined) {
    const numPaid = Number(paidDays);
    const numNcp = Number(ncpDays);
    if (!isNaN(numPaid) && !isNaN(numNcp) && numPaid + numNcp > effectiveWorkingDays) {
      errors.push(`The sum of paidDays (${numPaid}) and ncpDays (${numNcp}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  const nonNegativeFields = [
    { name: 'overtimeHours', val: overtimeHours },
    { name: 'overtimeHourlyRate', val: overtimeHourlyRate },
    { name: 'overtimeAmount', val: overtimeAmount },
    { name: 'bonus', val: bonus },
    { name: 'advanceRecovery', val: advanceRecovery },
    { name: 'otherDeductions', val: otherDeductions }
  ];

  for (const field of nonNegativeFields) {
    if (field.val !== undefined && field.val !== null && (typeof field.val !== 'number' || isNaN(field.val) || field.val < 0)) {
      errors.push(`${field.name} must be a non-negative number if provided.`);
    }
  }

  if (status !== undefined) {
    const validStatuses = ['DRAFT', 'PROCESSED', 'FINALIZED', 'PAID'];
    if (!validStatuses.includes(String(status).toUpperCase())) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}.`);
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates PATCH /api/payroll/records/:id/status
 */
function validateUpdatePayrollStatus(req, res, next) {
  const errors = [];
  const { status } = req.body || {};

  if (!status || typeof status !== 'string') {
    errors.push('status is required and must be a string.');
  } else {
    const validStatuses = ['DRAFT', 'PROCESSED', 'FINALIZED', 'PAID'];
    if (!validStatuses.includes(status.toUpperCase().trim())) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}.`);
    }
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/pf/calculate
 */
function validateCalculatePf(req, res, next) {
  const errors = [];
  const { earnedBasic, earnedDa, options } = req.body || {};

  if (earnedBasic === undefined || earnedBasic === null) {
    errors.push('earnedBasic is required.');
  } else if (typeof earnedBasic !== 'number' || isNaN(earnedBasic) || earnedBasic < 0) {
    errors.push('earnedBasic must be a non-negative number.');
  }

  if (earnedDa !== undefined && (typeof earnedDa !== 'number' || isNaN(earnedDa) || earnedDa < 0)) {
    errors.push('earnedDa must be a non-negative number if provided.');
  }

  if (options !== undefined && (typeof options !== 'object' || Array.isArray(options))) {
    errors.push('options must be an object if provided.');
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/esic/calculate
 */
function validateCalculateEsic(req, res, next) {
  const errors = [];
  const { grossWages, workingDays, presentDays, options } = req.body || {};

  if (grossWages === undefined || grossWages === null) {
    errors.push('grossWages is required.');
  } else if (typeof grossWages !== 'number' || isNaN(grossWages) || grossWages < 0) {
    errors.push('grossWages must be a non-negative number.');
  }

  const effectiveWorkingDays = workingDays !== undefined ? workingDays : 30;
  if (workingDays !== undefined && (typeof workingDays !== 'number' || isNaN(workingDays) || workingDays <= 0 || workingDays > 31)) {
    errors.push('workingDays must be a positive number between 1 and 31.');
  }

  if (presentDays !== undefined) {
    if (typeof presentDays !== 'number' || isNaN(presentDays) || presentDays < 0) {
      errors.push('presentDays must be a non-negative number.');
    } else if (typeof effectiveWorkingDays === 'number' && presentDays > effectiveWorkingDays) {
      errors.push(`presentDays (${presentDays}) cannot exceed workingDays (${effectiveWorkingDays}).`);
    }
  }

  if (options !== undefined && (typeof options !== 'object' || Array.isArray(options))) {
    errors.push('options must be an object if provided.');
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/tax/calculate
 */
function validateCalculateTax(req, res, next) {
  const errors = [];
  const { monthlyGrossSalary, state, month, gender, otherAnnualIncome, customConfig } = req.body || {};

  if (monthlyGrossSalary === undefined || monthlyGrossSalary === null) {
    errors.push('monthlyGrossSalary is required.');
  } else if (typeof monthlyGrossSalary !== 'number' || isNaN(monthlyGrossSalary) || monthlyGrossSalary < 0) {
    errors.push('monthlyGrossSalary must be a non-negative number.');
  }

  if (state !== undefined && (typeof state !== 'string' || state.trim().length === 0)) {
    errors.push('state must be a non-empty string if provided.');
  }

  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    errors.push('month must be an integer between 1 and 12 if provided.');
  }

  if (gender !== undefined && typeof gender === 'string') {
    const validGenders = ['MALE', 'FEMALE', 'ALL'];
    if (!validGenders.includes(gender.toUpperCase())) {
      errors.push('gender must be one of: MALE, FEMALE, ALL.');
    }
  }

  if (otherAnnualIncome !== undefined && (typeof otherAnnualIncome !== 'number' || isNaN(otherAnnualIncome) || otherAnnualIncome < 0)) {
    errors.push('otherAnnualIncome must be a non-negative number if provided.');
  }

  if (customConfig !== undefined && (typeof customConfig !== 'object' || Array.isArray(customConfig))) {
    errors.push('customConfig must be an object if provided.');
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

/**
 * Validates POST /api/payroll/gratuity/calculate
 */
function validateCalculateGratuity(req, res, next) {
  const errors = [];
  const { lastDrawnBasic, lastDrawnDa, completedYears, options } = req.body || {};

  if (lastDrawnBasic === undefined || lastDrawnBasic === null) {
    errors.push('lastDrawnBasic is required.');
  } else if (typeof lastDrawnBasic !== 'number' || isNaN(lastDrawnBasic) || lastDrawnBasic < 0) {
    errors.push('lastDrawnBasic must be a non-negative number.');
  }

  if (lastDrawnDa !== undefined && (typeof lastDrawnDa !== 'number' || isNaN(lastDrawnDa) || lastDrawnDa < 0)) {
    errors.push('lastDrawnDa must be a non-negative number if provided.');
  }

  if (completedYears === undefined || completedYears === null) {
    errors.push('completedYears is required.');
  } else if (typeof completedYears !== 'number' || isNaN(completedYears) || completedYears < 0) {
    errors.push('completedYears must be a non-negative number.');
  }

  if (options !== undefined && (typeof options !== 'object' || Array.isArray(options))) {
    errors.push('options must be an object if provided.');
  }

  if (errors.length > 0) {
    return createValidationError(res, req.originalUrl, errors);
  }

  next();
}

module.exports = {
  validateCalculateStatutoryContributions,
  validateCalculateMonthlySalary,
  validateCreateStatutoryRule,
  validateCreateEmployee,
  validateCalculatePayroll,
  validateProcessPayroll,
  validateProcessPayrollPayload,
  validateUpdatePayrollStatus,
  validateCalculatePf,
  validateCalculateEsic,
  validateCalculateTax,
  validateCalculateGratuity
};
