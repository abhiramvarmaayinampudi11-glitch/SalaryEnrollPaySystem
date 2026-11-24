/**
 * Employee REST API Routes
 * Mounts endpoints for employee enrollment and management.
 */

const express = require('express');
const router = express.Router();

const {
  createEmployee,
  getAllEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee
} = require('../controllers/employeeController');

const { validateCreateEmployee } = require('../middleware/validator');

// POST /api/employees - Enroll new employee
router.post('/', validateCreateEmployee, createEmployee);

// GET /api/employees - List all employees
router.get('/', getAllEmployees);

// GET /api/employees/:id - Retrieve employee by ID
router.get('/:id', getEmployeeById);

// PUT /api/employees/:id - Update employee
router.put('/:id', updateEmployee);

// DELETE /api/employees/:id - Remove employee
router.delete('/:id', deleteEmployee);

module.exports = router;
