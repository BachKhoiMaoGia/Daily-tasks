/**
 * db/index.ts
 * SQLite DB for mapping task_id <-> gcal_event_id.
 */
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.resolve('tasks.db'));

db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  due_date TEXT,
  due_time TEXT,
  gcal_event_id TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

export default db;
