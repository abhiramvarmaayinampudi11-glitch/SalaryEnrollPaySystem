const path = require('path');
const dotenv = require('dotenv');

// Attempt to load .env from backend folder first, then parent project root
const backendEnvPath = path.resolve(__dirname, '../../.env');
const rootEnvPath = path.resolve(__dirname, '../../../.env');

dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootEnvPath });

const env = {
  PORT: parseInt(process.env.PORT, 10) || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI ? process.env.MONGODB_URI.trim() : '',
  GROQ_API_KEY: process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : '',
  
  // Status flags for graceful offline fallback
  isDbConfigured() {
    return Boolean(this.MONGODB_URI && this.MONGODB_URI.length > 0);
  },
  
  isGroqConfigured() {
    return Boolean(this.GROQ_API_KEY && this.GROQ_API_KEY.length > 0);
  }
};

module.exports = env;
