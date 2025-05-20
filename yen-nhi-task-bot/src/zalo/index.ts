/**
 * zalo/index.ts
 * Zalo client using zca-js (QR login, message listener).
 */
import { Zalo, API } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';

let api: any = null;

function getZaloCredentials() {
  // Zalo yêu cầu đủ 3 trường: imei, userAgent, cookie (cookie phải là string, không undefined)
  let cookie = '';
  if (fs.existsSync(config.zaloCookiePath)) {
    cookie = fs.readFileSync(config.zaloCookiePath, 'utf8').trim();
  }
  // Nếu cookie rỗng, truyền chuỗi rỗng (không undefined)
  return {
    imei: 'bot-imei-123456789',
    userAgent: 'Mozilla/5.0 (Linux; Android 10)',
    cookie,
    language: 'vi',
  };
}

export async function login() {
  const credentials = getZaloCredentials();
  const client = new Zalo(credentials);
  if (!credentials.cookie) {
    api = await client.login(); // login trả về API instance, sẽ yêu cầu QR nếu chưa có cookie
    // TODO: Lưu lại cookie nếu cần
  } else {
    // Nếu đã có cookie, có thể cần gọi login() nếu cookie hết hạn, nhưng thường chỉ cần tạo API instance
    api = client;
  }
}

export function onMessage(handler: (msg: any) => void) {
  if (api && api.listener && typeof api.listener.on === 'function') {
    api.listener.on('message', handler);
  }
}

export function sendMessage(userId: string, text: string) {
  if (api && typeof api.sendMessage === 'function') {
    return api.sendMessage(userId, text);
  }
}

export default { login, onMessage, sendMessage };
