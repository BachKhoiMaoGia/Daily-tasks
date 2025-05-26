/**
 * zalo/index.ts
 * Zalo client using zca-js@2.0.0-beta.21 (QR login, message listener).
 */
import { Zalo, type API, type Credentials } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';
import { storeQRData, clearQR } from './qr.js';
import logger from '../utils/logger.js';

let zaloInstance: Zalo | null = null;
let apiInstance: API | null = null;

function getZaloInstance() {
    if (!zaloInstance) {
        zaloInstance = new Zalo();
    }
    return zaloInstance;
}

export async function login() {
    const zalo = getZaloInstance();

    if (!fs.existsSync(config.zaloCookiePath)) {
        logger.info('[Zalo] Chưa có cookie, khởi tạo đăng nhập QR...');

        try {
            // Use new zca-js@2.0.0-beta.21 API
            const result = await zalo.loginQR({
                qrPath: './qr.png',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                language: 'vi'
            });

            if (result && result.cookies) {
                logger.info(`[Zalo] Đăng nhập thành công! User: ${result.userInfo?.name || 'Unknown'}`);

                // Save cookies to file
                try {
                    fs.writeFileSync(config.zaloCookiePath, JSON.stringify(result.cookies, null, 2), 'utf8');
                    logger.info(`[Zalo] Đã lưu cookies vào ${config.zaloCookiePath} (${result.cookies.length} cookies)`);
                    clearQR();
                } catch (err) {
                    logger.error('[Zalo] Lỗi khi lưu cookies:', err);
                    throw err;
                }

                // Store the API instance for later use
                apiInstance = result as any; // result should be API instance

                return result;
            } else {
                throw new Error('Không lấy được cookies sau khi đăng nhập QR.');
            }

        } catch (err) {
            logger.error('[Zalo] Lỗi khi đăng nhập QR:', err);
            throw err;
        }
    } else {
        // Login with existing cookies
        try {
            const cookiesRaw = fs.readFileSync(config.zaloCookiePath, 'utf8');
            let cookiesArr;

            try {
                cookiesArr = JSON.parse(cookiesRaw);
            } catch (err) {
                logger.error('[Zalo] Lỗi parse cookies JSON:', err);
                fs.unlinkSync(config.zaloCookiePath);
                throw new Error('File cookies bị lỗi, đã xóa. Hãy quét lại QR.');
            }

            if (!Array.isArray(cookiesArr)) {
                logger.error('[Zalo] File cookies không phải array! Đã xóa.');
                fs.unlinkSync(config.zaloCookiePath);
                throw new Error('File cookies không hợp lệ, đã xóa. Hãy quét lại QR.');
            }

            logger.info(`[Zalo] Đọc cookies từ file (${config.zaloCookiePath}), length: ${cookiesArr.length}`);

            // Prepare credentials for login
            const credentials: Credentials = {
                imei: 'zca-js-' + Date.now(),
                cookie: cookiesArr,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                language: 'vi'
            };

            try {
                const api = await zalo.login(credentials);
                logger.info('[Zalo] Đã đăng nhập bằng cookies thành công.');
                apiInstance = api;
                return api;
            } catch (err) {
                logger.error('[Zalo] Lỗi đăng nhập bằng cookies:', err);
                fs.unlinkSync(config.zaloCookiePath);
                throw new Error('Đăng nhập Zalo bằng cookies thất bại. Đã xóa cookies, hãy quét lại QR.');
            }

        } catch (err) {
            logger.error('[Zalo] Lỗi khi đăng nhập bằng cookies:', err);
            throw err;
        }
    }
}

export function onMessage(handler: (msg: any) => void) {
    if (apiInstance && apiInstance.listener) {
        logger.info('[Zalo] Đang thiết lập message listener...');

        apiInstance.listener.on('message', (msg) => {
            logger.info('[Zalo] Nhận message:', {
                from: msg.fromId,
                type: msg.type,
                content: msg.data?.content || 'No content'
            });
            handler(msg);
        });

        // Start the listener
        apiInstance.listener.start();
        logger.info('[Zalo] Message listener đã được khởi động.');
    } else {
        logger.warn('[Zalo] API instance chưa được khởi tạo hoặc không có listener.');
    }
}

export async function sendMessage(userId: string, text: string) {
    if (apiInstance && apiInstance.sendMessage) {
        try {
            const result = await apiInstance.sendMessage({
                message: text,
                quote: null,
                mentions: []
            }, userId, 1); // type 1 = text message

            logger.info(`[Zalo] Đã gửi tin nhắn tới ${userId}: ${text}`);
            return result;
        } catch (err) {
            logger.error('[Zalo] Lỗi khi gửi tin nhắn:', err);
            throw err;
        }
    } else {
        logger.error('[Zalo] API instance chưa được khởi tạo hoặc không có sendMessage.');
        throw new Error('Zalo API chưa sẵn sàng để gửi tin nhắn.');
    }
}

export default { login, onMessage, sendMessage };
