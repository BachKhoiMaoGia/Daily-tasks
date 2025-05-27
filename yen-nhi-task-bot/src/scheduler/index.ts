/**
 * scheduler/index.ts
 * node-cron for daily summary and near-due reminders.
 */
import cron from 'node-cron';
import { sendChecklist, sendNearDue } from './tasks.js';

export function startScheduler() {
    // 08:00 daily checklist (UTC+7 timezone) - Boss yêu cầu 8h sáng
    cron.schedule('0 8 * * *', () => { sendChecklist().catch(() => { }); }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });

    // Every minute: near-due (15') - with timezone context
    cron.schedule('* * * * *', () => { sendNearDue().catch(() => { }); }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });
}
