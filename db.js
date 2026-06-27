const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || '/data/accounts.db';
const CHECK_LOG_RETENTION_DAYS = Number(process.env.CHECK_LOG_RETENTION_DAYS || 90);
const CHECK_LOG_MAX_ROWS = Number(process.env.CHECK_LOG_MAX_ROWS || 2000);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, username)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS check_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER,
      username TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      action TEXT,
      expiry_date TEXT,
      days_left INTEGER,
      message TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run('ALTER TABLE check_log ADD COLUMN username TEXT', () => {});
  db.run('ALTER TABLE check_log ADD COLUMN success INTEGER NOT NULL DEFAULT 0', () => {});
  db.run('ALTER TABLE check_log ADD COLUMN action TEXT', () => {});
  db.run('ALTER TABLE check_log ADD COLUMN message TEXT', () => {});
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_username ON accounts(user_id, username)');
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function addAccount(userId, username, password) {
  const cleanUsername = username.trim();
  const rows = await all('SELECT id FROM accounts WHERE user_id = ? AND username = ? LIMIT 1', [
    userId,
    cleanUsername,
  ]);

  if (rows[0]) {
    return run(
      'UPDATE accounts SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [password, rows[0].id, userId]
    );
  }

  return run('INSERT INTO accounts (user_id, username, password) VALUES (?, ?, ?)', [
    userId,
    cleanUsername,
    password,
  ]);
}

async function getAccounts(userId) {
  return all('SELECT * FROM accounts WHERE user_id = ? ORDER BY id ASC', [userId]);
}

async function getAccount(userId, accountId) {
  const rows = await all('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
  return rows[0] || null;
}

async function deleteAccount(userId, accountId) {
  return run('DELETE FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
}

async function logCheck(userId, account, result) {
  const saved = await run(
    `
      INSERT INTO check_log
        (user_id, account_id, username, success, action, expiry_date, days_left, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      account?.id || null,
      account?.username || null,
      result.success ? 1 : 0,
      result.action || 'check',
      result.expiryDate || null,
      Number.isFinite(result.daysLeft) ? result.daysLeft : null,
      result.message || result.error || null,
    ]
  );
  await cleanupCheckLogs();
  return saved;
}

async function cleanupCheckLogs() {
  if (Number.isFinite(CHECK_LOG_RETENTION_DAYS) && CHECK_LOG_RETENTION_DAYS > 0) {
    await run("DELETE FROM check_log WHERE checked_at < datetime('now', ?)", [
      `-${Math.floor(CHECK_LOG_RETENTION_DAYS)} days`,
    ]);
  }

  if (Number.isFinite(CHECK_LOG_MAX_ROWS) && CHECK_LOG_MAX_ROWS > 0) {
    await run(
      `
        DELETE FROM check_log
        WHERE id NOT IN (
          SELECT id FROM check_log
          ORDER BY checked_at DESC, id DESC
          LIMIT ?
        )
      `,
      [Math.floor(CHECK_LOG_MAX_ROWS)]
    );
  }
}

module.exports = {
  addAccount,
  getAccounts,
  getAccount,
  deleteAccount,
  logCheck,
};
