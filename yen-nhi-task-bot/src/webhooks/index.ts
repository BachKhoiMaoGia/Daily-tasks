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
                `<p>⚠️ QR code data not available</p>`
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
          </div>
            <a href="/qr" class="refresh-btn">🔄 Refresh Page</a>
          <button onclick="regenerateQR()" class="refresh-btn" style="margin-left: 10px; background: #e74c3c;">♻️ Generate New QR</button>
          
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
          
          // QR Regeneration function
          async function regenerateQR() {
            const button = document.querySelector('button[onclick="regenerateQR()"]');
            button.disabled = true;
            button.innerHTML = '⏳ Generating...';
            
            try {
              const response = await fetch('/qr/regenerate', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              const result = await response.json();
              
              if (result.success) {
                button.innerHTML = '✅ Success!';
                setTimeout(() => {
                  window.location.reload();
                }, 1500);
              } else {
                button.innerHTML = '❌ Failed';
                button.disabled = false;
                setTimeout(() => {
                  button.innerHTML = '♻️ Generate New QR';
                }, 3000);
              }
            } catch (error) {
              console.error('QR regeneration failed:', error);
              button.innerHTML = '❌ Error';
              button.disabled = false;
              setTimeout(() => {
                button.innerHTML = '♻️ Generate New QR';
              }, 3000);
            }
          }
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
            credentials: fs.existsSync(config.zaloCookiePath),
            qrImage: fs.existsSync('qr.png')
        },
        endpoints: {
            qr: '/qr',
            qrImage: '/qr.png',
            status: '/status'
        }
    });
});

// QR regeneration endpoint
router.post('/qr/regenerate', async (req, res) => {
    try {
        logger.info('[QR] Manual QR regeneration requested');        // Import login function dynamically to avoid circular dependency
        const zaloModule = await import('../zalo/index.js') as any;

        // Start new QR login process  
        if (zaloModule.forceQRLogin) {
            zaloModule.forceQRLogin().catch((err: any) => {
                logger.error('[QR] Failed to regenerate QR:', err);
            });
        } else {
            logger.error('[QR] forceQRLogin function not available');
            res.status(500).json({
                success: false,
                message: 'QR regeneration function not available',
                timestamp: new Date().toISOString()
            });
            return;
        }

        res.json({
            success: true,
            message: 'QR regeneration started',
            timestamp: new Date().toISOString(),
            redirectTo: '/qr'
        });
    } catch (err) {
        logger.error('[QR] QR regeneration failed:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: (err as Error).message,
            timestamp: new Date().toISOString()
        });
    }
});

// Debug credentials endpoint for production troubleshooting
router.get('/debug/credentials', (req, res) => {
    try {
        const credentialsPath = config.zaloCookiePath;
        const sessionPath = credentialsPath.replace('.credentials.json', '.session.json');

        const result: any = {
            timestamp: new Date().toISOString(),
            environment: {
                hasBase64Creds: !!config.zaloCredentialsBase64,
                base64Length: config.zaloCredentialsBase64 ? config.zaloCredentialsBase64.length : 0,
                hasBase64Session: !!config.zaloSessionBase64,
                sessionBase64Length: config.zaloSessionBase64 ? config.zaloSessionBase64.length : 0
            },
            files: {
                credentialsExists: fs.existsSync(credentialsPath),
                sessionExists: fs.existsSync(sessionPath)
            }
        };

        // Read credentials if exists
        if (fs.existsSync(credentialsPath)) {
            try {
                const credData = fs.readFileSync(credentialsPath, 'utf8');
                const creds = JSON.parse(credData);
                result.credentials = {
                    hasImei: !!creds.imei,
                    hasUserAgent: !!creds.userAgent,
                    hasCookie: !!creds.cookie,
                    cookieType: Array.isArray(creds.cookie) ? 'array' : typeof creds.cookie,
                    cookieLength: Array.isArray(creds.cookie) ? creds.cookie.length : 0,
                    hasLanguage: !!creds.language,
                    hasTimestamp: !!creds.timestamp,
                    ageMinutes: creds.timestamp ? Math.round((Date.now() - creds.timestamp) / 1000 / 60) : null,
                    isExpired: creds.timestamp ? (Date.now() - creds.timestamp > 24 * 60 * 60 * 1000) : null
                };
            } catch (err) {
                result.credentials = { error: 'Failed to parse credentials file' };
            }
        }

        // Read session if exists
        if (fs.existsSync(sessionPath)) {
            try {
                const sessionData = fs.readFileSync(sessionPath, 'utf8');
                const session = JSON.parse(sessionData);
                result.session = {
                    isLoggedIn: session.isLoggedIn,
                    loginMethod: session.loginMethod,
                    sessionType: session.sessionType,
                    ageMinutes: session.timestamp ? Math.round((Date.now() - session.timestamp) / 1000 / 60) : null,
                    isExpired: session.timestamp ? (Date.now() - session.timestamp > 24 * 60 * 60 * 1000) : null
                };
            } catch (err) {
                result.session = { error: 'Failed to parse session file' };
            }
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Debug endpoint failed',
            message: (err as Error).message,
            timestamp: new Date().toISOString()
        });
    }
});

// Manual login trigger endpoint for debugging
router.post('/debug/trigger-login', async (req, res) => {
    try {
        logger.info('[Debug] Manual login trigger requested');

        // Import login function dynamically
        const zaloModule = await import('../zalo/index.js') as any;

        // Clear existing state first
        if (zaloModule.cleanup) {
            zaloModule.cleanup();
            logger.info('[Debug] Cleaned up existing Zalo state');
        }

        // Trigger fresh login
        logger.info('[Debug] Starting fresh login...');
        const api = await zaloModule.login();

        if (api) {
            logger.info('[Debug] Login successful!');
            res.json({
                success: true,
                message: 'Login triggered successfully',
                timestamp: new Date().toISOString(),
                hasApi: !!api,
                redirectTo: '/qr'
            });
        } else {
            logger.warn('[Debug] Login returned null/undefined');
            res.status(500).json({
                success: false,
                message: 'Login returned null',
                timestamp: new Date().toISOString()
            });
        }
    } catch (err) {
        logger.error('[Debug] Manual login trigger failed:', err);
        res.status(500).json({
            success: false,
            message: 'Login trigger failed',
            error: (err as Error).message,
            timestamp: new Date().toISOString()
        });
    }
});

export default router;
