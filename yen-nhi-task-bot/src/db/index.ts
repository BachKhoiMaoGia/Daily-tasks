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

// Create deleted_tasks table to track deleted tasks
db.exec(`CREATE TABLE IF NOT EXISTS deleted_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_task_id INTEGER,
  content TEXT NOT NULL,
  due_date TEXT,
  due_time TEXT,
  gcal_event_id TEXT,
  was_done INTEGER DEFAULT 0,
  created_at TEXT,
  deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// Add task_type column if it doesn't exist (for categorization)
try {
    db.exec('ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT "task"');
} catch {
    // Column already exists, ignore
}

// Add additional columns for enhanced task editing
try {
    db.exec('ALTER TABLE tasks ADD COLUMN location TEXT');
} catch {
    // Column already exists, ignore
}

try {
    db.exec('ALTER TABLE tasks ADD COLUMN description TEXT');
} catch {
    // Column already exists, ignore
}

try {
    db.exec('ALTER TABLE tasks ADD COLUMN end_time TEXT');
} catch {
    // Column already exists, ignore
}

export default db;
