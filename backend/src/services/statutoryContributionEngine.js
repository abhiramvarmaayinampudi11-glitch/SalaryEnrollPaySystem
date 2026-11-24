/**
 * Separate Statutory Contribution Calculation Engine
 * 
 * Independently calculates:
 * - Employee EPF
 * - Employee ESIC
 * - Employer EPF
 * - Employer EPS (Pension)
 * - Employer EDLI
 * - Employer Admin Charges
 * - Employer ESIC
 * 
 * Core Architectural Principles:
 * 1. Dynamic Rule Fetching: Resolves rates, wage definitions, ceilings, and effective dates from MongoDB/In-Memory rules.
 * 2. Distinct Wage Definitions: Never assumes PF wages equal Gross wages or ESIC wages equal PF wages.
 * 3. Employee-Specific Eligibility: Evaluates individual PF, EPS (e.g. age < 58), EDLI, and ESIC flags (disability limit).
 * 4. Employer EPF Allocation after EPS: Employer EPF = Total Employer 12% - EPS. (If EPS ineligible, EPF receives full 12%).
 * 5. Statutory Rounding: EPFO rounds to nearest whole rupee; ESIC fraction rounds up to next rupee.
 * 6. Non-Contributing Period (NCP): Wages are prorated before applying ceilings.
 * 7. Immutable Rule Snapshot: Preserves exact rule version, effective date, and rates applied.
 * 8. Zero Double Counting: Strictly separates Employee Deductions from Employer CTC Costs.
 */

const { resolveApplicableRule } = require('../controllers/statutoryRuleController');
const { round2, roundNearest, roundUp, safeSum } = require('../utils/mathUtils');
const { STATUTORY_RULES } = require('../config/statutoryRules');

/**
 * Calculates complete statutory contributions for an employee.
 *
 * @param {Object} params
 * @param {string} [params.employeeId='EMP'] - Employee identifier
 * @param {number} [params.age] - Employee age (used for EPS eligibility; EPS stops at age 58)
 * @param {boolean} [params.isPfEligible=true] - Whether employee is enrolled in PF
 * @param {boolean} [params.isEpsEligible=true] - Whether employee is eligible for pension scheme
 * @param {boolean} [params.isEdliEligible=true] - Whether employee is covered by EDLI
 * @param {boolean} [params.capPfAtWageCeiling=true] - Enforce statutory PF wage ceiling (₹15,000)
 * @param {number|null} [params.voluntaryPfRate=null] - Custom voluntary PF employee contribution rate
 * @param {boolean|null} [params.isEsicEligible=null] - ESIC eligibility flag (auto-evaluated if null)
 * @param {boolean} [params.hasDisability=false] - Whether higher disability wage limit applies for ESIC
 * @param {number} [params.workingDays=30] - Total working/calendar days in period
 * @param {number} [params.paidDays=30] - Days worked/paid
 * @param {number} [params.ncpDays=0] - Non-Contributing Period / unpaid leave days
 * @param {number} [params.basicSalary=0] - Nominal monthly basic wage
 * @param {number} [params.da=0] - Nominal monthly Dearness Allowance
 * @param {Object|number} [params.allowances={}] - Other allowances (HRA, Conveyance, Special, etc.)
 * @param {number} [params.overtimeAmount=0] - Overtime earnings
 * @param {number} [params.bonus=0] - Bonus or incentive earnings
 * @param {number|null} [params.pfWages=null] - Explicit override for PF wages
 * @param {number|null} [params.esicWages=null] - Explicit override for ESIC wages
 * @param {Date|string} [params.payrollDate=new Date()] - Payroll period date for resolving statutory rules
 * @param {Object|null} [params.customRule=null] - Explicit statutory rule override (bypasses DB lookup)
 * @returns {Promise<Object>} Detailed statutory contributions breakdown and rule snapshot
 */
async function calculateStatutoryContributions({
  employeeId = 'EMP',
  age = null,
  isPfEligible = true,
  isEpsEligible = true,
  isEdliEligible = true,
  capPfAtWageCeiling = true,
  voluntaryPfRate = null,
  isEsicEligible = null,
  hasDisability = false,
  workingDays = 30,
  paidDays,
  ncpDays = 0,
  basicSalary = 0,
  da = 0,
  allowances = {},
  overtimeAmount = 0,
  bonus = 0,
  pfWages = null,
  esicWages = null,
  payrollDate = new Date(),
  customRule = null
}) {
  // 1. Resolve Effective Statutory Rule from MongoDB / In-Memory Store
  const targetDate = new Date(payrollDate);
  let rule = customRule;
  if (!rule) {
    rule = await resolveApplicableRule(targetDate);
  }

  // Fallback to legal statutory defaults if no rule found
  if (!rule) {
    rule = {
      ruleCode: 'STATUTORY_FALLBACK_LEGAL',
      version: 1,
      effectiveFrom: new Date('2019-07-01'),
      pf: { ...STATUTORY_RULES.pf },
      esic: { ...STATUTORY_RULES.esic }
    };
  }

  const pfRules = rule.pf || STATUTORY_RULES.pf;
  const esicRules = rule.esic || STATUTORY_RULES.esic;

  // 2. Attendance & NCP Proration Factor
  const totalDays = Math.max(1, Number(workingDays) || 30);
  const inputNcp = Math.max(0, Number(ncpDays) || 0);

  let effectivePaidDays;
  let effectiveNcpDays;

  if (paidDays !== undefined && paidDays !== null) {
    effectivePaidDays = Math.max(0, Math.min(totalDays, Number(paidDays)));
    effectiveNcpDays = Math.max(0, totalDays - effectivePaidDays);
  } else {
    effectiveNcpDays = Math.min(totalDays, inputNcp);
    effectivePaidDays = Math.max(0, totalDays - effectiveNcpDays);
  }

  const prorationRatio = totalDays > 0 ? round2(effectivePaidDays / totalDays) : 1;

  // 3. Compute Distinct Wage Bases (Never assume PF wages === ESIC wages === Gross wages!)
  // Nominal components
  const nomBasic = Math.max(0, Number(basicSalary) || 0);
  const nomDa = Math.max(0, Number(da) || 0);

  let nomAllowances = 0;
  if (typeof allowances === 'number') {
    nomAllowances = Math.max(0, allowances);
  } else if (typeof allowances === 'object' && allowances !== null) {
    for (const val of Object.values(allowances)) {
      const num = Number(val);
      if (!isNaN(num) && num > 0) nomAllowances += num;
    }
  }

  // Attendance Prorated components
  const earnedBasic = round2(nomBasic * prorationRatio);
  const earnedDa = round2(nomDa * prorationRatio);
  const earnedAllowances = round2(nomAllowances * prorationRatio);
  const earnedOt = Math.max(0, Number(overtimeAmount) || 0);
  const earnedBonus = Math.max(0, Number(bonus) || 0);

  // A. PF Wages: Defined as Basic + DA (prorated by attendance)
  const resolvedPfWages = pfWages !== null && pfWages !== undefined
    ? Math.max(0, Number(pfWages))
    : safeSum(earnedBasic, earnedDa);

  // B. ESIC Wages: Gross wages earned (Basic + DA + Allowances + OT + Bonus)
  const resolvedEsicWages = esicWages !== null && esicWages !== undefined
    ? Math.max(0, Number(esicWages))
    : safeSum(earnedBasic, earnedDa, earnedAllowances, earnedOt, earnedBonus);

  // Gross Wages for reference
  const grossWages = safeSum(earnedBasic, earnedDa, earnedAllowances, earnedOt, earnedBonus);

  // =========================================================================
  // 4. EPFO / PF Independent Calculations
  // =========================================================================
  let employeeEpf = 0;
  let employerEpf = 0;
  let employerEps = 0;
  let employerEdli = 0;
  let employerAdminCharges = 0;

  // Age-based Pension Check: Under EPS 1995, pension contribution stops at age 58
  const employeeAge = age !== null && age !== undefined ? Number(age) : null;
  const isEpsEligibleByAge = employeeAge !== null ? employeeAge < 58 : true;
  const finalEpsEligibility = isPfEligible && isEpsEligible && isEpsEligibleByAge;

  let pfWageSubjectToEpf = 0;
  let epsWages = 0;

  if (isPfEligible && resolvedPfWages > 0) {
    // Determine wage subject to Employee PF
    const shouldCap = capPfAtWageCeiling !== undefined ? capPfAtWageCeiling : true;
    pfWageSubjectToEpf = shouldCap
      ? Math.min(resolvedPfWages, pfRules.wageCeiling)
      : resolvedPfWages;

    // A. Employee EPF Contribution (12% of subject wage, rounded to nearest integer)
    const empRate = voluntaryPfRate !== null && voluntaryPfRate > 0
      ? Number(voluntaryPfRate)
      : pfRules.employeeRate;

    employeeEpf = roundNearest(pfWageSubjectToEpf * empRate);

    // B. Total Employer 12% Contribution pool
    const employerTotal12Percent = roundNearest(pfWageSubjectToEpf * pfRules.employerTotalRate);

    // C. Employer EPS (Pension): Strictly capped at wage ceiling (₹15,000)
    epsWages = Math.min(resolvedPfWages, pfRules.wageCeiling);

    if (finalEpsEligibility) {
      const rawEps = epsWages * pfRules.employerEpsRate;
      employerEps = Math.min(roundNearest(rawEps), pfRules.epsMaxCap);
    } else {
      // If employee is 58+ years or EPS ineligible, EPS contribution is 0
      employerEps = 0;
    }

    // D. Employer EPF: Balance of Total Employer 12% pool minus EPS
    // If EPS is 0 (e.g. age >= 58), entire 12% pool is allocated to Employer EPF!
    employerEpf = Math.max(0, employerTotal12Percent - employerEps);

    // E. Employer EDLI (0.5% capped at EDLI wage ceiling)
    if (isEdliEligible) {
      const edliWages = Math.min(resolvedPfWages, pfRules.edliWageCeiling);
      employerEdli = roundNearest(edliWages * pfRules.edliRate);
    }

    // F. Employer Admin Charges (0.5% of subject wage)
    employerAdminCharges = roundNearest(pfWageSubjectToEpf * pfRules.adminChargesRate);
  }

  const totalEmployerPf = safeSum(employerEpf, employerEps, employerEdli, employerAdminCharges);

  // =========================================================================
  // 5. ESIC Independent Calculations
  // =========================================================================
  let employeeEsic = 0;
  let employerEsic = 0;
  let dailyAverageWage = 0;
  let isExemptFromEmployeeEsic = false;

  const applicableEsicLimit = hasDisability
    ? esicRules.disabilityWageLimit
    : esicRules.wageLimit;

  // Determine eligibility
  const isEsicCovered = isEsicEligible !== null
    ? Boolean(isEsicEligible)
    : (resolvedEsicWages > 0 && resolvedEsicWages <= applicableEsicLimit);

  if (isEsicCovered && resolvedEsicWages > 0) {
    // Average daily wage check for exemption (daily wage <= 176)
    dailyAverageWage = effectivePaidDays > 0 ? round2(resolvedEsicWages / effectivePaidDays) : 0;
    isExemptFromEmployeeEsic = dailyAverageWage > 0 && dailyAverageWage <= esicRules.dailyWageExemptionLimit;

    // A. Employee ESIC (0.75%, fraction rounded up to next rupee per statutory rules)
    employeeEsic = isExemptFromEmployeeEsic ? 0 : roundUp(resolvedEsicWages * esicRules.employeeRate);

    // B. Employer ESIC (3.25%, rounded up; Employer still pays even if employee is exempt!)
    employerEsic = roundUp(resolvedEsicWages * esicRules.employerRate);
  }

  const totalEmployerEsic = employerEsic;

  // =========================================================================
  // 6. Summary, Rule Snapshot & Integrity Verifications
  // =========================================================================
  const totalEmployeeDeductions = safeSum(employeeEpf, employeeEsic);
  const totalEmployerContributions = safeSum(totalEmployerPf, totalEmployerEsic);

  const ruleSnapshot = {
    ruleId: rule._id || 'BASELINE',
    ruleCode: rule.ruleCode || 'STATUTORY_STD',
    version: rule.version || 1,
    effectiveFrom: rule.effectiveFrom || '2019-07-01',
    effectiveTo: rule.effectiveTo || null,
    pf: {
      wageCeiling: pfRules.wageCeiling,
      epsMaxCap: pfRules.epsMaxCap,
      employeeRate: pfRules.employeeRate,
      employerTotalRate: pfRules.employerTotalRate,
      employerEpfRate: pfRules.employerEpfRate,
      employerEpsRate: pfRules.employerEpsRate,
      edliRate: pfRules.edliRate,
      adminChargesRate: pfRules.adminChargesRate
    },
    esic: {
      wageLimit: esicRules.wageLimit,
      disabilityWageLimit: esicRules.disabilityWageLimit,
      employeeRate: esicRules.employeeRate,
      employerRate: esicRules.employerRate,
      dailyWageExemptionLimit: esicRules.dailyWageExemptionLimit
    },
    resolvedAt: new Date().toISOString()
  };

  return {
    employeeId,
    period: {
      payrollDate: targetDate.toISOString().split('T')[0],
      workingDays: totalDays,
      paidDays: effectivePaidDays,
      ncpDays: effectiveNcpDays,
      prorationRatio
    },
    wageBreakdown: {
      grossWages,
      pfWages: resolvedPfWages,
      esicWages: resolvedEsicWages,
      pfWageSubjectToEpf,
      epsWages,
      wagesDistinct: resolvedPfWages !== resolvedEsicWages,
      explanation: 'PF Wages (Basic + DA) and ESIC Wages (Gross) are calculated independently as per statute.'
    },
    eligibilitySummary: {
      isPfEligible,
      isEpsEligible: finalEpsEligibility,
      epsAgeRestricted: employeeAge !== null && employeeAge >= 58,
      employeeAge,
      isEdliEligible,
      capPfAtWageCeiling,
      isEsicCovered,
      hasDisability,
      applicableEsicLimit,
      dailyAverageWage,
      isExemptFromEmployeeEsic
    },
    // Strictly Employee-side Deductions
    employeeDeductions: {
      epf: employeeEpf,
      esic: employeeEsic,
      totalEmployeeDeductions
    },
    // Strictly Employer-side Contributions (CTC Costs)
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
        total: totalEmployerEsic
      },
      totalEmployerContributions
    },
    ruleSnapshot,
    auditTrail: {
      ratesSource: `ContributionRule [${ruleSnapshot.ruleCode} v${ruleSnapshot.version}]`,
      employerPfAllocationFormula: 'Employer EPF = Total 12% Pool - EPS',
      zeroDoubleCounting: true,
      employerCostsExcludedFromEmployeeDeductions: true,
      calculatedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  calculateStatutoryContributions
};
