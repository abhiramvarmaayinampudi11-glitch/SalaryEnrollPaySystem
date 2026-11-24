/**
 * In-Memory Fallback Data Store
 * Provides seamless offline persistence for employees, payroll records,
 * and versioned statutory contribution rules.
 * Enforces unique period constraints and restricts recalculation to DRAFT status.
 */

const { STATUTORY_RULES } = require('../config/statutoryRules');

class InMemoryStore {
  constructor() {
    this.employees = new Map();
    this.salaryStructures = new Map();
    this.payrollRecords = new Map();
    this.contributionRules = new Map();

    this.initDefaultStatutoryRules();
  }

  initDefaultStatutoryRules() {
    const defaultRule = {
      _id: 'RULE_DEFAULT_V1',
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
      remarks: 'Default statutory rules verified by administrator',
      createdBy: 'System Administrator',
      updatedBy: 'System Administrator',
      createdAt: new Date('2019-07-01'),
      updatedAt: new Date()
    };
    this.contributionRules.set(defaultRule.ruleCode, [defaultRule]);
  }

  // --- Statutory Rules Store Methods ---
  createRule(data) {
    const code = (data.ruleCode || 'STATUTORY_RULE').toUpperCase().trim();
    const versions = this.contributionRules.get(code) || [];
    const nextVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : (data.version || 1);

    const record = {
      _id: `RULE_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ruleCode: code,
      name: data.name || 'Statutory Contribution Rule',
      version: nextVersion,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      verifiedByAdmin: data.verifiedByAdmin !== undefined ? data.verifiedByAdmin : true,
      pf: { ...STATUTORY_RULES.pf, ...(data.pf || {}) },
      esic: { ...STATUTORY_RULES.esic, ...(data.esic || {}) },
      pt: { ...STATUTORY_RULES.pt, ...(data.pt || {}) },
      gratuity: { ...STATUTORY_RULES.gratuity, ...(data.gratuity || {}) },
      tds: { ...STATUTORY_RULES.tds, ...(data.tds || {}) },
      remarks: data.remarks || '',
      createdBy: data.createdBy || 'Administrator',
      updatedBy: data.updatedBy || 'Administrator',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    versions.push(record);
    this.contributionRules.set(code, versions);
    return record;
  }

  findAllRules(query = {}) {
    let all = [];
    for (const vList of this.contributionRules.values()) {
      all.push(...vList);
    }
    if (query.ruleCode) {
      all = all.filter((r) => r.ruleCode === query.ruleCode.toUpperCase().trim());
    }
    if (query.isActive !== undefined) {
      const bool = query.isActive === 'true' || query.isActive === true;
      all = all.filter((r) => r.isActive === bool);
    }
    return all.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom) || b.version - a.version);
  }

  findRuleById(id) {
    for (const vList of this.contributionRules.values()) {
      const match = vList.find((r) => r._id === id || `${r.ruleCode}_V${r.version}` === id);
      if (match) return match;
    }
    return null;
  }

  findApplicableRule(targetDate = new Date()) {
    const date = new Date(targetDate);
    let matchedRules = [];

    for (const vList of this.contributionRules.values()) {
      for (const rule of vList) {
        if (!rule.isActive) continue;
        const from = new Date(rule.effectiveFrom);
        const to = rule.effectiveTo ? new Date(rule.effectiveTo) : null;

        if (from <= date && (!to || to >= date)) {
          matchedRules.push(rule);
        }
      }
    }

    if (matchedRules.length === 0) return null;
    matchedRules.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom) || b.version - a.version);
    return matchedRules[0];
  }

  updateRule(id, updates) {
    const rule = this.findRuleById(id);
    if (!rule) return null;

    Object.assign(rule, updates, { updatedAt: new Date() });
    return rule;
  }

  deleteRule(id) {
    const rule = this.findRuleById(id);
    if (!rule) return false;
    rule.isActive = false;
    rule.updatedAt = new Date();
    return true;
  }

  // --- Employee Store Methods ---
  createEmployee(data) {
    const id = data._id || `EMP_DOC_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      _id: id,
      employeeId: data.employeeId.toUpperCase(),
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      department: data.department || 'General',
      designation: data.designation || 'Staff',
      joiningDate: data.joiningDate || new Date(),
      pfEligible: data.pfEligible !== undefined ? data.pfEligible : true,
      capPfAtWageCeiling: data.capPfAtWageCeiling !== undefined ? data.capPfAtWageCeiling : true,
      esicEligible: data.esicEligible !== undefined ? data.esicEligible : null,
      hasDisability: Boolean(data.hasDisability),
      stateForPt: data.stateForPt || 'DEFAULT',
      pan: data.pan || '',
      uan: data.uan || '',
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.employees.set(record.employeeId, record);
    return record;
  }

  findEmployee(query = {}) {
    if (query.employeeId) {
      return this.employees.get(query.employeeId.toUpperCase()) || null;
    }
    if (query.email) {
      for (const emp of this.employees.values()) {
        if (emp.email === query.email.toLowerCase()) return emp;
      }
    }
    return null;
  }

  findAllEmployees() {
    return Array.from(this.employees.values());
  }

  updateEmployee(employeeId, updates) {
    const emp = this.findEmployee({ employeeId });
    if (!emp) return null;
    Object.assign(emp, updates, { updatedAt: new Date() });
    this.employees.set(emp.employeeId, emp);
    return emp;
  }

  deleteEmployee(employeeId) {
    return this.employees.delete(employeeId.toUpperCase());
  }

  // --- Salary Structure Store Methods ---
  saveSalaryStructure(data) {
    const id = data._id || `SAL_${Date.now()}`;
    const record = {
      _id: id,
      employeeId: data.employeeId.toUpperCase(),
      basic: Number(data.basic) || 0,
      da: Number(data.da) || 0,
      hra: Number(data.hra) || 0,
      conveyance: Number(data.conveyance) || 0,
      specialAllowance: Number(data.specialAllowance) || 0,
      otherAllowances: Number(data.otherAllowances) || 0,
      nominalGrossFixed: Number(data.nominalGrossFixed) || 0,
      effectiveDate: data.effectiveDate || new Date(),
      isActive: true,
      updatedAt: new Date()
    };
    this.salaryStructures.set(record.employeeId, record);
    return record;
  }

  findSalaryStructure(employeeId) {
    return this.salaryStructures.get(employeeId.toUpperCase()) || null;
  }

  // --- Payroll Record Store Methods ---
  savePayrollRecord(data, options = {}) {
    const key = `${data.employeeId.toUpperCase()}_${data.year}_${data.month}`;
    const existing = this.payrollRecords.get(key);

    if (existing) {
      // Recalculation is permitted ONLY if existing record is in 'DRAFT' status
      if (existing.status && existing.status !== 'DRAFT' && !options.forceRecalculate) {
        const error = new Error(`Recalculation rejected: Payroll record for employee ${data.employeeId} for period ${data.month}/${data.year} is locked in '${existing.status}' status. Only records in 'DRAFT' status can be recalculated.`);
        error.status = 409;
        error.code = 'RECALCULATION_LOCKED';
        throw error;
      }

      // Update existing draft record
      const updatedRecord = {
        ...existing,
        ...data,
        employeeId: data.employeeId.toUpperCase(),
        version: (existing.version || 1) + 1,
        recalculatedAt: new Date(),
        updatedAt: new Date()
      };
      this.payrollRecords.set(key, updatedRecord);
      return updatedRecord;
    }

    const id = data._id || `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record = {
      _id: id,
      ...data,
      employeeId: data.employeeId.toUpperCase(),
      status: data.status || 'DRAFT',
      version: 1,
      recalculatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.payrollRecords.set(key, record);
    return record;
  }

  findPayrollRecords(query = {}) {
    const results = [];
    for (const rec of this.payrollRecords.values()) {
      let match = true;
      if (query.employeeId && rec.employeeId !== query.employeeId.toUpperCase()) match = false;
      if (query.month && Number(rec.month) !== Number(query.month)) match = false;
      if (query.year && Number(rec.year) !== Number(query.year)) match = false;
      if (query.status && rec.status !== query.status.toUpperCase()) match = false;
      if (match) results.push(rec);
    }
    return results;
  }

  findPayrollRecordById(id) {
    for (const rec of this.payrollRecords.values()) {
      if (rec._id === id) return rec;
    }
    return null;
  }

  updatePayrollStatus(id, newStatus) {
    const record = this.findPayrollRecordById(id);
    if (!record) return null;
    record.status = newStatus.toUpperCase();
    record.updatedAt = new Date();
    return record;
  }

  clear() {
    this.employees.clear();
    this.salaryStructures.clear();
    this.payrollRecords.clear();
    this.contributionRules.clear();
    this.initDefaultStatutoryRules();
  }
}

const inMemoryStore = new InMemoryStore();
module.exports = inMemoryStore;
