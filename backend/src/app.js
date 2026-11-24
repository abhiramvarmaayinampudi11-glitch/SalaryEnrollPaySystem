/**
 * Express Application Setup
 * Configures middleware, security, routes, and centralized error handling.
 */

const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const statutoryRuleRoutes = require('./routes/statutoryRuleRoutes');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow frontend development clients
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-role', 'x-admin-key']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health & Diagnostics Route
app.use('/api', healthRoutes);

// Statutory Rules Management Routes
app.use('/api/statutory-rules', statutoryRuleRoutes);

// Employee Management Routes
app.use('/api/employees', employeeRoutes);

// Payroll & Statutory Calculation Routes
app.use('/api/payroll', payrollRoutes);

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Centralized Global Error Handler
app.use(globalErrorHandler);

module.exports = app;
