/**
 * Database Connection Manager (MongoDB via Mongoose)
 * Handles connection lifecycle, event logging, and graceful offline fallback.
 */

const mongoose = require('mongoose');
const env = require('./env');

let isConnected = false;

/**
 * Initializes connection to MongoDB if MONGODB_URI is provided.
 * @returns {Promise<boolean>} Whether connection succeeded
 */
async function connectDatabase() {
  if (!env.isDbConfigured()) {
    console.log('ℹ️ [Database] MONGODB_URI not configured. Operating in OFFLINE/IN-MEMORY fallback mode.');
    isConnected = false;
    return false;
  }

  try {
    console.log('⏳ [Database] Connecting to MongoDB...');
    
    // Set Mongoose options
    mongoose.set('strictQuery', true);

    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });

    isConnected = true;
    console.log('✅ [Database] MongoDB connected successfully.');
    return true;
  } catch (error) {
    console.warn(`⚠️ [Database] Connection failed: ${error.message}. Continuing in OFFLINE fallback mode.`);
    isConnected = false;
    return false;
  }
}

// Mongoose connection event listeners
mongoose.connection.on('connected', () => {
  isConnected = true;
  console.log('📢 [Database Event] Mongoose connected to MongoDB cluster.');
});

mongoose.connection.on('error', (err) => {
  isConnected = false;
  console.error(`❌ [Database Event] Mongoose connection error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('🔌 [Database Event] Mongoose disconnected.');
});

/**
 * Gracefully closes MongoDB connection on server shutdown.
 */
async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    isConnected = false;
    console.log('💤 [Database] MongoDB connection closed.');
  }
}

/**
 * Returns whether MongoDB connection is currently active.
 * @returns {boolean}
 */
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isDbConnected
};
