/**
 * webhooks/index.ts
 * Express webhook for Google Calendar push notifications and QR display.
 */
import express from 'express';
import { syncFromGCal } from '../gcal/index.js';
import logger from '../utils/logger.js';
import { sendMessage } from '../zalo/index.js';
import { config } from '../config/index.js';
import db from '../db/index.js';
import { getCurrentQR } from '../zalo/qr.js';
import fs from 'fs';
import path from 'path';

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

// QR Code endpoints for Zalo login
router.get('/qr', (req, res) => {
  const qrData = getCurrentQR();
  
  if (!qrData) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zalo QR Code</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .container { max-width: 500px; margin: 0 auto; }
            .status { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔐 Zalo Login</h1>
            <div class="status">
              <p>No QR code available.</p>
              <p>Either already logged in or QR code has expired.</p>
              <p>Check server logs or restart the application to generate a new QR code.</p>
            </div>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Zalo QR Login</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 20px;
            background: #f5f5f5;
          }
          .container { 
            max-width: 400px; 
            margin: 0 auto; 
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .qr-container {
            margin: 20px 0;
            padding: 20px;
            background: #fafafa;
            border-radius: 8px;
          }
          .qr-code {
            max-width: 280px;
            height: auto;
            border: 1px solid #ddd;
          }
          .instructions {
            color: #666;
            font-size: 14px;
            line-height: 1.5;
          }
          .refresh-btn {
            margin-top: 20px;
            padding: 10px 20px;
            background: #0066cc;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 Zalo QR Login</h1>
          
          <div class="qr-container">
            ${qrData.base64 ? 
              `<img src="data:image/png;base64,${qrData.base64}" alt="Zalo QR Code" class="qr-code" />` :
              `<p>QR Code URL: <a href="${qrData.url}" target="_blank">${qrData.url}</a></p>`
            }
          </div>
          
          <div class="instructions">
            <p><strong>Instructions:</strong></p>
            <ol style="text-align: left;">
              <li>Open Zalo app on your phone</li>
              <li>Tap the QR scanner icon</li>
              <li>Scan the QR code above</li>
              <li>Approve the login request</li>
            </ol>
            <p><em>QR code expires in 5 minutes</em></p>
          </div>
          
          <a href="/qr" class="refresh-btn">🔄 Refresh Page</a>
        </div>
        
        <script>
          // Auto refresh every 30 seconds
          setTimeout(() => {
            window.location.reload();
          }, 30000);
        </script>
      </body>
    </html>
  `);
});

// QR image endpoint
router.get('/qr.png', (req, res) => {
  const qrPath = path.join(process.cwd(), 'qr.png');
  
  if (fs.existsSync(qrPath)) {
    res.sendFile(qrPath);
  } else {
    res.status(404).send('QR code image not found');
  }
});

// Status endpoint
router.get('/status', (req, res) => {
  const qrData = getCurrentQR();
  const hasQR = !!qrData;
  const hasCookies = fs.existsSync(config.zaloCookiePath);
  
  res.json({
    timestamp: new Date().toISOString(),
    zalo: {
      loggedIn: hasCookies,
      qrAvailable: hasQR,
      qrExpiry: qrData ? new Date(qrData.timestamp + 5 * 60 * 1000).toISOString() : null
    },
    endpoints: {
      qr: '/qr',
      qrImage: '/qr.png',
      status: '/status'
    }
  });
});

export default router;
