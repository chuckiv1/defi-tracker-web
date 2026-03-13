require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('./db');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
const APP_URL = process.env.APP_URL || 'https://defivault.cloud';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';
const VERIFY_RESEND_LIMIT_MS = 10000;
const verifyResendCooldowns = new Map();

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER || "", pass: process.env.SMTP_PASS || "" }
};

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

db.initDB(); // Initialisiere Datenbanktabellen beim Start

function gid() { return crypto.randomBytes(16).toString('hex'); }
function hashPass(password, salt) { return crypto.pbkdf2Sync(password, salt, 210000, 64, 'sha512').toString('hex'); }

// E-Mail Sender (Fallback auf Konsole)
async function sendMail(to, subject, html) {
  if (!SMTP_CONFIG.host) {
    console.log(`\n=== E-MAIL SIMULATION ===\nAn: ${to}\nBetreff: ${subject}\nInhalt (Link): ${html.match(/href="([^"]*)"/)[1]}\n=========================\n`);
    return true;
  }
  try {
    let transporter = nodemailer.createTransport(SMTP_CONFIG);
    await transporter.sendMail({ from: `"DeFi Vault" <${SMTP_CONFIG.auth.user}>`, to, subject, html });
    console.log(`✅ Mail erfolgreich an ${to} gesendet.`);
    return true;
  } catch (e) { 
    console.error("❌ Mail-Fehler beim Senden an", to, ":", e.message); 
    console.error("Stack:", e);
    return false; 
  }
}

// Globale Auth-Prüfung
app.use(async (req, res, next) => {
  const token = req.cookies.dv_session;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [decoded.accountId]);
    if (rows.length > 0) {
      req.account = rows[0];
    }
  } catch (e) {
    // Ungültiger oder abgelaufener Token
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'Nicht eingeloggt' });
  if (req.account.isblocked) return res.status(403).json({ error: 'Account blockiert' });
  if (!req.account.isverified) return res.status(403).json({ error: 'E-Mail nicht verifiziert' });
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.account.role !== 'admin') return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
    next();
  });
}

async function attachProfile(req, res, next) {
  const profileId = req.headers['x-profile-id'];
  if (!profileId) return res.status(400).json({ error: 'Kein Profil ausgewählt' });
  
  try {
    const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1 AND accountid = $2', [profileId, req.account.id]);
    if (rows.length === 0) return res.status(403).json({ error: 'Profil Zugriff verweigert' });
    req.profile = rows[0];
    if(!req.profile.data) req.profile.data = [];
    if(!req.profile.frf) req.profile.frf = { exchanges: [], positions: [] };
    if(!req.profile.undo) req.profile.undo = [];
    next();
  } catch(e) {
    res.status(500).json({ error: "Fehler beim Laden des Profils" });
  }
}

async function saveProfile(req) {
  await db.query('UPDATE profiles SET data = $1, frf = $2, undo = $3 WHERE id = $4 AND accountid = $5', [
    JSON.stringify(req.profile.data), JSON.stringify(req.profile.frf), JSON.stringify(req.profile.undo),
    req.profile.id, req.account.id
  ]);
}

// ============================================
// AUTH & ACCOUNT API
// ============================================
app.get('/api/auth/status', async (req, res) => {
  if (!req.account) return res.json({ loggedIn: false });
  const { rows: profiles } = await db.query('SELECT id, name FROM profiles WHERE accountid = $1', [req.account.id]);
  res.json({ loggedIn: true, account: { email: req.account.email, role: req.account.role }, profiles });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Ungültige Daten' });
  
  const { rows: existing } = await db.query('SELECT id FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing.length > 0) return res.status(400).json({ error: 'E-Mail existiert bereits' });
  
  const { rows: allAccs } = await db.query('SELECT count(id) as count FROM accounts');
  const isFirstUser = parseInt(allAccs[0].count) === 0;
  
  const salt = crypto.randomBytes(16).toString('hex');
  const verifyToken = gid();
  const accId = gid();
  const passHash = hashPass(password, salt);
  const role = isFirstUser ? 'admin' : 'user';
  
  await db.query(
    'INSERT INTO accounts (id, email, salt, passHash, role, isVerified, verifyToken, isBlocked) VALUES ($1, $2, $3, $4, $5, false, $6, false)',
    [accId, email, salt, passHash, role, verifyToken]
  );
  
  const link = `${APP_URL}/verify.html?token=${verifyToken}`;
  await sendMail(email, "DeFi Vault - Bitte verifiziere deine E-Mail", `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
  res.json({ ok: 1 });
});

app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body;
  const { rows } = await db.query('SELECT * FROM accounts WHERE verifyToken = $1', [token]);
  if (rows.length === 0) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link' });
  
  const acc = rows[0];
  await db.query('UPDATE accounts SET isVerified = true, verifyToken = NULL WHERE id = $1', [acc.id]);
  
  // Automatisches Standard-Profil anlegen
  await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [gid(), acc.id, 'Main Wallet']);
  
  res.json({ ok: 1 });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Ungültige E-Mail' });

  const now = Date.now();
  const lastSentAt = verifyResendCooldowns.get(email) || 0;
  const waitMs = VERIFY_RESEND_LIMIT_MS - (now - lastSentAt);
  if (waitMs > 0) {
    return res.status(429).json({ error: 'Bitte warte kurz vor dem nächsten Versand', retryAfterMs: waitMs });
  }

  const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
  if (rows.length === 0) return res.status(404).json({ error: 'Kein Account mit dieser E-Mail gefunden' });

  const acc = rows[0];
  if (acc.isverified) return res.status(400).json({ error: 'E-Mail ist bereits verifiziert' });

  const verifyToken = acc.verifytoken || gid();
  if (!acc.verifytoken) {
    await db.query('UPDATE accounts SET verifyToken = $1 WHERE id = $2', [verifyToken, acc.id]);
  }

  const link = `${APP_URL}/verify.html?token=${verifyToken}`;
  await sendMail(acc.email, 'DeFi Vault - Bitte verifiziere deine E-Mail', `Klicke hier, um deinen Account freizuschalten: <a href="${link}">${link}</a>`);
  verifyResendCooldowns.set(email, now);
  res.json({ ok: 1, retryAfterMs: VERIFY_RESEND_LIMIT_MS });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('SELECT * FROM accounts WHERE LOWER(email) = LOWER($1)', [email]);
  if (rows.length === 0) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
  
  const acc = rows[0];
  if (acc.passhash !== hashPass(password, acc.salt)) return res.status(401).json({ error: 'Falsche E-Mail oder Passwort' });
  if (acc.isblocked) return res.status(403).json({ error: 'Account ist blockiert' });
  if (!acc.isverified) return res.status(403).json({ error: 'E-Mail noch nicht verifiziert' });
  
  // Track login
  const today = new Date().toISOString().split('T')[0];
  await db.query(
    'INSERT INTO account_logins (id, accountId, loginDate) VALUES ($1, $2, $3) ON CONFLICT (accountId, loginDate) DO NOTHING',
    [gid(), acc.id, today]
  ).catch(e => console.error("Fehler beim Login Tracking:", e));

  const token = jwt.sign({ accountId: acc.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('dv_session', token, { maxAge: 30*24*60*60*1000, httpOnly: true, path: '/' });
  res.json({ ok: 1 });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('dv_session'); res.json({ ok: 1 });
});

// ============================================
// PROFILE (WALLETS) API
// ============================================
app.post('/api/profiles', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  const pId = gid();
  await db.query('INSERT INTO profiles (id, accountid, name) VALUES ($1, $2, $3)', [pId, req.account.id, name]);
  res.json({ id: pId, accountId: req.account.id, name });
});
app.put('/api/profiles/:id', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const { rowCount } = await db.query('UPDATE profiles SET name = $1 WHERE id = $2 AND accountid = $3', [name, req.params.id, req.account.id]);
  if (rowCount === 0) return res.status(404).json({});
  res.json({ id: req.params.id, name });
});
app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  await db.query('DELETE FROM profiles WHERE id = $1 AND accountid = $2', [req.params.id, req.account.id]);
  res.json({ ok: 1 });
});

// ============================================
// LOOPING API
// ============================================
app.get('/api/loops', requireAuth, attachProfile, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM loops 
      WHERE profileId = $1 
      ORDER BY startDate DESC
    `, [req.profile.id]);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Laden'}); }
});

app.post('/api/loops', requireAuth, attachProfile, async (req, res) => {
  try {
    const { name, startDate, collateralToken, borrowToken, startCollateral, collateralPrice, 
            startCollateralAmount, supplyApy, borrowedAmount, borrowApy, endCollateralAmount, 
            endBorrowedAmount, leverage } = req.body;
    
    if (!name || !startDate || !collateralToken || !borrowToken || !startCollateral || !collateralPrice || 
        !startCollateralAmount || !supplyApy || !borrowApy) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen' });
    }
    
    const loopId = gid();
    const numericLeverage = parseFloat(leverage) || 1;
    const numericBorrowedAmount = parseFloat(borrowedAmount);
    const numericEndBorrowedAmount = parseFloat(endBorrowedAmount);
    const borrowAmountValue = Number.isFinite(numericBorrowedAmount) ? numericBorrowedAmount : (Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : 0);
    const supplyAmountValue = Number.isFinite(parseFloat(endCollateralAmount)) ? parseFloat(endCollateralAmount) : parseFloat(startCollateralAmount);
    
    await db.query(`
      INSERT INTO loops (id, profileId, name, startDate, collateralToken, borrowToken, 
        initialCollateral, supplyApy, borrowApr, supplyAmount, borrowAmount,
        startCollateral, collateralPrice, startCollateralAmount, borrowedAmount, borrowApy, 
        endCollateralAmount, endBorrowedAmount, leverage, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'active')
    `, [loopId, req.profile.id, name, startDate, collateralToken, borrowToken, 
        startCollateral, supplyApy, borrowApy, supplyAmountValue, borrowAmountValue,
        startCollateral, collateralPrice, startCollateralAmount, borrowAmountValue, borrowApy,
        endCollateralAmount || startCollateralAmount, Number.isFinite(numericEndBorrowedAmount) ? numericEndBorrowedAmount : borrowAmountValue, numericLeverage]);
    
    res.json({ id: loopId, ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Erstellen'}); }
});

app.put('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
  try {
    const { name, supplyApy, borrowApy, leverage, endCollateralAmount, endBorrowedAmount, status, notes } = req.body;
    const { rowCount } = await db.query(`
      UPDATE loops 
      SET name = $1, supplyApy = $2, borrowApr = $3, borrowApy = $3, leverage = $4, 
          supplyAmount = $5, borrowAmount = $6, endCollateralAmount = $5, endBorrowedAmount = $6, status = $7, notes = $8, updatedAt = CURRENT_TIMESTAMP
      WHERE id = $9 AND profileId = $10
    `, [name, supplyApy, borrowApy, leverage, endCollateralAmount, endBorrowedAmount, status, notes, req.params.id, req.profile.id]);
    
    if (rowCount === 0) return res.status(404).json({ error: 'Loop nicht gefunden' });
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Aktualisieren'}); }
});

app.delete('/api/loops/:id', requireAuth, attachProfile, async (req, res) => {
  try {
    await db.query('DELETE FROM loops WHERE id = $1 AND profileId = $2', [req.params.id, req.profile.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Löschen'}); }
});

app.post('/api/loops/:id/close', requireAuth, attachProfile, async (req, res) => {
  try {
    const { endDate, endCollateralAmount, endBorrowedAmount } = req.body;
    await db.query(`
      UPDATE loops 
      SET status = 'closed', endDate = $1, supplyAmount = $2, borrowAmount = $3, endCollateralAmount = $2, endBorrowedAmount = $3, updatedAt = CURRENT_TIMESTAMP
      WHERE id = $4 AND profileId = $5
    `, [endDate, endCollateralAmount, endBorrowedAmount, req.params.id, req.profile.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error: 'Fehler beim Schließen'}); }
});

// ============================================
// ADMIN API
// ============================================
app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT a.id, a.email, a.role, a.isverified, a.isblocked, a.createdat, COUNT(DISTINCT p.id) as "profileCount", COUNT(DISTINCT l.id) as "loginCount30d"
    FROM accounts a 
    LEFT JOIN profiles p ON a.id = p.accountid
    LEFT JOIN account_logins l ON a.id = l.accountid AND l.logindate >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY a.id ORDER BY a.createdat DESC
  `);
  res.json(rows);
});
app.get('/api/admin/accounts/:id/stats', requireAdmin, async (req, res) => {
  // Liefert die Logins der letzten 365 Tage für Charts
  const { rows } = await db.query(`
    SELECT logindate as date FROM account_logins 
    WHERE accountId = $1 AND logindate >= CURRENT_DATE - INTERVAL '365 days'
    ORDER BY logindate ASC
  `, [req.params.id]);
  res.json(rows.map(r => r.date));
});
app.put('/api/admin/accounts/:id/toggle-block', requireAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
  if (rows.length === 0 || rows[0].role === 'admin') return res.status(400).json({});
  await db.query('UPDATE accounts SET isblocked = NOT isblocked WHERE id = $1', [req.params.id]);
  res.json({ ok: 1 });
});
app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
  if (rows.length === 0 || rows[0].role === 'admin') return res.status(400).json({});
  await db.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  res.json({ ok: 1 });
});

app.get('/api/admin/features', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.title, r.description, r.status, r.createdat, a.email as author,
             (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) as votes
      FROM feature_requests r
      JOIN accounts a ON r.account_id = a.id
      ORDER BY r.createdat DESC
    `);
    res.json(rows);
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.put('/api/admin/features/:id/status', requireAdmin, async (req, res) => {
  try {
    await db.query('UPDATE feature_requests SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

// ============================================
// BACKUP API
// ============================================
app.get('/api/backup', requireAuth, attachProfile, (req, res) => {
  res.json({ backupVersion: "9.0", profileName: req.profile.name, timestamp: new Date().toISOString(), data: req.profile.data, frf: req.profile.frf });
});
// ============================================
// DEMO API (Unauthenticated)
// ============================================
app.get('/api/demo-data', (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'demo_data.json');
    const frfPath = path.join(__dirname, 'demo_frf.json');
    
    let demoData = [];
    let demoFrf = { exchanges: [], positions: [] };

    if (fs.existsSync(dataPath)) {
      demoData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    if (fs.existsSync(frfPath)) {
      demoFrf = JSON.parse(fs.readFileSync(frfPath, 'utf8'));
    }

    res.json({ data: demoData, frf: demoFrf });
  } catch (error) {
    console.error("Fehler beim Laden der Demo-Daten:", error);
    res.status(500).json({ error: "Fehler beim Laden der Demo-Daten." });
  }
});

app.post('/api/backup/restore', requireAuth, attachProfile, async (req, res) => {
  const { data, frf } = req.body;
  if (!data || !frf) return res.status(400).json({ error: "Ungültige Backup-Datei" });
  req.profile.data = data; req.profile.frf = frf;
  await saveProfile(req);
  res.json({ ok: 1 });
});

// ============================================
// EXPORT API (EXCEL)
// ============================================
app.get('/api/export/excel', requireAuth, attachProfile, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DeFi Vault';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Dashboard', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

    const FONT_ALL = { name: 'Arial', size: 10 };
    const FONT_HEADER = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const FONT_MAIN_ROW = { name: 'Arial', size: 10, bold: true };
    const FONT_SUB_ROW = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF555555' } };

    const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    const FILL_MAIN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    const FILL_SUB_INV = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    const FILL_SUB_REW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };

    ws.columns = [
      { header: 'Typ / Aktion', key: 'type', width: 22 },
      { header: 'Strategie / Datum', key: 'name_or_date', width: 35 },
      { header: 'Basis Token', key: 'token', width: 25 },
      { header: 'Investiert ($)', key: 'invested', width: 18 },
      { header: 'Belohnungen ($)', key: 'rewards', width: 18 },
      { header: 'Net PnL ($)', key: 'pnl', width: 18 },
      { header: 'Notizen', key: 'notes', width: 50 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = FONT_HEADER;
    headerRow.fill = FILL_HEADER;
    headerRow.height = 25;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    let currentRowCount = 2;

    req.profile.data.forEach((strategy) => {
      const investiert = strategy.investmentHistory.reduce((sum, current) => sum + current.amount, 0);
      const rewards = strategy.rewards.reduce((sum, current) => sum + current.amount, 0);
      const basisToken = strategy.token ? `${strategy.token.amount} ${strategy.token.name} (@ ${strategy.token.entryPrice})` : '-';
      
      const mainRow = ws.addRow({
        type: '📌 Strategie',
        name_or_date: strategy.name,
        token: basisToken,
        invested: investiert,
        rewards: rewards,
        pnl: (rewards - investiert) + investiert,
        notes: strategy.notes
      });

      mainRow.font = FONT_MAIN_ROW;
      mainRow.fill = FILL_MAIN;
      mainRow.height = 22;
      mainRow.getCell('invested').numFmt = '#,##0.00 $';
      mainRow.getCell('rewards').numFmt = '#,##0.00 $';
      mainRow.getCell('pnl').numFmt = '#,##0.00 $';
      mainRow.alignment = { vertical: 'middle' };
      
      currentRowCount++;

      strategy.investmentHistory.forEach(inv => {
        const subRow = ws.addRow({
          type: '    ➡️ Investition',
          name_or_date: new Date(inv.date).toLocaleDateString() + ' ' + new Date(inv.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          token: '', invested: inv.amount, rewards: '', pnl: '', notes: inv.note
        });
        subRow.font = FONT_SUB_ROW; subRow.fill = FILL_SUB_INV;
        subRow.getCell('invested').numFmt = '#,##0.00 $'; subRow.alignment = { vertical: 'middle' };
        subRow.outlineLevel = 1; currentRowCount++;
      });

      strategy.rewards.forEach(rew => {
        const subRow = ws.addRow({
          type: '    🎁 Belohnung',
          name_or_date: new Date(rew.date).toLocaleDateString() + ' ' + new Date(rew.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          token: '', invested: '', rewards: rew.amount, pnl: '', notes: rew.note
        });
        subRow.font = FONT_SUB_ROW; subRow.fill = FILL_SUB_REW;
        subRow.getCell('rewards').numFmt = '#,##0.00 $'; subRow.alignment = { vertical: 'middle' };
        subRow.outlineLevel = 1; currentRowCount++;
      });
      
      const divider = ws.addRow({}); divider.height = 10; currentRowCount++;
    });

    ws.eachRow({ includeEmpty: false }, function(row, rowNumber) {
      if (rowNumber === 1) return;
      row.eachCell({ includeEmpty: true }, function(cell) { if (!cell.font) cell.font = FONT_ALL; });
    });

    for(let i = currentRowCount; i <= Math.max(currentRowCount, 150); i++) {
       ws.getRow(i).outlineLevel = 0; ws.getRow(i).font = FONT_ALL;
    }

    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DeFi_Vault_${req.profile.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel Generation Error:", error);
    res.status(500).json({ error: 'Fehler beim Generieren der Excel Datei' });
  }
});

// ============================================
// DATEN API (STRATEGIEN & FRF)
// ============================================
app.get('/api/undo', requireAuth, attachProfile, (req, res) => { res.json(req.profile.undo.map((u, i) => ({ index: i, label: u.label, time: u.time }))); });
app.post('/api/undo/:index', requireAuth, attachProfile, async (req, res) => {
  const undo = req.profile.undo; const idx = parseInt(req.params.index, 10); if (idx < 0 || idx >= undo.length) return res.status(400).json({});
  req.profile.data = undo[idx].data; if (undo[idx].frf) req.profile.frf = undo[idx].frf;
  req.profile.undo = undo.slice(0, idx); 
  await saveProfile(req);
  res.json({ ok: 1 });
});

app.get('/api/strategies', requireAuth, attachProfile, (req, res) => { res.json(req.profile.data); });
app.get('/api/frf', requireAuth, attachProfile, (req, res) => { res.json(req.profile.frf); });

function svU(req, lbl) {
  const u = req.profile.undo; 
  u.push({ label: lbl, data: JSON.parse(JSON.stringify(req.profile.data)), frf: JSON.parse(JSON.stringify(req.profile.frf)), time: new Date().toISOString() });
  while(u.length>10) u.shift();
  req.profile.undo = u;
}

const router = express.Router();
app.use('/api', requireAuth, attachProfile, router);

router.post('/strategies', async (req, res) => { svU(req, 'Neue Strategie'); const d = req.profile.data; d.push({id: gid(), name: req.body.name, startDate: req.body.startDate, notes: req.body.notes||'', token: req.body.token||null, includeInTotalApr: true, investmentHistory: [{id:gid(), amount:parseFloat(req.body.investment), date:req.body.startDate, note:''}], rewards:[], pnl:[], endedAt:null}); req.profile.data = d; await saveProfile(req); res.json(d[d.length-1]);});
router.delete('/strategies/:id', async (req, res) => { svU(req, 'Strat del'); req.profile.data = req.profile.data.filter(s => s.id !== req.params.id); await saveProfile(req); res.json({ok:1});});
router.put('/strategies/:id/:action', async (req, res) => {
  svU(req, 'Strat Edit'); const s = req.profile.data.find(x => x.id === req.params.id); if(!s) return res.status(404).json({});
  if(req.params.action === 'end') s.endedAt = new Date().toISOString();
  if(req.params.action === 'reactivate') s.endedAt = null;
  if(req.params.action === 'notes') s.notes = req.body.notes||'';
  if(req.params.action === 'token') s.token = req.body.name ? {name: req.body.name, amount: parseFloat(req.body.amount)||0, entryPrice: parseFloat(req.body.entryPrice)||0} : null;
  if(req.params.action === 'toggle-total-apr') s.includeInTotalApr = !s.includeInTotalApr;
  await saveProfile(req); res.json(s);
});
router.post('/strategies/:id/investment', async (req, res) => { svU(req, 'Invest+'); const s = req.profile.data.find(x => x.id === req.params.id); s.investmentHistory.push({id:gid(), amount:parseFloat(req.body.amount), date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(s); });
router.post('/strategies/:id/rewards', async (req, res) => { svU(req, 'Reward+'); const s = req.profile.data.find(x => x.id === req.params.id); s.rewards.push({id:gid(), amount:parseFloat(req.body.amount), date:req.body.date||new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(s); });
router.post('/strategies/:id/pnl', async (req, res) => { svU(req, 'PNL+'); const s = req.profile.data.find(x => x.id === req.params.id); s.pnl.push({id:gid(), amount:parseFloat(req.body.amount), note:req.body.note||'', date:new Date().toISOString(), includeInAPR:false}); await saveProfile(req); res.json(s); });
router.delete('/strategies/:id/:type/:itemId', async (req, res) => {
  svU(req, 'Item del'); const s = req.profile.data.find(x => x.id === req.params.id);
  if(req.params.type === 'rewards') s.rewards = s.rewards.filter(x => x.id !== req.params.itemId);
  if(req.params.type === 'pnl') s.pnl = s.pnl.filter(x => x.id !== req.params.itemId);
  await saveProfile(req); res.json({ok:1});
});

router.post('/frf/exchanges', async (req, res) => { svU(req, 'Börse+'); const f = req.profile.frf; f.exchanges.push({id:gid(), name:req.body.name, marginHistory:[{id:gid(), amount:parseFloat(req.body.margin)||0, date:new Date().toISOString(), note:'Ersteinzahlung'}]}); await saveProfile(req); res.json(f); });
router.delete('/frf/exchanges/:id', async (req, res) => { svU(req, 'Börse del'); const f = req.profile.frf; f.exchanges = f.exchanges.filter(x => x.id !== req.params.id); await saveProfile(req); res.json(f); });
router.post('/frf/exchanges/:id/margin', async (req, res) => { svU(req, 'Margin+'); const f = req.profile.frf; const e = f.exchanges.find(x => x.id === req.params.id); e.marginHistory.push({id:gid(), amount:parseFloat(req.body.amount), date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(f); });

router.post('/frf/positions', async (req, res) => {
  svU(req, 'Pos+'); const f = req.profile.frf;
  f.positions.push({id:gid(), type:req.body.type, token:req.body.token, tokenAmount:parseFloat(req.body.tokenAmount)||0, positionSizeUsd:parseFloat(req.body.positionSizeUsd)||0, entryPriceShort:parseFloat(req.body.entryPriceShort)||0, entryPriceLong:parseFloat(req.body.entryPriceLong)||0, shortExchangeId:req.body.shortExchangeId, longExchangeId:req.body.longExchangeId, longIsSpot:req.body.longIsSpot, fees:parseFloat(req.body.fees)||0, linkedStrategyId:req.body.linkedStrategyId, startDate:req.body.startDate||new Date().toISOString(), endedAt:null, closePnlShort:null, closePnlLong:null, closeNote:'', manualPrice:0, useManualPrice:false, includeInStrategy:false, fundingShort:[], fundingLong:[]});
  await saveProfile(req); res.json(f);
});
router.delete('/frf/positions/:id', async (req, res) => { svU(req, 'Pos del'); const f = req.profile.frf; f.positions = f.positions.filter(x => x.id !== req.params.id); await saveProfile(req); res.json(f); });
router.put('/frf/positions/:id/close', async (req, res) => {
  svU(req, 'Pos close'); const f = req.profile.frf; const p = f.positions.find(x => x.id === req.params.id);
  p.endedAt = new Date().toISOString(); p.closePnlShort = parseFloat(req.body.closePnlShort)||0; p.closePnlLong = parseFloat(req.body.closePnlLong)||0; p.fees = parseFloat(req.body.fees)||0;
  if(p.closePnlShort !== 0 && p.shortExchangeId) { let e = f.exchanges.find(x=>x.id===p.shortExchangeId); if(e) e.marginHistory.push({id:gid(), amount:p.closePnlShort, date:p.endedAt, note:'Auto-Close PNL: '+p.token}); }
  if(p.closePnlLong !== 0 && !p.longIsSpot && p.longExchangeId) { let e = f.exchanges.find(x=>x.id===p.longExchangeId); if(e) e.marginHistory.push({id:gid(), amount:p.closePnlLong, date:p.endedAt, note:'Auto-Close PNL: '+p.token}); }
  await saveProfile(req); res.json(f);
});
router.put('/frf/positions/:id/toggle-strategy', async (req, res) => { svU(req, 'Toggle Strat'); const p = req.profile.frf.positions.find(x => x.id === req.params.id); p.includeInStrategy = !p.includeInStrategy; await saveProfile(req); res.json(req.profile.frf); });
router.post('/frf/positions/:id/funding/:side', async (req, res) => { svU(req, 'Fund+'); const p = req.profile.frf.positions.find(x => x.id === req.params.id); const arr = req.params.side === 'short' ? p.fundingShort : p.fundingLong; arr.push({id:gid(), amount:parseFloat(req.body.amount), date:new Date().toISOString(), note:req.body.note||''}); await saveProfile(req); res.json(req.profile.frf); });
router.delete('/frf/positions/:id/funding/:side/:fid', async (req, res) => { svU(req, 'Fund-'); const p = req.profile.frf.positions.find(x => x.id === req.params.id); if(req.params.side==='short') p.fundingShort = p.fundingShort.filter(x=>x.id!==req.params.fid); else p.fundingLong = p.fundingLong.filter(x=>x.id!==req.params.fid); await saveProfile(req); res.json(req.profile.frf); });
// ============================================
// SUPPORT & COMMUNITY API
// ============================================
app.post('/api/support', requireAuth, async (req, res) => {
  try {
    const ok = await sendMail("tracker.support@defivault.cloud", "Support-Anfrage: " + req.body.title, "Von: " + req.account.email + "<br><br>" + req.body.message);
    res.json({ ok: ok ? 1 : 0 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.post('/api/features', requireAuth, async (req, res) => {
  try {
    await db.query('INSERT INTO feature_requests (id, account_id, title, description) VALUES ($1, $2, $3, $4)', [gid(), req.account.id, req.body.title, req.body.description]);
    res.json({ ok: 1 });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

function getLastSyncReset() {
  const d = new Date();
  // Saturday is day 6. If today is Sat (6) after 18:00, or Sun-Fri, find the correct previous/current Saturday 18:00.
  // 18:00 in CET is 17:00 UTC. Let's base it on UTC.
  const day = d.getUTCDay();
  const hours = d.getUTCHours();
  
  // How many days ago was the last Saturday?
  // day 6 (Sat) -> 0 if hours >= 17, else 7
  // day 0 (Sun) -> 1
  // day 1 (Mon) -> 2 ...
  let daysAgo = 0;
  if (day === 6) { daysAgo = hours >= 17 ? 0 : 7; } 
  else { daysAgo = day + 1; }
  
  const reset = new Date(d);
  reset.setUTCDate(d.getUTCDate() - daysAgo);
  reset.setUTCHours(17, 0, 0, 0); // 17:00 UTC = 18:00 CET (Winter), 19:00 CEST (Summer) - close enough, or exactly 18:00 Local:
  // For exact 18:00 Local time we use local methods:
  const localReset = new Date();
  localReset.setDate(localReset.getDate() - (localReset.getDay() === 6 ? (localReset.getHours() >= 18 ? 0 : 7) : localReset.getDay() + 1));
  localReset.setHours(18, 0, 0, 0);
  return localReset.toISOString();
}

app.get('/api/features', requireAuth, async (req, res) => {
  try {
    const lastReset = getLastSyncReset();

    const { rows: voteCheck } = await db.query('SELECT COUNT(*) as anz FROM feature_votes WHERE account_id = $1 AND createdat >= $2', [req.account.id, lastReset]);
    const weeklyVotesUsed = parseInt(voteCheck[0].anz) || 0;
    const canVoteGlobally = weeklyVotesUsed < 1;

    const { rows } = await db.query(`
      SELECT r.id, r.title, r.description, r.status, r.createdat, 
             a.email as author,
             (SELECT COUNT(*) FROM feature_votes v WHERE v.request_id = r.id) as votes,
             EXISTS(SELECT 1 FROM feature_votes v WHERE v.request_id = r.id AND v.account_id = $1) as has_voted
      FROM feature_requests r
      JOIN accounts a ON r.account_id = a.id
      WHERE r.status IN ('approved', 'implemented', 'planned')
      ORDER BY votes DESC, r.createdat DESC
    `, [req.account.id]);
    
    res.json({ list: rows, canVoteGlobally, weeklyVotesUsed, nextReset: getLastSyncReset()  });
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.post('/api/features/:id/vote', requireAuth, async (req, res) => {
  try {
    const lastReset = getLastSyncReset();

    // Hat der User in diesem Zeitraum auf dem gesamten Board schon abgestimmt?
    const { rows: voteCheck } = await db.query('SELECT 1 FROM feature_votes WHERE account_id = $1 AND createdat >= $2', [req.account.id, lastReset]);
    
    // Prüfe, ob er evtl GERADE diesen Vote ENTFERNEN will (Toggle) -> Wenn User VOR dem Reset abgestimmt hat, verbieten wir das ab-voten?
    // Oder ob "max 1 Vote" bedeutet "nur 1 aktiver Vote pro Woche setzbar, ab-voten immer erlaubt"? 
    // Wir implementieren: Nur HINZUFÜGEN ist limitiert auf 1 pro Woche.
    const { rows: hasVoted } = await db.query('SELECT 1 FROM feature_votes WHERE request_id = $1 AND account_id = $2', [req.params.id, req.account.id]);
    
    if (hasVoted.length > 0) {
      // Vote zurückziehen (immer erlaubt)
      await db.query('DELETE FROM feature_votes WHERE request_id = $1 AND account_id = $2', [req.params.id, req.account.id]);
      return res.json({ voted: false });
    } else {
      // Neuen Vote setzen -> Block, falls in der Woche schon was anderes gevotet wurde!
      if (voteCheck.length >= 1) {
        return res.status(403).json({ error: 'wöchentliches voting limit erreicht' });
      }
      await db.query('INSERT INTO feature_votes (request_id, account_id, createdat) VALUES ($1, $2, NOW())', [req.params.id, req.account.id]);
      return res.json({ voted: true });
    }
  } catch(e) { console.error(e); res.status(500).json({error:1}); }
});

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 DeFi Vault Server läuft auf Port ${PORT} (PostgreSQL+JWT)`); });
