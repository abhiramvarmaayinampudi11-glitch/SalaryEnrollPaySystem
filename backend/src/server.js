/**
 * Server Entry Point
 * Starts HTTP Server on PORT 5000 with MongoDB connection and graceful offline/mock fallback.
 */

const app = require('./app');
const env = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');

async function startServer() {
  console.log('----------------------------------------------------');
  console.log('🚀 Salary Enroll Pay System – Backend Engine (Member 1)');
  console.log(`🌍 Environment: ${env.NODE_ENV}`);
  console.log('----------------------------------------------------');

  // Attempt Database Connection
  await connectDatabase();

  // Check Groq AI Configuration
  if (env.isGroqConfigured()) {
    console.log('✅ [Groq AI] API key detected.');
  } else {
    console.log('ℹ️ [Groq AI] GROQ_API_KEY not configured. Operating in OFFLINE/MOCK fallback mode.');
  }

  // Start HTTP Listener
  const server = app.listen(env.PORT, () => {
    console.log(`🎯 Server listening on http://localhost:${env.PORT}`);
    console.log(`🩺 Health check: http://localhost:${env.PORT}/api/health`);
    console.log(`👥 Employees API: http://localhost:${env.PORT}/api/employees`);
    console.log(`💰 Payroll API: http://localhost:${env.PORT}/api/payroll`);
    console.log('----------------------------------------------------');
  });

  // Graceful Shutdown
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await disconnectDatabase();
      console.log('💤 Server and connections closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { startServer };
