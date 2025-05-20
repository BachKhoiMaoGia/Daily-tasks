/**
 * webhooks/index.ts
 * Express webhook for Google Calendar push notifications.
 */
import express from 'express';
const router = express.Router();

router.post('/gcal', async (req, res) => {
  // TODO: handle Google push notification, sync DB, notify Boss if needed
  res.status(200).send('OK');
});

export default router;
