const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL ist erforderlich. Bitte in der Umgebung setzen.');
}

function parseBootstrapEmails(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function applyBootstrapRoles() {
  const ownerEmails = parseBootstrapEmails('OWNER_EMAILS');
  const adminEmails = parseBootstrapEmails('ADMIN_EMAILS');

  if (ownerEmails.length) {
    await pool.query(
      'UPDATE accounts SET role = $1 WHERE LOWER(email) = ANY($2::text[])',
      ['owner', ownerEmails],
    );
  }

  if (adminEmails.length) {
    await pool.query(
      "UPDATE accounts SET role = $1 WHERE LOWER(email) = ANY($2::text[]) AND role <> 'owner'",
      ['admin', adminEmails],
    );
  }
}

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

      CREATE TABLE IF NOT EXISTS email_verification_logs (
        id VARCHAR(50) PRIMARY KEY,
        accountId VARCHAR(50) REFERENCES accounts(id) ON DELETE CASCADE,
        tokenHash VARCHAR(255) NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        usedAt TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_email_verification_logs_token_hash ON email_verification_logs(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_email_verification_logs_account_id ON email_verification_logs(accountId, createdAt DESC);

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
        currentCollateralAmount NUMERIC DEFAULT 0,
        currentBorrowedAmount NUMERIC DEFAULT 0,
        leverage NUMERIC NOT NULL DEFAULT 1,
        status VARCHAR(20) DEFAULT 'active',
        notes TEXT,
        pegReferenceToken VARCHAR(50),
        pegEntryPrice NUMERIC,
        supplyPegStart NUMERIC,
        supplyPegStartAt TIMESTAMP,
        currentAmountsUpdatedAt TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE loops ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS pegReferenceToken VARCHAR(50);
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS pegEntryPrice NUMERIC;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS currentCollateralAmount NUMERIC DEFAULT 0;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS currentBorrowedAmount NUMERIC DEFAULT 0;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS supplyPegStart NUMERIC;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS supplyPegStartAt TIMESTAMP;
      ALTER TABLE loops ADD COLUMN IF NOT EXISTS currentAmountsUpdatedAt TIMESTAMP;

      CREATE TABLE IF NOT EXISTS loop_borrow_rate_snapshots (
        id VARCHAR(50) PRIMARY KEY,
        loopId VARCHAR(50) REFERENCES loops(id) ON DELETE CASCADE,
        profileId VARCHAR(50) REFERENCES profiles(id) ON DELETE CASCADE,
        capturedAt TIMESTAMP NOT NULL,
        borrowApr NUMERIC NOT NULL,
        source VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_loop_borrow_rate_snapshots_loop ON loop_borrow_rate_snapshots(loopId, capturedAt DESC);

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
      UPDATE loops
      SET supplyPegStart = 1.2517,
          supplyPegStartAt = COALESCE(startDate, createdAt, CURRENT_TIMESTAMP)
      WHERE UPPER(collateralToken) = 'SAVAX'
        AND supplyPegStart IS NULL
    `);

    await applyBootstrapRoles();
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params),
};
