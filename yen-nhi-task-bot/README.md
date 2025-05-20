# yen-nhi-task-bot

AI agent nhận lệnh **text & audio** qua Zalo, convert audio→text, phân tích, lưu & đồng bộ task lên Google Calendar, nhắc Boss hằng ngày.

## Tính năng chính

- Nhận lệnh Zalo (text hoặc audio): `/new`, `/list`, `/done`, `/delete`, `/help` hoặc nói tự nhiên.
- Convert audio (m4a/opus) sang text bằng OpenAI Whisper API (hoặc Google STT).
- Lưu task vào SQLite, đồng bộ Google Calendar.
- Nhắc checklist 07:00, nhắc gần đến hạn (15').
- Webhook Google push sync DB.

## Kiến trúc & Công nghệ

- Node.js 18+, TypeScript strict (ESM)
- Zalo: zca-js (QR login)
- STT: OpenAI Whisper API (mặc định), Google STT (tùy chọn)
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

## Cài đặt

```bash
git clone ...
cd yen-nhi-task-bot
cp .env.example .env
npm install
```

### Voice command setup

- **Cài ffmpeg**: `sudo apt install ffmpeg` (hoặc dùng Docker)
- **OpenAI Whisper API**: Đăng ký key tại https://platform.openai.com/
- **Chi phí**: Whisper API tính phí theo phút audio (xem pricing OpenAI)
- Google STT: cần API key, xem docs Google Cloud

## Chạy bot

```bash
npm run build
npm start
# hoặc dùng Docker:
docker-compose up --build
```

## Test & lint

```bash
npm run lint
npm run format
npm test
```

## Thư mục chính

- `src/audio/`: Xử lý audio (download, convert, STT)
- `src/zalo/`: Zalo client
- `src/gcal/`: Google Calendar
- `src/db/`: SQLite
- `src/parser/`: Phân tích lệnh
- `src/scheduler/`: Lên lịch nhắc
- `src/webhooks/`: Webhook Google push
- `src/utils/`: Tiện ích

## Lưu ý

- Chỉ 1 Boss user (Zalo ID trong .env)
- Không có frontend UI
- Không CI/CD yaml

---

## TODO

- Bổ sung Google STT
- Hoàn thiện đồng bộ 2 chiều Google Calendar
- Tối ưu parser natural language
- Viết test coverage ≥ 80%
