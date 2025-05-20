/**
 * gcal/index.ts
 * Google Calendar integration (OAuth2, event CRUD).
 */
import { google } from 'googleapis';
import { config } from '../config/index.js';
import db from '../db/index.js';

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
  // Lấy các event từ Google Calendar, cập nhật lại DB nếu có event mới/sửa/xóa
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30).toISOString();
  const events = await listEvents(timeMin, timeMax);
  if (!events) return;
  for (const ev of events) {
    if (!ev.id || !ev.summary) continue;
    // Nếu chưa có trong DB thì insert
    const row = db.prepare('SELECT * FROM tasks WHERE gcal_event_id = ?').get(ev.id);
    if (!row) {
      db.prepare('INSERT INTO tasks (content, due_date, due_time, gcal_event_id, done) VALUES (?, ?, ?, ?, 0)')
        .run(ev.summary, ev.start?.date || ev.start?.dateTime?.slice(0, 10), ev.start?.dateTime?.slice(11, 16), ev.id);
    } else {
      // Nếu event đã bị xóa trên Google Calendar thì xóa khỏi DB
      if (ev.status === 'cancelled') {
        db.prepare('DELETE FROM tasks WHERE gcal_event_id = ?').run(ev.id);
      }
    }
  }
}
