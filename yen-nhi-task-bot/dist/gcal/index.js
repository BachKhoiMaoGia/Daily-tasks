"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertEvent = insertEvent;
exports.updateEvent = updateEvent;
exports.deleteEvent = deleteEvent;
exports.listEvents = listEvents;
exports.watchEvents = watchEvents;
exports.syncFromGCal = syncFromGCal;
/**
 * gcal/index.ts
 * Google Calendar integration (OAuth2, event CRUD).
 */
const googleapis_1 = require("googleapis");
const index_js_1 = require("../config/index.js");
const index_js_2 = __importDefault(require("../db/index.js"));
const { clientId, clientSecret, redirectUri, refreshToken } = index_js_1.config.google;
const oAuth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
oAuth2Client.setCredentials({ refresh_token: refreshToken });
const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oAuth2Client });
async function insertEvent(event) {
    const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
    });
    return res.data;
}
async function updateEvent(eventId, event) {
    const res = await calendar.events.update({
        calendarId: 'primary',
        eventId,
        requestBody: event,
    });
    return res.data;
}
async function deleteEvent(eventId) {
    await calendar.events.delete({
        calendarId: 'primary',
        eventId,
    });
}
async function listEvents(timeMin, timeMax) {
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
    });
    return res.data.items || [];
}
async function watchEvents() {
    // ...Google push notification setup (TTL 7 days)...
}
async function syncFromGCal() {
    // Lấy các event từ Google Calendar, cập nhật lại DB nếu có event mới/sửa/xóa
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toISOString();
    const events = await listEvents(timeMin, timeMax);
    if (!events)
        return;
    for (const ev of events) {
        if (!ev.id || !ev.summary)
            continue;
        // Nếu chưa có trong DB thì insert
        const row = index_js_2.default.prepare('SELECT * FROM tasks WHERE gcal_event_id = ?').get(ev.id);
        if (!row) {
            index_js_2.default.prepare('INSERT INTO tasks (content, due_date, due_time, gcal_event_id, done) VALUES (?, ?, ?, ?, 0)')
                .run(ev.summary, ev.start?.date || ev.start?.dateTime?.slice(0, 10), ev.start?.dateTime?.slice(11, 16), ev.id);
        }
        else {
            // Nếu event đã bị xóa trên Google Calendar thì xóa khỏi DB
            if (ev.status === 'cancelled') {
                index_js_2.default.prepare('DELETE FROM tasks WHERE gcal_event_id = ?').run(ev.id);
            }
        }
    }
}
