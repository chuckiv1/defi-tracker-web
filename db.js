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

      CREATE TABLE IF NOT EXISTS account_presence (
        accountId VARCHAR(50) PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        lastSeen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

      CREATE TABLE IF NOT EXISTS loops (
        id VARCHAR(50) PRIMARY KEY,
        profileId VARCHAR(50) REFERENCES profiles(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        startDate TIMESTAMP NOT NULL,
        endDate TIMESTAMP,
        collateralToken VARCHAR(50) NOT NULL,
        borrowToken VARCHAR(50) NOT NULL,
        initialCollateral NUMERIC NOT NULL,
        borrowApr NUMERIC NOT NULL,
        supplyAmount NUMERIC DEFAULT 0,
        borrowAmount NUMERIC DEFAULT 0,
        startCollateral NUMERIC NOT NULL,
        collateralPrice NUMERIC NOT NULL,
        startCollateralAmount NUMERIC NOT NULL,
        supplyApy NUMERIC NOT NULL,
        borrowedAmount NUMERIC NOT NULL,
        borrowApy NUMERIC NOT NULL,
        endCollateralAmount NUMERIC DEFAULT 0,
        endBorrowedAmount NUMERIC DEFAULT 0,
        leverage NUMERIC NOT NULL DEFAULT 1,
        status VARCHAR(20) DEFAULT 'active',
        notes TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS loop_updates (
        id VARCHAR(50) PRIMARY KEY,
        loopId VARCHAR(50) REFERENCES loops(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        supplyAmount NUMERIC,
        borrowAmount NUMERIC,
        leverage NUMERIC,
        note TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(50) PRIMARY KEY,
        senderAccountId VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        conversationId VARCHAR(50),
        parentMessageId VARCHAR(50) REFERENCES messages(id) ON DELETE SET NULL,
        targetType VARCHAR(20) NOT NULL DEFAULT 'direct',
        targetAccountId VARCHAR(50) REFERENCES accounts(id) ON DELETE SET NULL,
        audiencePreset VARCHAR(50),
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'info',
        category VARCHAR(30) NOT NULL DEFAULT 'system',
        linkUrl TEXT,
        isPinned BOOLEAN DEFAULT false,
        expiresAt TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        scheduledAt TIMESTAMP,
        sentAt TIMESTAMP,
        withdrawnAt TIMESTAMP,
        readTracking BOOLEAN DEFAULT true,
        emailMirror BOOLEAN DEFAULT false,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS message_recipients (
        messageId VARCHAR(50) REFERENCES messages(id) ON DELETE CASCADE,
        accountId VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        readAt TIMESTAMP,
        archived BOOLEAN DEFAULT false,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (messageId, accountId)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderAccountId, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, scheduledAt, sentAt);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, createdAt ASC);
      CREATE INDEX IF NOT EXISTS idx_message_recipients_account ON message_recipients(accountId, readAt);
    `);
    await pool.query(`
      UPDATE accounts
      SET role = 'owner'
      WHERE LOWER(email) = LOWER('tom.schreiber.ts@gmail.com')
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
