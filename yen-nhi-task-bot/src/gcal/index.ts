/**
 * gcal/index.ts
 * Google Calendar integration (OAuth2, event CRUD).
 */
import { google } from 'googleapis';
import { config } from '../config/index.js';

const { clientId, clientSecret, redirectUri, refreshToken } = config.google;

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
oAuth2Client.setCredentials({ refresh_token: refreshToken });

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

export async function insertEvent(event) {
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });
  return res.data;
}

export async function updateEvent(eventId, event) {
  const res = await calendar.events.update({
    calendarId: 'primary',
    eventId,
    requestBody: event,
  });
  return res.data;
}

export async function deleteEvent(eventId) {
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}

export async function listEvents(timeMin, timeMax) {
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items;
}

export async function watchEvents(webhookUrl) {
  // ...Google push notification setup (TTL 7 days)...
}
