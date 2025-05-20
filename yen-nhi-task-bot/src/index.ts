/**
 * src/index.ts
 * Main entry: Zalo login, message listener, audio/text handling, scheduler, webhooks.
 */
import express from 'express';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import { login, onMessage, sendMessage } from './zalo/index.js';
import { downloadAudio } from './audio/audioDownloader.js';
import { convertToWav } from './audio/convert.js';
import { transcribe } from './audio/stt.js';
import { parseCommand } from './parser/index.js';
import webhookRouter from './webhooks/index.js';
import { startScheduler } from './scheduler/index.js';

async function main() {
  await login();
  onMessage(async (msg) => {
    try {
      let plainText = msg.text || '';
      if (msg.isAudio && msg.audioUrl) {
        const audioBuf = await downloadAudio(msg.audioUrl, msg.token);
        const wavBuf = await convertToWav(audioBuf);
        plainText = await transcribe(wavBuf, 'vi');
      }
      const cmd = parseCommand(plainText);
      // TODO: handle command, update DB, sync GCal, reply
      await sendMessage(config.bossZaloId, `Đã nhận lệnh: ${cmd.cmd}`);
    } catch (err) {
      logger.error(err);
      await sendMessage(config.bossZaloId, 'Lỗi xử lý lệnh.');
    }
  });

  // Start Express for webhooks
  const app = express();
  app.use(express.json());
  app.use(webhookRouter);
  app.listen(config.port, () => logger.info(`Server running on :${config.port}`));

  // Start scheduler
  startScheduler();
}

main().catch((e) => logger.error(e));
