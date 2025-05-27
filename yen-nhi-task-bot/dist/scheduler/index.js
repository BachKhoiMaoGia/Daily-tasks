"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
/**
 * scheduler/index.ts
 * node-cron for daily summary and near-due reminders.
 */
const node_cron_1 = __importDefault(require("node-cron"));
const tasks_js_1 = require("./tasks.js");
function startScheduler() {
    // 08:00 daily checklist (UTC+7 timezone) - Boss yêu cầu 8h sáng
    node_cron_1.default.schedule('0 8 * * *', () => { (0, tasks_js_1.sendChecklist)().catch(() => { }); }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });
    // Every minute: near-due (15') - with timezone context
    node_cron_1.default.schedule('* * * * *', () => { (0, tasks_js_1.sendNearDue)().catch(() => { }); }, {
        timezone: 'Asia/Ho_Chi_Minh'
    });
}
