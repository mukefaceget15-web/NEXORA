PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  wallet_address TEXT,
  mining_started_at INTEGER,
  last_accrual_at INTEGER,
  balance_nex REAL NOT NULL DEFAULT 0,
  total_mined_nex REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_telegram_id TEXT NOT NULL,
  invited_telegram_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  qualified_at INTEGER,
  FOREIGN KEY(inviter_telegram_id) REFERENCES users(telegram_id),
  FOREIGN KEY(invited_telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  recipient TEXT NOT NULL,
  transaction_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  purpose TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  FOREIGN KEY(telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  reward_nex REAL NOT NULL DEFAULT 0,
  task_type TEXT NOT NULL,
  target TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  UNIQUE(task_id, telegram_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount_nex REAL NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(telegram_id) REFERENCES users(telegram_id)
);

INSERT OR IGNORE INTO tasks (id, title, reward_nex, task_type, target, enabled)
VALUES
  ('channel-1', 'Join our Telegram channel', 100, 'telegram_channel', '', 1),
  ('channel-2', 'Join our second Telegram channel', 100, 'telegram_channel', '', 1),
  ('watch-ad', 'Watch an advertisement', 50, 'ad', '', 1);
