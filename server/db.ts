import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// One SQLite file, created on first run. DB_PATH lets the eval use its own copy.
const path = process.env.DB_PATH ?? 'data/minimi.db';
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    is_seed     INTEGER NOT NULL DEFAULT 0
  );

  -- Every user and assistant message. Assistant rows are the "receipts":
  -- answer text, search queries, sources (with retrieval time) and metrics.
  CREATE TABLE IF NOT EXISTS messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    reply_to         TEXT,                       -- assistant -> the user message it answers
    kind             TEXT NOT NULL DEFAULT 'answer',
    searches         TEXT NOT NULL DEFAULT '[]', -- JSON string[]
    sources          TEXT NOT NULL DEFAULT '[]', -- JSON Source[]
    metrics          TEXT,                       -- JSON Metrics
    recheck          TEXT,                       -- JSON RecheckResult
    is_seed          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);

  -- Key factual claims pulled out of each answer, so they can be re-checked later.
  CREATE TABLE IF NOT EXISTS claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    entity      TEXT NOT NULL,
    attribute   TEXT NOT NULL,
    value       TEXT NOT NULL,
    as_of       TEXT NOT NULL,
    source_url  TEXT,
    volatile    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS claims_message ON claims(message_id);
`);
