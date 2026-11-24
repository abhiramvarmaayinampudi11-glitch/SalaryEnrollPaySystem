/**
 * Employee Controller
 * Manages Employee enrollment, profile updates, and salary structures.
 * Supports both MongoDB (live) and In-Memory fallback (offline/mock) modes.
 */

const Employee = require('../models/Employee');
const SalaryStructure = require('../models/SalaryStructure');
const inMemoryStore = require('../services/inMemoryStore');
const { isDbConnected } = require('../config/database');

/**
 * POST /api/employees
 * Creates a new employee with an optional initial salary structure.
 */
async function createEmployee(req, res, next) {
  try {
    const {
      employeeId,
      firstName,
      lastName,
      email,
      department,
      designation,
      joiningDate,
      pfEligible,
      capPfAtWageCeiling,
      esicEligible,
      hasDisability,
      stateForPt,
      pan,
      uan,
      esicIpNumber,
      salaryStructure
    } = req.body;

    const normalizedEmployeeId = employeeId.toUpperCase().trim();

    if (isDbConnected()) {
      // Check existing in MongoDB
      const existing = await Employee.findOne({
        $or: [{ employeeId: normalizedEmployeeId }, { email: email.toLowerCase().trim() }]
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            message: 'An employee with this Employee ID or Email already exists.',
            status: 409,
            code: 'DUPLICATE_ENTITY',
            path: req.originalUrl
          }
        });
      }

      const employee = await Employee.create({
        employeeId: normalizedEmployeeId,
        firstName,
        lastName,
        email,
        department,
        designation,
        joiningDate,
        pfEligible,
        capPfAtWageCeiling,
        esicEligible,
        hasDisability,
        stateForPt,
        pan,
        uan,
        esicIpNumber
      });

      let structure = null;
      if (salaryStructure && salaryStructure.basic !== undefined) {
        structure = await SalaryStructure.create({
          employee: employee._id,
          employeeId: normalizedEmployeeId,
          basic: salaryStructure.basic,
          da: salaryStructure.da || 0,
          hra: salaryStructure.hra || 0,
          conveyance: salaryStructure.conveyance || 0,
          specialAllowance: salaryStructure.specialAllowance || 0,
          otherAllowances: salaryStructure.otherAllowances || 0
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Employee enrolled successfully.',
        data: {
          employee,
          salaryStructure: structure
        }
      });
    }

    // In-Memory Fallback
    const existingMem = inMemoryStore.findEmployee({ employeeId: normalizedEmployeeId }) || inMemoryStore.findEmployee({ email });
    if (existingMem) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'An employee with this Employee ID or Email already exists.',
          status: 409,
          code: 'DUPLICATE_ENTITY',
          path: req.originalUrl
        }
      });
    }

    const employee = inMemoryStore.createEmployee({
      employeeId: normalizedEmployeeId,
      firstName,
      lastName,
      email,
      department,
      designation,
      joiningDate,
      pfEligible,
      capPfAtWageCeiling,
      esicEligible,
      hasDisability,
      stateForPt,
      pan,
      uan,
      esicIpNumber
    });

    let structure = null;
    if (salaryStructure && salaryStructure.basic !== undefined) {
      structure = inMemoryStore.saveSalaryStructure({
        employeeId: normalizedEmployeeId,
        basic: salaryStructure.basic,
        da: salaryStructure.da || 0,
        hra: salaryStructure.hra || 0,
        conveyance: salaryStructure.conveyance || 0,
        specialAllowance: salaryStructure.specialAllowance || 0,
        otherAllowances: salaryStructure.otherAllowances || 0,
        nominalGrossFixed:
          Number(salaryStructure.basic) +
          (Number(salaryStructure.da) || 0) +
          (Number(salaryStructure.hra) || 0) +
          (Number(salaryStructure.conveyance) || 0) +
          (Number(salaryStructure.specialAllowance) || 0) +
          (Number(salaryStructure.otherAllowances) || 0)
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Employee enrolled successfully (In-Memory mode).',
      data: {
        employee,
        salaryStructure: structure
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/employees
 * Retrieves all employees with their active salary structures.
 */
async function getAllEmployees(req, res, next) {
  try {
    const { department, isActive } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (department) filter.department = department;
      if (isActive !== undefined) filter.isActive = isActive === 'true';

      const employees = await Employee.find(filter).sort({ createdAt: -1 }).lean();
      const employeeIds = employees.map((e) => e.employeeId);
      const structures = await SalaryStructure.find({ employeeId: { $in: employeeIds }, isActive: true }).lean();

      const structureMap = new Map();
      structures.forEach((s) => structureMap.set(s.employeeId, s));

      const enriched = employees.map((e) => ({
        ...e,
        salaryStructure: structureMap.get(e.employeeId) || null
      }));

      return res.status(200).json({
        success: true,
        count: enriched.length,
        data: enriched
      });
    }

    // In-Memory Fallback
    let employees = inMemoryStore.findAllEmployees();
    if (department) {
      employees = employees.filter((e) => e.department.toLowerCase() === department.toLowerCase());
    }
    if (isActive !== undefined) {
      const activeBool = isActive === 'true';
      employees = employees.filter((e) => e.isActive === activeBool);
    }

    const enriched = employees.map((e) => ({
      ...e,
      salaryStructure: inMemoryStore.findSalaryStructure(e.employeeId)
    }));

    return res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/employees/:id
 * Retrieves a single employee by Employee ID or Mongo ObjectId.
 */
async function getEmployeeById(req, res, next) {
  try {
    const { id } = req.params;
    const searchId = id.toUpperCase().trim();

    if (isDbConnected()) {
      let employee = await Employee.findOne({ employeeId: searchId }).lean();
      if (!employee && id.match(/^[0-9a-fA-F]{24}$/)) {
        employee = await Employee.findById(id).lean();
      }

      if (!employee) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Employee not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      const salaryStructure = await SalaryStructure.findOne({ employeeId: employee.employeeId, isActive: true }).lean();

      return res.status(200).json({
        success: true,
        data: {
          ...employee,
          salaryStructure: salaryStructure || null
        }
      });
    }

    // In-Memory Fallback
    const employee = inMemoryStore.findEmployee({ employeeId: searchId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Employee not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    const salaryStructure = inMemoryStore.findSalaryStructure(employee.employeeId);

    return res.status(200).json({
      success: true,
      data: {
        ...employee,
        salaryStructure: salaryStructure || null
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * PUT /api/employees/:id
 * Updates an employee's profile and/or salary structure.
 */
async function updateEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const searchId = id.toUpperCase().trim();

    if (isDbConnected()) {
      let employee = await Employee.findOne({ employeeId: searchId });
      if (!employee && id.match(/^[0-9a-fA-F]{24}$/)) {
        employee = await Employee.findById(id);
      }

      if (!employee) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Employee not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      // Update employee fields
      const allowedFields = ['firstName', 'lastName', 'department', 'designation', 'pfEligible', 'capPfAtWageCeiling', 'esicEligible', 'hasDisability', 'stateForPt', 'pan', 'uan', 'esicIpNumber', 'isActive'];
      allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
          employee[field] = updates[field];
        }
      });
      await employee.save();

      // Update or create salary structure if provided
      let structure = null;
      if (updates.salaryStructure && updates.salaryStructure.basic !== undefined) {
        structure = await SalaryStructure.findOneAndUpdate(
          { employeeId: employee.employeeId },
          {
            employee: employee._id,
            employeeId: employee.employeeId,
            basic: updates.salaryStructure.basic,
            da: updates.salaryStructure.da || 0,
            hra: updates.salaryStructure.hra || 0,
            conveyance: updates.salaryStructure.conveyance || 0,
            specialAllowance: updates.salaryStructure.specialAllowance || 0,
            otherAllowances: updates.salaryStructure.otherAllowances || 0,
            isActive: true
          },
          { new: true, upsert: true }
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Employee updated successfully.',
        data: {
          employee,
          salaryStructure: structure
        }
      });
    }

    // In-Memory Fallback
    const employee = inMemoryStore.findEmployee({ employeeId: searchId });
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Employee not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    const updatedEmp = inMemoryStore.updateEmployee(employee.employeeId, updates);

    let structure = null;
    if (updates.salaryStructure && updates.salaryStructure.basic !== undefined) {
      structure = inMemoryStore.saveSalaryStructure({
        employeeId: employee.employeeId,
        basic: updates.salaryStructure.basic,
        da: updates.salaryStructure.da || 0,
        hra: updates.salaryStructure.hra || 0,
        conveyance: updates.salaryStructure.conveyance || 0,
        specialAllowance: updates.salaryStructure.specialAllowance || 0,
        otherAllowances: updates.salaryStructure.otherAllowances || 0,
        nominalGrossFixed:
          Number(updates.salaryStructure.basic) +
          (Number(updates.salaryStructure.da) || 0) +
          (Number(updates.salaryStructure.hra) || 0) +
          (Number(updates.salaryStructure.conveyance) || 0) +
          (Number(updates.salaryStructure.specialAllowance) || 0) +
          (Number(updates.salaryStructure.otherAllowances) || 0)
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Employee updated successfully (In-Memory mode).',
      data: {
        employee: updatedEmp,
        salaryStructure: structure
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * DELETE /api/employees/:id
 * Deactivates or removes an employee.
 */
async function deleteEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const searchId = id.toUpperCase().trim();

    if (isDbConnected()) {
      const employee = await Employee.findOneAndDelete({ employeeId: searchId });
      if (!employee) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Employee not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }
      await SalaryStructure.deleteMany({ employeeId: searchId });

      return res.status(200).json({
        success: true,
        message: `Employee ${searchId} and associated structures removed successfully.`
      });
    }

    // In-Memory Fallback
    const deleted = inMemoryStore.deleteEmployee(searchId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Employee not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: `Employee ${searchId} removed successfully (In-Memory mode).`
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createEmployee,
  getAllEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee
};
