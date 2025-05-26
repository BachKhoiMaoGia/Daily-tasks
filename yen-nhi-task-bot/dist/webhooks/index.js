"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * webhooks/index.ts
 * Express webhook for Google Calendar push notifications and QR display.
 */
const express_1 = __importDefault(require("express"));
const index_js_1 = require("../gcal/index.js");
const logger_js_1 = __importDefault(require("../utils/logger.js"));
const index_js_2 = require("../zalo/index.js");
const index_js_3 = require("../config/index.js");
const index_js_4 = __importDefault(require("../db/index.js"));
const qr_js_1 = require("../zalo/qr.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router = express_1.default.Router();
function getTaskMap() {
    const rows = index_js_4.default.prepare('SELECT * FROM tasks').all();
    const map = {};
    for (const r of rows) {
        if (r.gcal_event_id)
            map[r.gcal_event_id] = r;
    }
    return map;
}
router.post('/gcal', async (req, res) => {
    try {
        // Lấy snapshot trước khi sync
        const before = getTaskMap();
        await (0, index_js_1.syncFromGCal)();
        const after = getTaskMap();
        // So sánh diff
        const added = [];
        const removed = [];
        const changed = [];
        for (const id in after) {
            if (!before[id])
                added.push(id);
            else if (JSON.stringify(after[id]) !== JSON.stringify(before[id]))
                changed.push(id);
        }
        for (const id in before) {
            if (!after[id])
                removed.push(id);
        }
        let msg = '';
        if (added.length)
            msg += `Đã thêm ${added.length} task từ Google Calendar.`;
        if (removed.length)
            msg += `\nĐã xóa ${removed.length} task từ Google Calendar.`;
        if (changed.length)
            msg += `\nCó ${changed.length} task đã thay đổi từ Google Calendar.`;
        if (msg) {
            await (0, index_js_2.sendMessage)(index_js_3.config.bossZaloId || '', msg.trim());
            logger_js_1.default.info('[Webhook] Đã sync GCal, diff:', { added, removed, changed });
        }
        else {
            logger_js_1.default.info('[Webhook] Đã sync GCal, không có thay đổi.');
        }
        res.status(200).send('OK');
    }
    catch (err) {
        logger_js_1.default.error('[Webhook] Lỗi khi sync GCal:', err);
        res.status(500).send('Error');
    }
});
// QR Code endpoints for Zalo login
router.get('/qr', (req, res) => {
    const qrData = (0, qr_js_1.getCurrentQR)();
    console.log('[QR Endpoint] QR request received, data:', {
        hasQrData: !!qrData,
        hasBase64: qrData ? !!qrData.base64 : false,
        hasUrl: qrData ? !!qrData.url : false,
        base64Length: qrData?.base64 ? qrData.base64.length : 0,
        timestamp: qrData ? new Date(qrData.timestamp).toISOString() : null
    });
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
              <p><em>Last checked: ${new Date().toISOString()}</em></p>
            </div>
          </div>
        </body>
      </html>
    `);
        return;
    }
    const qrAge = Math.round((Date.now() - qrData.timestamp) / 1000);
    const remainingTime = Math.max(0, 480 - qrAge); // 8 minutes = 480 seconds
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
          .timer {
            color: #e74c3c;
            font-weight: bold;
            margin: 10px 0;
          }
          .debug {
            font-size: 12px;
            color: #999;
            margin-top: 20px;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 Zalo QR Login</h1>
          
          <div class="timer">
            ⏰ Expires in: ${Math.floor(remainingTime / 60)}:${(remainingTime % 60).toString().padStart(2, '0')}
          </div>
          
          <div class="qr-container">
            ${qrData.base64 ?
        `<img src="data:image/png;base64,${qrData.base64}" alt="Zalo QR Code" class="qr-code" />` :
        qrData.url ?
            `<p>QR Code URL: <a href="${qrData.url}" target="_blank">${qrData.url}</a></p>` :
            `<p>⚠️ QR code data not available</p>`}
          </div>
          
          <div class="instructions">
            <p><strong>Instructions:</strong></p>
            <ol style="text-align: left;">
              <li>Open Zalo app on your phone</li>
              <li>Tap the QR scanner icon</li>
              <li>Scan the QR code above</li>
              <li>Approve the login request</li>
            </ol>
          </div>
          
          <a href="/qr" class="refresh-btn">🔄 Refresh Page</a>
          
          <div class="debug">
            <strong>Debug Info:</strong><br>
            Generated: ${new Date(qrData.timestamp).toISOString()}<br>
            Age: ${qrAge}s<br>
            Has Image: ${!!qrData.base64}<br>
            Has URL: ${!!qrData.url}<br>
            ${qrData.base64 ? `Image Size: ${qrData.base64.length} chars` : ''}
          </div>
        </div>
        
        <script>
          // Auto refresh every 30 seconds
          setTimeout(() => {
            window.location.reload();
          }, 30000);
          
          // Update timer every second
          let remaining = ${remainingTime};
          setInterval(() => {
            remaining--;
            if (remaining <= 0) {
              document.querySelector('.timer').innerHTML = '⏰ Expired - refreshing...';
              setTimeout(() => window.location.reload(), 2000);
            } else {
              const mins = Math.floor(remaining / 60);
              const secs = remaining % 60;
              document.querySelector('.timer').innerHTML = 
                '⏰ Expires in: ' + mins + ':' + secs.toString().padStart(2, '0');
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
});
// QR image endpoint
router.get('/qr.png', (req, res) => {
    const qrPath = path_1.default.join(process.cwd(), 'qr.png');
    if (fs_1.default.existsSync(qrPath)) {
        res.sendFile(qrPath);
    }
    else {
        res.status(404).send('QR code image not found');
    }
});
// Status endpoint
router.get('/status', (req, res) => {
    const qrData = (0, qr_js_1.getCurrentQR)();
    const hasQR = !!qrData;
    const hasCookies = fs_1.default.existsSync(index_js_3.config.zaloCookiePath);
    const qrAge = qrData ? Math.round((Date.now() - qrData.timestamp) / 1000) : null;
    const qrExpiry = qrData ? new Date(qrData.timestamp + 8 * 60 * 1000) : null;
    res.json({
        timestamp: new Date().toISOString(),
        server: {
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            platform: process.platform
        },
        zalo: {
            loggedIn: hasCookies,
            qrAvailable: hasQR,
            qrAge: qrAge,
            qrExpiry: qrExpiry ? qrExpiry.toISOString() : null,
            qrExpired: qrExpiry ? Date.now() > qrExpiry.getTime() : null,
            qrHasBase64: qrData ? !!qrData.base64 : false,
            qrHasUrl: qrData ? !!qrData.url : false,
            qrBase64Length: qrData?.base64 ? qrData.base64.length : 0
        },
        files: {
            credentials: fs_1.default.existsSync(index_js_3.config.zaloCookiePath),
            qrImage: fs_1.default.existsSync('qr.png')
        },
        endpoints: {
            qr: '/qr',
            qrImage: '/qr.png',
            status: '/status'
        }
    });
});
exports.default = router;
