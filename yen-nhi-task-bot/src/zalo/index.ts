/**
 * zalo/index.ts
 * Zalo client using zca-js (QR login, message listener).
 */
import { Zalo } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';

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
      // In ra link QR nếu có
      if (api && api.qr && api.qr.url) {
        console.log(`\n[Zalo] Link QR: ${api.qr.url}`);
        console.log('[Zalo] Bạn có thể mở link này trên trình duyệt để quét QR bằng app Zalo.');
      } else {
        console.log('[Zalo] Đã tạo file qr.png, hãy mở file này để quét QR.');
      }
      // Lấy đúng cookie string từ api.cookie nếu là string, hoặc lấy từng trường cần thiết nếu là object
      let cookie = '';
      if (typeof api?.cookie === 'string') {
        cookie = api.cookie;
      } else if (api?.cookie && typeof api.cookie === 'object') {
        // Chỉ lấy các trường cookie Zalo cần: zpsid, zpw_sek, _zlang, app.event.zalo.me
        const keys = ['zpsid', 'zpw_sek', '_zlang', 'app.event.zalo.me'];
        cookie = keys
          .map((k) => (api.cookie[k] ? `${k}=${api.cookie[k]}` : ''))
          .filter(Boolean)
          .join('; ');
      }
      if (!cookie && typeof zaloClient.getCookie === 'function') {
        try {
          const c = await zaloClient.getCookie();
          if (typeof c === 'string') cookie = c;
        } catch (e) {/* bỏ qua lỗi lấy cookie */}
      }
      if (cookie) {
        try {
          fs.writeFileSync(config.zaloCookiePath, cookie, 'utf8');
          console.log(`[Zalo] Đã lưu cookie mới vào ${config.zaloCookiePath}`);
        } catch (err) {
          console.error('[Zalo] Lỗi khi lưu cookie:', err);
        }
      } else {
        console.log('[Zalo] Không tìm thấy cookie để lưu.');
      }
    } else {
      console.error('[Zalo] Không tìm thấy hàm loginQR trên zca-js. Vui lòng kiểm tra lại phiên bản thư viện.');
    }
  } else {
    // Nếu đã có cookie, thử login bằng cookie nếu thư viện hỗ trợ, hoặc chỉ khởi tạo client
    if (typeof zaloClient.loginWithCookie === 'function') {
      await zaloClient.loginWithCookie({ cookiePath: config.zaloCookiePath });
      console.log('[Zalo] Đã đăng nhập bằng cookie.');
    } else {
      console.log('[Zalo] Đã có cookie, khởi tạo client.');
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
