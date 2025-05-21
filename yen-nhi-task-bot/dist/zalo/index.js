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
            // In toàn bộ object trả về để debug
            console.log('[Zalo][DEBUG] loginQR() result:', JSON.stringify(api, null, 2));
            // In ra link QR nếu có
            if (api && api.qr && api.qr.url) {
                console.log(`\n[Zalo] Link QR: ${api.qr.url}`);
                console.log('[Zalo] Bạn có thể mở link này trên trình duyệt để quét QR bằng app Zalo.');
            }
            else if (api && api.qr && api.qr.base64) {
                // In QR base64 ra log để người dùng tự tạo file ảnh
                console.log('[Zalo] QR base64 (copy phần sau vào file .png để quét):');
                console.log(api.qr.base64);
            }
            else {
                console.log('[Zalo] Đã tạo file qr.png, hãy mở file này để quét QR.');
            }
            // Lưu cookies object array vào file JSON
            if (api && api.cookies) {
                try {
                    fs.writeFileSync(config.zaloCookiePath, JSON.stringify(api.cookies), 'utf8');
                    console.log(`[Zalo] Đã lưu cookies object array vào ${config.zaloCookiePath}`);
                }
                catch (err) {
                    console.error('[Zalo] Lỗi khi lưu cookies:', err);
                }
            }
            else {
                console.log('[Zalo] Không tìm thấy cookies để lưu. Đăng nhập thất bại!');
                throw new Error('Không lấy được cookies sau khi quét QR.');
            }
        }
        else {
            console.error('[Zalo] Không tìm thấy hàm loginQR trên zca-js. Vui lòng kiểm tra lại phiên bản thư viện.');
            throw new Error('Không tìm thấy hàm loginQR trên zca-js.');
        }
    }
    else {
        // Nếu đã có cookies object array, luôn đọc và truyền vào client
        try {
            const cookiesArr = JSON.parse(fs.readFileSync(config.zaloCookiePath, 'utf8'));
            if (typeof zaloClient.loginWithCookies === 'function') {
                await zaloClient.loginWithCookies({ cookies: cookiesArr });
                console.log('[Zalo] Đã đăng nhập bằng cookies (loginWithCookies).');
            }
            else if ('cookies' in zaloClient) {
                zaloClient.cookies = cookiesArr;
                console.log('[Zalo] Đã gán cookies trực tiếp vào client.');
            }
            else {
                console.warn('[Zalo] Không có hàm loginWithCookies, chỉ gán cookies vào client. Nếu không nhận được message, hãy kiểm tra lại thư viện zca-js.');
            }
        }
        catch (err) {
            console.error('[Zalo] Lỗi khi đăng nhập bằng cookies:', err);
            throw new Error('Đăng nhập Zalo bằng cookies thất bại. Hãy xóa cookies và quét lại QR.');
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
