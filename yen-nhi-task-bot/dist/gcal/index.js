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
const logger_js_1 = __importDefault(require("../utils/logger.js"));
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
    try {
        // Lấy các event từ Google Calendar, cập nhật lại DB nếu có event mới/sửa/xóa
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toISOString();
        const events = await listEvents(timeMin, timeMax);
        if (!events) {
            logger_js_1.default.warn('[GCal Sync] No events returned from Google Calendar');
            return;
        }
        logger_js_1.default.info(`[GCal Sync] Processing ${events.length} events from Google Calendar`);
        for (const ev of events) {
            if (!ev.id || !ev.summary)
                continue;
            // Nếu chưa có trong DB thì insert
            const row = index_js_2.default.prepare('SELECT * FROM tasks WHERE gcal_event_id = ?').get(ev.id);
            if (!row) {
                // Extract date and time with proper timezone handling
                let dueDate = null;
                let dueTime = null;
                if (ev.start?.dateTime) {
                    // Event with specific time - convert from UTC+7
                    const startDateTime = new Date(ev.start.dateTime);
                    dueDate = startDateTime.toISOString().slice(0, 10);
                    dueTime = startDateTime.toLocaleTimeString('en-GB', {
                        hour12: false,
                        timeZone: 'Asia/Ho_Chi_Minh'
                    }).slice(0, 5);
                }
                else if (ev.start?.date) {
                    // All-day event
                    dueDate = ev.start.date;
                    dueTime = null;
                }
                index_js_2.default.prepare('INSERT INTO tasks (content, due_date, due_time, gcal_event_id, done) VALUES (?, ?, ?, ?, 0)')
                    .run(ev.summary, dueDate, dueTime, ev.id);
                logger_js_1.default.info(`[GCal Sync] Added new event: ${ev.summary} (${dueDate} ${dueTime || 'all-day'})`);
            }
            else {
                // Nếu event đã bị xóa trên Google Calendar thì xóa khỏi DB
                if (ev.status === 'cancelled') {
                    index_js_2.default.prepare('DELETE FROM tasks WHERE gcal_event_id = ?').run(ev.id);
                    logger_js_1.default.info(`[GCal Sync] Removed cancelled event: ${ev.summary}`);
                }
                else {
                    // Update existing event if changed
                    const currentTime = ev.start?.dateTime ?
                        new Date(ev.start.dateTime).toLocaleTimeString('en-GB', {
                            hour12: false,
                            timeZone: 'Asia/Ho_Chi_Minh'
                        }).slice(0, 5) : null;
                    const hasChanges = row.content !== ev.summary ||
                        (currentTime && row.due_time !== currentTime);
                    if (hasChanges) {
                        let dueDate = row.due_date;
                        let dueTime = row.due_time;
                        if (ev.start?.dateTime) {
                            const startDateTime = new Date(ev.start.dateTime);
                            dueDate = startDateTime.toISOString().slice(0, 10);
                            dueTime = startDateTime.toLocaleTimeString('en-GB', {
                                hour12: false,
                                timeZone: 'Asia/Ho_Chi_Minh'
                            }).slice(0, 5);
                        }
                        index_js_2.default.prepare('UPDATE tasks SET content = ?, due_date = ?, due_time = ? WHERE gcal_event_id = ?')
                            .run(ev.summary, dueDate, dueTime, ev.id);
                        logger_js_1.default.info(`[GCal Sync] Updated event: ${ev.summary}`);
                    }
                }
            }
        }
        logger_js_1.default.info('[GCal Sync] Sync completed successfully');
    }
    catch (error) {
        logger_js_1.default.error('[GCal Sync] Error during sync:', error);
        throw error; // Re-throw to be handled by caller
    }
}
