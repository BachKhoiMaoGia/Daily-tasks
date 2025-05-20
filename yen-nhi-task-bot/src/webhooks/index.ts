/**
 * webhooks/index.ts
 * Express webhook for Google Calendar push notifications.
 */
import express from 'express';
import { syncFromGCal } from '../gcal/index.js';
import logger from '../utils/logger.js';
import { sendMessage } from '../zalo/index.js';
import { config } from '../config/index.js';
import db from '../db/index.js';

const router = express.Router();

function getTaskMap() {
  const rows: any[] = db.prepare('SELECT * FROM tasks').all();
  const map: Record<string, any> = {};
  for (const r of rows) {
    if (r.gcal_event_id) map[r.gcal_event_id] = r;
  }
  return map;
}

router.post('/gcal', async (req, res) => {
  try {
    // Lấy snapshot trước khi sync
    const before = getTaskMap();
    await syncFromGCal();
    const after = getTaskMap();
    // So sánh diff
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const id in after) {
      if (!before[id]) added.push(id);
      else if (JSON.stringify(after[id]) !== JSON.stringify(before[id])) changed.push(id);
    }
    for (const id in before) {
      if (!after[id]) removed.push(id);
    }
    let msg = '';
    if (added.length) msg += `Đã thêm ${added.length} task từ Google Calendar.`;
    if (removed.length) msg += `\nĐã xóa ${removed.length} task từ Google Calendar.`;
    if (changed.length) msg += `\nCó ${changed.length} task đã thay đổi từ Google Calendar.`;
    if (msg) {
      await sendMessage(config.bossZaloId || '', msg.trim());
      logger.info('[Webhook] Đã sync GCal, diff:', { added, removed, changed });
    } else {
      logger.info('[Webhook] Đã sync GCal, không có thay đổi.');
    }
    res.status(200).send('OK');
  } catch (err) {
    logger.error('[Webhook] Lỗi khi sync GCal:', err);
    res.status(500).send('Error');
  }
});

export default router;
