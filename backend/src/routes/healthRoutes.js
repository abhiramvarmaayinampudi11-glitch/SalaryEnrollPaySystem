/**
 * Health and Diagnostics Routes
 * Endpoint: GET /api/health
 */

const express = require('express');
const router = express.Router();
const env = require('../config/env');
const mongoose = require('mongoose');

router.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected (offline/mock mode)',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const healthData = {
    status: 'UP',
    service: 'Salary Enroll Pay System – Backend Engine',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    port: env.PORT,
    modules: {
      calculations: 'operational (EPF, ESIC, PT, TDS, Gratuity, Payroll)',
      database: {
        configured: env.isDbConfigured(),
        status: dbStatusMap[dbState] || 'unknown',
        mode: env.isDbConfigured() ? 'live' : 'offline/mock'
      },
      groqAi: {
        configured: env.isGroqConfigured(),
        mode: env.isGroqConfigured() ? 'live' : 'offline/mock'
      }
    }
  };

  res.status(200).json({
    success: true,
    data: healthData
  });
});

module.exports = router;
