/**
 * Payroll REST API Routes
 * Mounts endpoints for pure calculations, monthly salary engine,
 * statutory contribution calculation engine, and payroll record processing/retrieval.
 */

const express = require('express');
const router = express.Router();

const {
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
} = require('../controllers/payrollController');

const {
  validateCalculateStatutoryContributions,
  validateCalculateMonthlySalary,
  validateCalculatePayroll,
  validateProcessPayroll,
  validateProcessPayrollPayload,
  validateUpdatePayrollStatus,
  validateCalculatePf,
  validateCalculateEsic,
  validateCalculateTax,
  validateCalculateGratuity
} = require('../middleware/validator');

// --- Statutory Contribution Calculation Engine Endpoint ---
// POST /api/payroll/statutory/calculate
router.post('/statutory/calculate', validateCalculateStatutoryContributions, calculateStatutoryContributionsEndpoint);

// --- Reusable Monthly Salary Engine Endpoint ---
// POST /api/payroll/monthly-salary/calculate
router.post('/monthly-salary/calculate', validateCalculateMonthlySalary, calculateMonthlySalaryEndpoint);

// --- Pure Calculation Endpoints ---
// POST /api/payroll/calculate - In-memory full payroll calculation
router.post('/calculate', validateCalculatePayroll, calculateFullPayroll);

// POST /api/payroll/pf/calculate - EPFO calculation
router.post('/pf/calculate', validateCalculatePf, calculatePfEndpoint);

// POST /api/payroll/esic/calculate - ESIC calculation
router.post('/esic/calculate', validateCalculateEsic, calculateEsicEndpoint);

// POST /api/payroll/tax/calculate - Professional Tax and TDS
router.post('/tax/calculate', validateCalculateTax, calculateTaxEndpoint);

// POST /api/payroll/gratuity/calculate - Gratuity estimate
router.post('/gratuity/calculate', validateCalculateGratuity, calculateGratuityEndpoint);

// --- Payroll Record Processing, Persistence & Status Workflow Endpoints ---
// POST /api/payroll/process - Unified payroll processing for single or batch employees
router.post('/process', validateProcessPayrollPayload, processPayrollEndpoint);

// POST /api/payroll/process/:employeeId - Process and save monthly payroll for an employee (backwards compatibility)
router.post('/process/:employeeId', validateProcessPayroll, processAndSavePayroll);

// PATCH /api/payroll/records/:id/status - Update payroll record status ('DRAFT' | 'PROCESSED' | 'FINALIZED' | 'PAID')
router.patch('/records/:id/status', validateUpdatePayrollStatus, updatePayrollStatusEndpoint);

// GET /api/payroll/records - List historical payroll records with query filters
router.get('/records', getPayrollRecords);

// GET /api/payroll/records/:id - Get specific payroll record / salary slip
router.get('/records/:id', getPayrollRecordById);

module.exports = router;
