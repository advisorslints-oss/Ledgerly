import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS members (
    company_id TEXT NOT NULL REFERENCES companies(id),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (company_id, user_id)
  );

  -- One row per synced record; data is NULL for a deleted record. seq orders every write.
  CREATE TABLE IF NOT EXISTS records (
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    data TEXT,
    seq INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tbl, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
  CREATE INDEX IF NOT EXISTS records_company ON records (company_id, tbl);
  CREATE INDEX IF NOT EXISTS records_entry_number
    ON records (company_id, json_extract(data, '$.number')) WHERE tbl = 'journalEntries';
  CREATE INDEX IF NOT EXISTS records_line_account
    ON records (company_id, json_extract(data, '$.accountId')) WHERE tbl = 'journalLines';

  -- Attachment contents (receipt photos, PDFs). Their metadata syncs as ordinary records.
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT OR IGNORE INTO counters (name, value) VALUES ('seq', 0);
`

export function openDatabase(file: string): DB {
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  return db
}

export function nextSeq(db: DB): number {
  return (db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq' RETURNING value").get() as { value: number }).value
}

export function currentSeq(db: DB): number {
  return (db.prepare("SELECT value FROM counters WHERE name = 'seq'").get() as { value: number }).value
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
