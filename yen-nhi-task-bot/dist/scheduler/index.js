/**
 * scheduler/index.ts
 * node-cron for daily summary and near-due reminders.
 */
import cron from 'node-cron';
import { sendChecklist, sendNearDue } from './tasks.js';
export function startScheduler() {
    // 07:00 daily summary
    cron.schedule('0 7 * * *', () => { sendChecklist().catch(() => { }); });
    // Every minute: near-due (15')
    cron.schedule('* * * * *', () => { sendNearDue().catch(() => { }); });
}
