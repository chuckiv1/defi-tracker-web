const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/defitracker',
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        salt VARCHAR(255) NOT NULL,
        passHash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        isVerified BOOLEAN DEFAULT false,
        verifyToken VARCHAR(255),
        isBlocked BOOLEAN DEFAULT false,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(50) PRIMARY KEY,
        accountId VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        data JSONB DEFAULT '[]'::jsonb,
        frf JSONB DEFAULT '{"exchanges": [], "positions": []}'::jsonb,
        undo JSONB DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS account_logins (
        id VARCHAR(50) PRIMARY KEY,
        accountId VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        loginDate DATE NOT NULL,
        UNIQUE(accountId, loginDate)
      );
      CREATE TABLE IF NOT EXISTS feature_requests (
        id VARCHAR(50) PRIMARY KEY,
        account_id VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        createdat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_votes (
        request_id VARCHAR(50) REFERENCES feature_requests(id) ON DELETE CASCADE,
        account_id VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        createdat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (request_id, account_id)
      );
    `);
    console.log("✅ Database initialized successfully.");
  } catch (err) {
    console.error("❌ Error initializing database:", err);
  }
}

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params),
};
