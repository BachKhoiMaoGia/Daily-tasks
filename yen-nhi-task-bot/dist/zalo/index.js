/**
 * zalo/index.ts
 * Zalo client using zca-js (QR login, message listener).
 */
import { Zalo } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';
let client = null;
function getZaloClient() {
    if (!client) {
        client = new Zalo();
    }
    return client;
}
export async function login() {
    const zaloClient = getZaloClient();
    if (!fs.existsSync(config.zaloCookiePath)) {
        console.log('\n[Zalo] Chưa có cookie, khởi tạo đăng nhập QR...');
        if (typeof zaloClient.loginQR === 'function') {
            const api = await zaloClient.loginQR();
            console.log('[Zalo] loginQR() trả về:', JSON.stringify(api, null, 2));
            if (api && api.qr && api.qr.url) {
                console.log(`\n[Zalo] Link QR: ${api.qr.url}`);
                console.log('[Zalo] Bạn có thể mở link này trên trình duyệt để quét QR bằng app Zalo.');
            }
            else {
                console.log('[Zalo] Đã tạo file qr.png, hãy mở file này để quét QR.');
            }
            // Thử lưu cookie nếu có
            if (api && api.cookie) {
                try {
                    fs.writeFileSync(config.zaloCookiePath, api.cookie, 'utf8');
                    console.log(`[Zalo] Đã lưu cookie mới vào ${config.zaloCookiePath}`);
                }
                catch (err) {
                    console.error('[Zalo] Lỗi khi lưu cookie:', err);
                }
            }
            else if (zaloClient.cookie) {
                try {
                    fs.writeFileSync(config.zaloCookiePath, zaloClient.cookie, 'utf8');
                    console.log(`[Zalo] Đã lưu cookie từ instance vào ${config.zaloCookiePath}`);
                }
                catch (err) {
                    console.error('[Zalo] Lỗi khi lưu cookie từ instance:', err);
                }
            }
            else {
                console.log('[Zalo] Không tìm thấy cookie để lưu.');
            }
        }
        else {
            console.error('[Zalo] Không tìm thấy hàm loginQR trên zca-js. Vui lòng kiểm tra lại phiên bản thư viện.');
        }
    }
    else {
        // Nếu đã có cookie, thử login bằng cookie nếu thư viện hỗ trợ, hoặc chỉ khởi tạo client
        if (typeof zaloClient.loginWithCookie === 'function') {
            await zaloClient.loginWithCookie({ cookiePath: config.zaloCookiePath });
            console.log('[Zalo] Đã đăng nhập bằng cookie.');
        }
        else {
            console.log('[Zalo] Đã có cookie, khởi tạo client.');
        }
    }
}
export function onMessage(handler) {
    const zaloClient = getZaloClient();
    if (zaloClient && typeof zaloClient.on === 'function') {
        zaloClient.on('message', handler);
    }
}
export function sendMessage(userId, text) {
    const zaloClient = getZaloClient();
    if (zaloClient && typeof zaloClient.sendMessage === 'function') {
        return zaloClient.sendMessage(userId, text);
    }
}
export default { login, onMessage, sendMessage };
