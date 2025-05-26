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
    // 07:00 daily summary
    node_cron_1.default.schedule('0 7 * * *', () => { (0, tasks_js_1.sendChecklist)().catch(() => { }); });
    // Every minute: near-due (15')
    node_cron_1.default.schedule('* * * * *', () => { (0, tasks_js_1.sendNearDue)().catch(() => { }); });
}
