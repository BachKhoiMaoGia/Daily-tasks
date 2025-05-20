// scheduler/tasks.ts
// Hàm gửi checklist 7h sáng và nhắc task gần đến hạn (15 phút)
import db from '../db/index.js';
import { config } from '../config/index.js';
import { sendMessage } from '../zalo/index.js';

// Thêm cột near_due_notified nếu chưa có
try {
  db.exec('ALTER TABLE tasks ADD COLUMN near_due_notified INTEGER DEFAULT 0');
} catch {}

export async function sendChecklist() {
  const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
  if (rows.length === 0) {
    await sendMessage(config.bossZaloId || '', 'Checklist sáng: Không có task nào.');
    return;
  }
  const msg = 'Checklist sáng:\n' + rows.map((r: any, i: number) => `${i+1}. ${r.content}${r.due_date ? ' @'+r.due_date : ''}${r.due_time ? ' @'+r.due_time : ''}`).join('\n');
  await sendMessage(config.bossZaloId || '', msg);
}

export async function sendNearDue() {
  const now = new Date();
  const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_time IS NOT NULL AND (near_due_notified IS NULL OR near_due_notified = 0)').all();
  for (const r of rows) {
    if (!r.due_date || !r.due_time) continue;
    const due = new Date(`${r.due_date}T${r.due_time}:00`);
    const diff = (due.getTime() - now.getTime()) / 60000; // phút
    if (diff > 0 && diff <= 15) {
      await sendMessage(config.bossZaloId || '', `Sắp đến hạn: ${r.content} @${r.due_date} ${r.due_time}`);
      db.prepare('UPDATE tasks SET near_due_notified = 1 WHERE id = ?').run(r.id);
    }
  }
}
