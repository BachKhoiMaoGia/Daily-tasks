/**
 * zalo/index.ts
 * Zalo client using zca-js (QR login, message listener).
 */
import { ZCA } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';

const client = new ZCA({
  cookiePath: config.zaloCookiePath,
});

export async function login() {
  if (!fs.existsSync(config.zaloCookiePath)) {
    await client.loginWithQR();
  } else {
    await client.loginWithCookie();
  }
}

export function onMessage(handler: (msg: any) => void) {
  client.on('message', handler);
}

export function sendMessage(userId: string, text: string) {
  return client.sendMessage(userId, text);
}

export default client;
