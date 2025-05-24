/**
 * zalo/index.ts
 * Zalo client using zca-js (QR login, message listener).
 */
import { Zalo } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';
import { storeQRData, clearQR } from './qr.js';

let client: any = null;

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

            // Store QR data for web display
            if (api && api.qr) {
                storeQRData(api.qr);
                console.log('\n🔗 [Zalo] QR Code available at: http://your-render-app.com/qr');
                console.log('📱 [Zalo] Open the URL above to see QR code for Zalo login');
            }

            // In ra link QR nếu có
            if (api && api.qr && api.qr.url) {
                console.log(`\n[Zalo] Link QR: ${api.qr.url}`);
                console.log('[Zalo] Bạn có thể mở link này trên trình duyệt để quét QR bằng app Zalo.');
            } else if (api && api.qr && api.qr.base64) {
                // In QR base64 ra log để người dùng tự tạo file ảnh
                console.log('[Zalo] QR base64 (copy phần sau vào file .png để quét):');
                console.log(api.qr.base64);
            } else {
                console.log('[Zalo] Đã tạo file qr.png, hãy mở file này để quét QR.');
            }
            // Lưu cookies object array vào file JSON
            if (api && api.cookies) {
                // Kiểm tra cookies có phải array không
                if (Array.isArray(api.cookies)) {
                    try {
                        fs.writeFileSync(config.zaloCookiePath, JSON.stringify(api.cookies, null, 2), 'utf8');
                        console.log(`[Zalo] Đã lưu cookies object array vào ${config.zaloCookiePath} (length: ${api.cookies.length})`);
                        // Clear QR data since login is successful
                        clearQR();
                    } catch (err) {
                        console.error('[Zalo] Lỗi khi lưu cookies:', err);
                        throw err;
                    }
                } else {
                    console.error('[Zalo] Cookies không phải array! Không lưu.');
                    throw new Error('Cookies không phải array!');
                }
            } else {
                console.log('[Zalo] Không tìm thấy cookies để lưu. Đăng nhập thất bại!');
                throw new Error('Không lấy được cookies sau khi quét QR.');
            }
        } else {
            console.error('[Zalo] Không tìm thấy hàm loginQR trên zca-js. Vui lòng kiểm tra lại phiên bản thư viện.');
            throw new Error('Không tìm thấy hàm loginQR trên zca-js.');
        }
    } else {
        // Nếu đã có cookies object array, luôn đọc và truyền vào client
        try {
            const cookiesRaw = fs.readFileSync(config.zaloCookiePath, 'utf8');
            let cookiesArr;
            try {
                cookiesArr = JSON.parse(cookiesRaw);
            } catch (err) {
                console.error('[Zalo] Lỗi parse cookies JSON:', err);
                fs.unlinkSync(config.zaloCookiePath);
                throw new Error('File cookies bị lỗi, đã xóa. Hãy quét lại QR.');
            }
            if (!Array.isArray(cookiesArr)) {
                console.error('[Zalo] File cookies không phải array! Đã xóa.');
                fs.unlinkSync(config.zaloCookiePath);
                throw new Error('File cookies không hợp lệ, đã xóa. Hãy quét lại QR.');
            }
            console.log(`[Zalo] Đọc cookies từ file (${config.zaloCookiePath}), length: ${cookiesArr.length}`);
            if (typeof zaloClient.loginWithCookies === 'function') {
                try {
                    await zaloClient.loginWithCookies({ cookies: cookiesArr });
                    console.log('[Zalo] Đã đăng nhập bằng cookies (loginWithCookies).');
                } catch (err) {
                    console.error('[Zalo] Lỗi loginWithCookies:', err);
                    fs.unlinkSync(config.zaloCookiePath);
                    throw new Error('Đăng nhập Zalo bằng cookies thất bại. Đã xóa cookies, hãy quét lại QR.');
                }
            } else if ('cookies' in zaloClient) {
                zaloClient.cookies = cookiesArr;
                console.log('[Zalo] Đã gán cookies trực tiếp vào client.');
            } else {
                console.warn('[Zalo] Không có hàm loginWithCookies, chỉ gán cookies vào client. Nếu không nhận được message, hãy kiểm tra lại thư viện zca-js.');
            }
        } catch (err) {
            console.error('[Zalo] Lỗi khi đăng nhập bằng cookies:', err);
            throw err;
        }
    }
}

export function onMessage(handler: (msg: any) => void) {
    const zaloClient = getZaloClient();
    if (zaloClient && typeof zaloClient.on === 'function') {
        zaloClient.on('message', handler);
    }
}

export function sendMessage(userId: string, text: string) {
    const zaloClient = getZaloClient();
    if (zaloClient && typeof zaloClient.sendMessage === 'function') {
        return zaloClient.sendMessage(userId, text);
    }
}

export default { login, onMessage, sendMessage };
