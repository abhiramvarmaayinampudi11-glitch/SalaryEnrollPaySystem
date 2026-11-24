/**
 * Statutory Rules Controller
 * Handles administration, versioning, effective period resolution,
 * and retrieval of statutory contribution rules.
 */

const ContributionRule = require('../models/ContributionRule');
const inMemoryStore = require('../services/inMemoryStore');
const { isDbConnected } = require('../config/database');
const { STATUTORY_RULES } = require('../config/statutoryRules');

/**
 * Helper: Resolve applicable rule for a date from either MongoDB or In-Memory Store
 */
async function resolveApplicableRule(targetDate = new Date()) {
  const date = new Date(targetDate);

  if (isDbConnected()) {
    // Check if any rule exists; if collection is empty, seed baseline
    const count = await ContributionRule.countDocuments();
    if (count === 0) {
      await ContributionRule.create({
        ruleCode: 'STATUTORY_IN_STD',
        name: 'Statutory Standard Rules (EPFO & ESIC Baseline)',
        version: 1,
        effectiveFrom: new Date('2019-07-01'),
        effectiveTo: null,
        isActive: true,
        verifiedByAdmin: true,
        pf: { ...STATUTORY_RULES.pf },
        esic: { ...STATUTORY_RULES.esic },
        pt: { ...STATUTORY_RULES.pt },
        gratuity: { ...STATUTORY_RULES.gratuity },
        tds: { ...STATUTORY_RULES.tds },
        remarks: 'Auto-seeded baseline statutory rule',
        createdBy: 'System Administrator'
      });
    }

    const rules = await ContributionRule.find({
      isActive: true,
      effectiveFrom: { $lte: date },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }]
    })
      .sort({ effectiveFrom: -1, version: -1 })
      .lean();

    return rules.length > 0 ? rules[0] : null;
  }

  return inMemoryStore.findApplicableRule(date);
}

/**
 * POST /api/statutory-rules
 * Adds a new statutory rule or new version (Admin verified)
 */
async function createRule(req, res, next) {
  try {
    const {
      ruleCode,
      name,
      effectiveFrom,
      effectiveTo,
      pf,
      esic,
      pt,
      gratuity,
      tds,
      remarks,
      createdBy
    } = req.body;

    const normalizedCode = ruleCode.toUpperCase().trim();

    if (isDbConnected()) {
      // Find latest version for this ruleCode
      const latest = await ContributionRule.findOne({ ruleCode: normalizedCode }).sort({ version: -1 });
      const nextVersion = latest ? latest.version + 1 : 1;

      // Close previous ongoing rule version if new rule supersedes it
      if (latest && !latest.effectiveTo) {
        latest.effectiveTo = new Date(effectiveFrom);
        await latest.save();
      }

      const rule = await ContributionRule.create({
        ruleCode: normalizedCode,
        name: name || `Statutory Rule Version ${nextVersion}`,
        version: nextVersion,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        isActive: true,
        verifiedByAdmin: true,
        pf: { ...STATUTORY_RULES.pf, ...(pf || {}) },
        esic: { ...STATUTORY_RULES.esic, ...(esic || {}) },
        pt: { ...STATUTORY_RULES.pt, ...(pt || {}) },
        gratuity: { ...STATUTORY_RULES.gratuity, ...(gratuity || {}) },
        tds: { ...STATUTORY_RULES.tds, ...(tds || {}) },
        remarks: remarks || '',
        createdBy: createdBy || 'Administrator'
      });

      return res.status(201).json({
        success: true,
        message: `Statutory Rule ${normalizedCode} (Version ${nextVersion}) registered successfully.`,
        data: rule
      });
    }

    // In-Memory Fallback
    const rule = inMemoryStore.createRule({
      ruleCode: normalizedCode,
      name,
      effectiveFrom,
      effectiveTo,
      pf,
      esic,
      pt,
      gratuity,
      tds,
      remarks,
      createdBy
    });

    return res.status(201).json({
      success: true,
      message: `Statutory Rule ${normalizedCode} (Version ${rule.version}) registered successfully (In-Memory mode).`,
      data: rule
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/statutory-rules
 * Retrieves all registered statutory rules with optional filters
 */
async function getAllRules(req, res, next) {
  try {
    const { ruleCode, isActive } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (ruleCode) filter.ruleCode = ruleCode.toUpperCase().trim();
      if (isActive !== undefined) filter.isActive = isActive === 'true';

      const rules = await ContributionRule.find(filter).sort({ effectiveFrom: -1, version: -1 }).lean();
      return res.status(200).json({
        success: true,
        count: rules.length,
        data: rules
      });
    }

    const rules = inMemoryStore.findAllRules({ ruleCode, isActive });
    return res.status(200).json({
      success: true,
      count: rules.length,
      data: rules
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/statutory-rules/active
 * Retrieves the currently active baseline rule
 */
async function getActiveRule(req, res, next) {
  try {
    const rule = await resolveApplicableRule(new Date());

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'No currently active statutory rule found.',
          status: 404,
          code: 'NO_ACTIVE_RULE',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Active statutory rule retrieved successfully.',
      data: rule
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/statutory-rules/applicable
 * Retrieves rule applicable to a specific payroll period / date (?date=YYYY-MM-DD or ?month=5&year=2026)
 */
async function getApplicableRule(req, res, next) {
  try {
    const { date, month, year } = req.query;

    let targetDate;
    if (date) {
      targetDate = new Date(date);
    } else if (month && year) {
      targetDate = new Date(Number(year), Number(month) - 1, 15);
    } else {
      targetDate = new Date();
    }

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid date parameter. Use YYYY-MM-DD or supply both month and year.',
          status: 400,
          code: 'INVALID_DATE',
          path: req.originalUrl
        }
      });
    }

    const rule = await resolveApplicableRule(targetDate);

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: {
          message: `No applicable statutory rule found for date: ${targetDate.toISOString().split('T')[0]}.`,
          status: 404,
          code: 'NO_APPLICABLE_STATUTORY_RULE',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: `Statutory rule applicable for period (${targetDate.toISOString().split('T')[0]}) resolved.`,
      data: rule
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/statutory-rules/versions
 * View historical versions and audit trail
 */
async function getRuleVersions(req, res, next) {
  try {
    const { ruleCode } = req.query;

    if (isDbConnected()) {
      const filter = {};
      if (ruleCode) filter.ruleCode = ruleCode.toUpperCase().trim();

      const versions = await ContributionRule.find(filter)
        .select('ruleCode name version effectiveFrom effectiveTo isActive verifiedByAdmin createdAt updatedAt')
        .sort({ ruleCode: 1, version: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        count: versions.length,
        data: versions
      });
    }

    const all = inMemoryStore.findAllRules({ ruleCode });
    const versions = all.map((r) => ({
      _id: r._id,
      ruleCode: r.ruleCode,
      name: r.name,
      version: r.version,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      isActive: r.isActive,
      verifiedByAdmin: r.verifiedByAdmin,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.status(200).json({
      success: true,
      count: versions.length,
      data: versions
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/statutory-rules/:id
 * Retrieve specific rule by ID
 */
async function getRuleById(req, res, next) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      let rule = null;
      if (id.match(/^[0-9a-fA-F]{24}$/)) {
        rule = await ContributionRule.findById(id).lean();
      }
      if (!rule) {
        rule = await ContributionRule.findOne({ ruleCode: id.toUpperCase().trim() }).sort({ version: -1 }).lean();
      }

      if (!rule) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Statutory rule not found with ID/Code: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: rule
      });
    }

    const rule = inMemoryStore.findRuleById(id) || inMemoryStore.findApplicableRule();
    if (!rule) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Statutory rule not found with ID/Code: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: rule
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * PUT /api/statutory-rules/:id
 * Updates an existing rule
 */
async function updateRule(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (isDbConnected()) {
      const rule = await ContributionRule.findByIdAndUpdate(id, updates, { new: true });
      if (!rule) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Statutory rule not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Statutory rule updated successfully.',
        data: rule
      });
    }

    const updated = inMemoryStore.updateRule(id, updates);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Statutory rule not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Statutory rule updated successfully (In-Memory mode).',
      data: updated
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * DELETE /api/statutory-rules/:id
 * Deactivates a rule
 */
async function deleteRule(req, res, next) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      const rule = await ContributionRule.findByIdAndUpdate(id, { isActive: false }, { new: true });
      if (!rule) {
        return res.status(404).json({
          success: false,
          error: {
            message: `Statutory rule not found with ID: ${id}`,
            status: 404,
            code: 'NOT_FOUND',
            path: req.originalUrl
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: `Statutory rule ${id} deactivated successfully.`
      });
    }

    const deleted = inMemoryStore.deleteRule(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Statutory rule not found with ID: ${id}`,
          status: 404,
          code: 'NOT_FOUND',
          path: req.originalUrl
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: `Statutory rule ${id} deactivated successfully (In-Memory mode).`
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  resolveApplicableRule,
  createRule,
  getAllRules,
  getActiveRule,
  getApplicableRule,
  getRuleVersions,
  getRuleById,
  updateRule,
  deleteRule
};
