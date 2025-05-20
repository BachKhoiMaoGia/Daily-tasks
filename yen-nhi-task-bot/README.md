# yen-nhi-task-bot

AI agent nhận lệnh **text & audio** qua Zalo, convert audio→text, phân tích, lưu & đồng bộ task lên Google Calendar, nhắc Boss hằng ngày.

## Tính năng chính

- Nhận lệnh Zalo (text hoặc audio): `/new`, `/list`, `/done`, `/delete`, `/help`, `/me` hoặc nói tự nhiên.
- Convert audio (m4a/opus) sang text bằng OpenAI Whisper API (ưu tiên) hoặc HuggingFace Whisper.
- Lưu task vào SQLite, đồng bộ Google Calendar (CRUD, sync 2 chiều).
- Nhắc checklist 07:00, nhắc gần đến hạn (15', anti-spam).
- Webhook Google push sync DB, chỉ báo khi có thay đổi thực sự.
- Đăng nhập Zalo bằng QR, lưu cookie bền vững.
- Logging (pino), test (vitest), lint (ESLint + Prettier).

## Kiến trúc & Công nghệ

- Node.js 18+, TypeScript strict (ESM)
- Zalo: zca-js (QR login, cookie persist)
- STT: OpenAI Whisper API (ưu tiên), HuggingFace Whisper (fallback)
- Media convert: ffmpeg
- Google Calendar: googleapis (OAuth2)
- DB: SQLite (better-sqlite3)
- Scheduler: node-cron
- Web: Express
- Env: dotenv
- Lint: ESLint + Prettier
- Test: vitest
- Logging: pino (JSON)
- Dockerfile + docker-compose

---

## Cài đặt & chạy local

```bash
git clone ...
cd yen-nhi-task-bot
cp .env.example .env
npm install
npm run build
npm start
```

### Hoặc dùng Docker (local)
```bash
docker-compose up --build
```

---

## Deploy & vận hành trên Render.com

### 1. Deploy
- Push code lên GitHub.
- Tạo dịch vụ mới trên Render (Web Service).
- Chọn repo, đặt **Root Directory** là `yen-nhi-task-bot`.
- Render sẽ tự nhận Dockerfile, build và deploy.
- Vào tab Environment, thêm các biến từ `.env.example` (hoặc upload file `.env`).
- Khi build xong, app sẽ chạy ở URL dạng: `https://<your-app>.onrender.com/`

### 2. Đăng nhập Zalo
- Khi bot chạy lần đầu, kiểm tra log Render (View Logs) để lấy QR code (dạng link hoặc base64 PNG).
- Quét QR bằng app Zalo để đăng nhập bot.
- Cookie sẽ được lưu lại, không cần quét lại trừ khi cookie hết hạn.

### 3. Nhắn/nhận tin ở đâu?
- **Bạn (Boss) nhắn tin cho bot qua Zalo cá nhân** (user Zalo, không phải OA).
- Bot sẽ trả lời trực tiếp vào Zalo của bạn (Boss Zalo ID trong `.env`).
- Gửi lệnh `/help` để xem hướng dẫn, hoặc gửi lệnh `/me` để lấy Zalo userId của bạn.

### 4. Vận hành & kiểm tra
- Truy cập `https://<your-app>.onrender.com/` để kiểm tra bot đang chạy (trả về "Bot is running!").
- Để bot không bị sleep (Render free tier), dùng UptimeRobot hoặc cron-job.org ping route `/` mỗi 5 phút.
- Nếu server sleep, tin nhắn gửi cho bot trong thời gian đó sẽ bị mất (Zalo không queue message cho bot cá nhân).

### 5. Xử lý lỗi thường gặp
- **Lỗi better-sqlite3 native module:**
  - Clear build cache trên Render, redeploy lại.
  - Đảm bảo Dockerfile không copy `node_modules` từ local, đã có `RUN npm run build`.
- **Mất dữ liệu task:**
  - Render free không lưu file SQLite khi redeploy/reset. Task trong Google Calendar vẫn còn, nhưng trạng thái hoàn thành/xóa chỉ lưu ở local DB.
  - Nếu cần lưu lâu dài, dùng Render Persistent Disk (trả phí) hoặc mount volume khi chạy Docker local.
- **Không nhận được tin nhắn:**
  - Kiểm tra bot có đang chạy không (`/` route), kiểm tra QR/cookie Zalo còn hạn không.
- **Không đồng bộ Google Calendar:**
  - Kiểm tra lại Google OAuth2 credentials, refresh token, và quyền truy cập calendar.

---

## Lưu ý
- Chỉ 1 Boss user (Zalo ID trong .env).
- Không có frontend UI.
- Không CI/CD yaml.
- Nếu cần backup dữ liệu, hãy backup file `tasks.db` định kỳ.

---

## Thư mục chính
- `src/audio/`: Xử lý audio (download, convert, STT)
- `src/zalo/`: Zalo client
- `src/gcal/`: Google Calendar
- `src/db/`: SQLite
- `src/parser/`: Phân tích lệnh
- `src/scheduler/`: Lên lịch nhắc
- `src/webhooks/`: Webhook Google push
- `src/utils/`: Tiện ích

---

## Test & lint
```bash
npm run lint
npm run format
npm test
```

---

## TODO
- Bổ sung Google STT
- Hoàn thiện đồng bộ 2 chiều Google Calendar
- Tối ưu parser natural language
- Viết test coverage ≥ 80%
