/**
 * Statutory Rules REST API Routes
 * Mounts endpoints for managing versioned contribution rules, effective dates,
 * and period-specific rule resolution with admin authorization.
 */

const express = require('express');
const router = express.Router();

const {
  createRule,
  getAllRules,
  getActiveRule,
  getApplicableRule,
  getRuleVersions,
  getRuleById,
  updateRule,
  deleteRule
} = require('../controllers/statutoryRuleController');

const { requireAdminAuth } = require('../middleware/auth');
const { validateCreateStatutoryRule } = require('../middleware/validator');

// GET /api/statutory-rules/active - Get current active statutory rule
router.get('/active', getActiveRule);

// GET /api/statutory-rules/applicable - Resolve rule for date/period (?date=YYYY-MM-DD or ?month=5&year=2026)
router.get('/applicable', getApplicableRule);

// GET /api/statutory-rules/versions - View historical versions and audit trail
router.get('/versions', getRuleVersions);

// GET /api/statutory-rules - List all rules (supports ?ruleCode=...&isActive=true)
router.get('/', getAllRules);

// GET /api/statutory-rules/:id - Get rule by ID or Code
router.get('/:id', getRuleById);

// POST /api/statutory-rules - Create new rule (Admin authorization enforced)
router.post('/', requireAdminAuth, validateCreateStatutoryRule, createRule);

// PUT /api/statutory-rules/:id - Update rule (Admin authorization enforced)
router.put('/:id', requireAdminAuth, updateRule);

// DELETE /api/statutory-rules/:id - Deactivate rule (Admin authorization enforced)
router.delete('/:id', requireAdminAuth, deleteRule);

module.exports = router;
