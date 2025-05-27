/**
 * gcal/index.ts
 * Google Calendar integration (OAuth2, event CRUD).
 */
import { google } from 'googleapis';
import { config } from '../config/index.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

const { clientId, clientSecret, redirectUri, refreshToken } = config.google;

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
oAuth2Client.setCredentials({ refresh_token: refreshToken });

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

export async function insertEvent(event: any) {
    const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
    });
    return res.data;
}

export async function updateEvent(eventId: string, event: any) {
    const res = await calendar.events.update({
        calendarId: 'primary',
        eventId,
        requestBody: event,
    });
    return res.data;
}

export async function deleteEvent(eventId: string) {
    await calendar.events.delete({
        calendarId: 'primary',
        eventId,
    });
}

export async function listEvents(timeMin: string, timeMax: string): Promise<any[]> {
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
    });
    return res.data.items || [];
}

export async function watchEvents() {
    // ...Google push notification setup (TTL 7 days)...
}

export async function syncFromGCal() {
    try {
        // Lấy các event từ Google Calendar, cập nhật lại DB nếu có event mới/sửa/xóa
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toISOString();
        const events = await listEvents(timeMin, timeMax);

        if (!events) {
            logger.warn('[GCal Sync] No events returned from Google Calendar');
            return;
        }

        logger.info(`[GCal Sync] Processing ${events.length} events from Google Calendar`);

        for (const ev of events) {
            if (!ev.id || !ev.summary) continue;

            // Nếu chưa có trong DB thì insert
            const row: any = db.prepare('SELECT * FROM tasks WHERE gcal_event_id = ?').get(ev.id);
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
                } else if (ev.start?.date) {
                    // All-day event
                    dueDate = ev.start.date;
                    dueTime = null;
                }

                db.prepare('INSERT INTO tasks (content, due_date, due_time, gcal_event_id, done) VALUES (?, ?, ?, ?, 0)')
                    .run(ev.summary, dueDate, dueTime, ev.id);

                logger.info(`[GCal Sync] Added new event: ${ev.summary} (${dueDate} ${dueTime || 'all-day'})`);
            } else {
                // Nếu event đã bị xóa trên Google Calendar thì xóa khỏi DB
                if (ev.status === 'cancelled') {
                    db.prepare('DELETE FROM tasks WHERE gcal_event_id = ?').run(ev.id);
                    logger.info(`[GCal Sync] Removed cancelled event: ${ev.summary}`);
                } else {
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

                        db.prepare('UPDATE tasks SET content = ?, due_date = ?, due_time = ? WHERE gcal_event_id = ?')
                            .run(ev.summary, dueDate, dueTime, ev.id);

                        logger.info(`[GCal Sync] Updated event: ${ev.summary}`);
                    }
                }
            }
        }

        logger.info('[GCal Sync] Sync completed successfully');

    } catch (error) {
        logger.error('[GCal Sync] Error during sync:', error);
        throw error; // Re-throw to be handled by caller
    }
}
