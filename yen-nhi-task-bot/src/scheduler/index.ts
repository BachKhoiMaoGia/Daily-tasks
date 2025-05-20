/**
 * scheduler/index.ts
 * node-cron for daily summary and near-due reminders.
 */
import cron from 'node-cron';
// Tạm thời comment import này vì chưa có file tasks.js
// import { sendChecklist, sendNearDue } from './tasks.js';

export function startScheduler() {
  // 07:00 daily summary
  // cron.schedule('0 7 * * *', sendChecklist);
  // Every minute: near-due (15')
  // cron.schedule('* * * * *', sendNearDue);
}
