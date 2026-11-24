/**
 * Payroll Record Model Alias
 * Points directly to MonthlyPayroll for unified schema representation and backward compatibility.
 */

const MonthlyPayroll = require('./MonthlyPayroll');

module.exports = MonthlyPayroll;
