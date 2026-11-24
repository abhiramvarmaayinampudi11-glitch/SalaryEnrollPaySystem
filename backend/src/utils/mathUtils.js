/**
 * Precision Math Utilities for Financial and Payroll Calculations
 * Avoids IEEE-754 floating point drift and ensures consistent statutory rounding.
 */

/**
 * Rounds a number to 2 decimal places using exponential notation to avoid rounding errors.
 * Example: round2(1.005) -> 1.01
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  return Number(Math.round(Number(value + 'e2')) + 'e-2');
}

/**
 * Rounds to nearest whole integer (standard for PF deductions in EPFO rules).
 * @param {number} value
 * @returns {number}
 */
function roundNearest(value) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  return Math.round(Number(value));
}

/**
 * Rounds up to the next higher integer (ESIC statutory rule: fraction of a rupee is rounded up).
 * @param {number} value
 * @returns {number}
 */
function roundUp(value) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  return Math.ceil(Number(value));
}

/**
 * Safely sums an array of numbers with 2-decimal precision.
 * @param {...number} numbers
 * @returns {number}
 */
function safeSum(...numbers) {
  const total = numbers.reduce((acc, curr) => {
    const val = Number(curr);
    return acc + (isNaN(val) ? 0 : val);
  }, 0);
  return round2(total);
}

/**
 * Clamps a number between min and max bounds.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  const num = Number(val) || 0;
  return Math.max(min, Math.min(max, num));
}

module.exports = {
  round2,
  roundNearest,
  roundUp,
  safeSum,
  clamp
};
