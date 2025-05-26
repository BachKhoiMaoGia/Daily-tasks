"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendChecklist = sendChecklist;
exports.sendNearDue = sendNearDue;
// scheduler/tasks.ts
// Hàm gửi checklist 7h sáng và nhắc task gần đến hạn (15 phút)
const index_1 = __importDefault(require("../db/index"));
const index_2 = require("../config/index");
const index_3 = require("../zalo/index");
// Thêm cột near_due_notified nếu chưa có
try {
    index_1.default.exec('ALTER TABLE tasks ADD COLUMN near_due_notified INTEGER DEFAULT 0');
}
catch {
    // Column already exists, ignore
}
async function sendChecklist() {
    const rows = index_1.default.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
    if (rows.length === 0) {
        await (0, index_3.sendMessage)(index_2.config.bossZaloId || '', 'Checklist sáng: Không có task nào.');
        return;
    }
    // Enhanced: Show only task titles for morning checklist
    const msg = 'Checklist sáng:\n' + rows.map((r, i) => `${i + 1}. ${r.content}`).join('\n');
    await (0, index_3.sendMessage)(index_2.config.bossZaloId || '', msg);
}
async function sendNearDue() {
    const now = new Date();
    const rows = index_1.default.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_time IS NOT NULL AND (near_due_notified IS NULL OR near_due_notified = 0)').all();
    for (const r of rows) {
        if (!r.due_date || !r.due_time)
            continue;
        const due = new Date(`${r.due_date}T${r.due_time}:00`);
        const diff = (due.getTime() - now.getTime()) / 60000; // phút
        if (diff > 0 && diff <= 15) {
            // Enhanced: Show full task information for pre-deadline reminders
            let reminderMsg = `🚨 Sắp đến hạn: ${r.content}\n`;
            reminderMsg += `📅 Thời gian: ${r.due_date} ${r.due_time}`;
            if (r.location) {
                reminderMsg += `\n📍 Địa điểm: ${r.location}`;
            }
            if (r.description) {
                reminderMsg += `\n📝 Mô tả: ${r.description}`;
            }
            if (r.end_time) {
                reminderMsg += `\n⏰ Kết thúc: ${r.end_time}`;
            }
            reminderMsg += `\n⏳ Còn ${Math.ceil(diff)} phút`;
            await (0, index_3.sendMessage)(index_2.config.bossZaloId || '', reminderMsg);
            index_1.default.prepare('UPDATE tasks SET near_due_notified = 1 WHERE id = ?').run(r.id);
        }
    }
}
