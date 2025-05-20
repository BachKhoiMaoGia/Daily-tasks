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
import db from './db/index.js';
import { syncFromGCal } from './gcal/index.js';
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
            if (cmd.cmd === 'list') {
                const rows = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                if (rows.length === 0)
                    await sendMessage(config.bossZaloId || '', 'Không có task nào.');
                else
                    await sendMessage(config.bossZaloId || '', rows.map((r, i) => `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`).join('\n'));
                return;
            }
            if (cmd.cmd === 'stats') {
                const total = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
                const done = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE done = 1').get().c;
                const undone = total - done;
                await sendMessage(config.bossZaloId || '', `Tổng: ${total}\nHoàn thành: ${done}\nChưa xong: ${undone}`);
                return;
            }
            // TODO: handle command, update DB, sync GCal, reply
            await sendMessage(config.bossZaloId || '', `Đã nhận lệnh: ${cmd.cmd}`);
        }
        catch (err) {
            logger.error(err);
            await sendMessage(config.bossZaloId || '', 'Lỗi xử lý lệnh.');
        }
    });
    // Start Express for webhooks
    const app = express();
    app.use(express.json());
    app.use(webhookRouter);
    app.listen(config.port, () => logger.info(`Server running on :${config.port}`));
    // Start scheduler
    startScheduler();
    // Định kỳ đồng bộ 2 chiều Google Calendar
    setInterval(syncFromGCal, 5 * 60 * 1000); // 5 phút
}
main().catch((e) => logger.error(e));
