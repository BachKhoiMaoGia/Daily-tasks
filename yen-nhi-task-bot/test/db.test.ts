import { describe, it, expect } from 'vitest';
import db from '../src/db';

describe('db', () => {
  it('should insert and select a task', () => {
    const stmt = db.prepare('INSERT INTO tasks (content) VALUES (?)');
    const info = stmt.run('test task');
    expect(info.changes).toBe(1);
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    expect(row.content).toBe('test task');
  });
});
