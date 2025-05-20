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
  logger.info('[Zalo] Bắt đầu đăng nhập Zalo...');
  try {
    await login();
    logger.info('[Zalo] Đã gọi xong hàm login(). Nếu có QR, hãy kiểm tra terminal để quét.');
  } catch (err) {
    logger.error('[Zalo] Lỗi khi đăng nhập:', err);
    throw err;
  }
  onMessage(async (msg) => {
    try {
      let plainText = msg.text || '';
      logger.info({ zaloMsg: msg }, '[Zalo] Nhận message');
      if (msg.isAudio && msg.audioUrl) {
        const audioBuf = await downloadAudio(msg.audioUrl, msg.token);
        const wavBuf = await convertToWav(audioBuf);
        plainText = await transcribe(wavBuf, 'vi');
        logger.info({ plainText }, '[Zalo] STT audio -> text');
      }
      const cmd = parseCommand(plainText);
      logger.info({ cmd }, '[Zalo] Parsed command');
      if (cmd.cmd === 'list') {
        const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
        if (rows.length === 0) await sendMessage(config.bossZaloId || '', 'Không có task nào.');
        else await sendMessage(
          config.bossZaloId || '',
          rows.map((r: any, i: number) => `${i+1}. ${r.content}${r.due_date ? ' @'+r.due_date : ''}${r.due_time ? ' @'+r.due_time : ''}`).join('\n')
        );
        return;
      }
      if (cmd.cmd === 'stats') {
        const total = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
        const done = (db.prepare('SELECT COUNT(*) as c FROM tasks WHERE done = 1').get() as any).c;
        const undone = total - done;
        await sendMessage(config.bossZaloId || '', `Tổng: ${total}\nHoàn thành: ${done}\nChưa xong: ${undone}`);
        return;
      }
      // Handle /new command: parse args, save to DB, sync GCal, reply
      if (cmd.cmd === 'new') {
        // Parse args: extract content, date, time (format: <content> [@YYYY-MM-DD] [@HH:mm])
        let content = cmd.args.trim();
        let due_date = null;
        let due_time = null;
        // Regex: @YYYY-MM-DD and/or @HH:mm
        const dateMatch = content.match(/@([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        if (dateMatch) {
          due_date = dateMatch[1];
          content = content.replace(dateMatch[0], '').trim();
        }
        const timeMatch = content.match(/@([0-9]{2}:[0-9]{2})/);
        if (timeMatch) {
          due_time = timeMatch[1];
          content = content.replace(timeMatch[0], '').trim();
        }
        if (!content) {
          await sendMessage(config.bossZaloId || '', 'Nội dung task không hợp lệ.');
          return;
        }
        // Insert to DB
        const stmt = db.prepare('INSERT INTO tasks (content, due_date, due_time, done, near_due_notified) VALUES (?, ?, ?, 0, 0)');
        const info = stmt.run(content, due_date, due_time);
        const taskId = info.lastInsertRowid;
        // Prepare GCal event
        let startDateTime: string | undefined = undefined;
        if (due_date && due_time) {
          startDateTime = `${due_date}T${due_time}:00`;
        } else if (due_date) {
          startDateTime = `${due_date}T08:00:00`;
        }
        const event: any = {
          summary: content,
          start: startDateTime ? { dateTime: startDateTime, timeZone: 'Asia/Ho_Chi_Minh' } : undefined,
          end: startDateTime ? { dateTime: startDateTime, timeZone: 'Asia/Ho_Chi_Minh' } : undefined,
        };
        let gcalEventId = null;
        try {
          const gcalRes = await import('./gcal/index.js').then(m => m.insertEvent(event));
          if (gcalRes && gcalRes.id) {
            gcalEventId = gcalRes.id;
            db.prepare('UPDATE tasks SET gcal_event_id = ? WHERE id = ?').run(gcalEventId, taskId);
          }
        } catch (gcalErr) {
          logger.error('[GCal] Lỗi khi tạo event:', gcalErr);
        }
        // Reply with details
        let reply = `Đã tạo task mới:\n- Nội dung: ${content}`;
        if (due_date) reply += `\n- Ngày: ${due_date}`;
        if (due_time) reply += `\n- Giờ: ${due_time}`;
        if (gcalEventId) reply += `\n- Đã đồng bộ Google Calendar.`;
        else reply += `\n- Không đồng bộ được Google Calendar.`;
        await sendMessage(config.bossZaloId || '', reply);
        return;
      }
      if (cmd.cmd === 'done') {
        const arg = cmd.args.trim();
        if (!arg) {
          await sendMessage(config.bossZaloId || '', 'Vui lòng nhập số thứ tự hoặc ID task cần hoàn thành.');
          return;
        }
        // Cho phép nhập số thứ tự (1-based) hoặc ID thực tế
        let task: any = null;
        if (/^\d+$/.test(arg)) {
          // Số thứ tự trong danh sách chưa xong
          const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
          const idx = parseInt(arg, 10) - 1;
          if (idx >= 0 && idx < rows.length) task = rows[idx];
        }
        if (!task) {
          // Thử tìm theo ID
          task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(arg);
        }
        if (!task) {
          await sendMessage(config.bossZaloId || '', 'Không tìm thấy task phù hợp.');
          return;
        }
        db.prepare('UPDATE tasks SET done = 1, near_due_notified = 0 WHERE id = ?').run(task.id);
        // Nếu có event GCal thì xóa event (hoặc update status cancelled)
        if (task.gcal_event_id) {
          try {
            await import('./gcal/index.js').then(m => m.deleteEvent(task.gcal_event_id));
          } catch (err) {
            logger.error('[GCal] Lỗi khi xóa event:', err);
          }
        }
        await sendMessage(config.bossZaloId || '', `Đã đánh dấu hoàn thành: ${task.content}`);
        return;
      }
      if (cmd.cmd === 'delete') {
        const arg = cmd.args.trim();
        if (!arg) {
          await sendMessage(config.bossZaloId || '', 'Vui lòng nhập số thứ tự hoặc ID task cần xóa.');
          return;
        }
        let task: any = null;
        if (/^\d+$/.test(arg)) {
          const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
          const idx = parseInt(arg, 10) - 1;
          if (idx >= 0 && idx < rows.length) task = rows[idx];
        }
        if (!task) {
          task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(arg);
        }
        if (!task) {
          await sendMessage(config.bossZaloId || '', 'Không tìm thấy task phù hợp.');
          return;
        }
        if (task.gcal_event_id) {
          try {
            await import('./gcal/index.js').then(m => m.deleteEvent(task.gcal_event_id));
          } catch (err) {
            logger.error('[GCal] Lỗi khi xóa event:', err);
          }
        }
        db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
        await sendMessage(config.bossZaloId || '', `Đã xóa task: ${task.content}`);
        return;
      }
      if (cmd.cmd === 'help') {
        const helpMsg = `Hướng dẫn sử dụng bot:
/new <nội_dung> [@YYYY-MM-DD] [@HH:mm]  - Thêm task mới\n/list  - Xem danh sách task chưa xong\n/done <số|ID>  - Đánh dấu hoàn thành\n/delete <số|ID>  - Xóa task\n/help  - Xem hướng dẫn\nBạn cũng có thể gửi lệnh bằng giọng nói tự nhiên.`;
        await sendMessage(config.bossZaloId || '', helpMsg);
        return;
      }
      if (cmd.cmd === 'me') {
        if (msg.senderId) {
          await sendMessage(msg.senderId, `Zalo userId của bạn là: ${msg.senderId}`);
        } else {
          await sendMessage(config.bossZaloId || '', 'Không lấy được userId.');
        }
        return;
      }
      // TODO: handle command, update DB, sync GCal, reply
      await sendMessage(config.bossZaloId || '', `Đã nhận lệnh: ${cmd.cmd}`);
    } catch (err) {
      logger.error({ err }, '[Zalo] Lỗi xử lý lệnh');
      await sendMessage(config.bossZaloId || '', 'Lỗi xử lý lệnh.');
    }
  });

  // Start Express for webhooks
  const app = express();
  app.use(express.json());
  app.get('/', (req, res) => res.send('Bot is running!'));
  app.use(webhookRouter);
  app.listen(config.port, () => logger.info(`Server running on :${config.port}`));

  // Start scheduler
  startScheduler();

  // Định kỳ đồng bộ 2 chiều Google Calendar
  setInterval(syncFromGCal, 5 * 60 * 1000); // 5 phút
}

main().catch((e) => logger.error(e));
