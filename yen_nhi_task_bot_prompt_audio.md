```
# ROLE
Bạn là senior full‑stack engineer (Node.js + TypeScript), chuyên chatbot.  
Mục tiêu: sinh repo “yen‑nhi‑task‑bot” — AI agent nhận **text & audio** qua Zalo, convert audio→text, phân tích, lưu & đồng bộ task lên Google Calendar, nhắc Boss hằng ngày.

# 1. KIẾN TRÚC & CÔNG NGHỆ PHẢI DÙNG
• Runtime: Node.js 18+, code = **TypeScript** (ESM).  
• Zalo: **zca‑js** (unofficial, QR login).  
• STT: mặc định **OpenAI Whisper API**; tuỳ chọn Google STT qua biến `STT_PROVIDER`.  
• Media convert: **ffmpeg** shell exec (convert m4a/opus→wav 16 kHz mono).  
• Google Calendar: **googleapis** (OAuth2).  
• DB: **SQLite** (`better-sqlite3`) map `task_id ↔ gcal_event_id`.  
• Scheduler: **node-cron** (07:00 summary + 1‑phút near‑due 15′).  
• Web: **Express** (webhook Google push).  
• Env: dotenv.  
• Lint: ESLint + Prettier.  
• Test: vitest.  
• Packaging: Dockerfile + docker‑compose.  
• Logging: pino (JSON).  
• OPTIONAL: LLM parsing demo (OpenAI GPT‑4o) – bật `USE_LLM=true`.

# 2. YÊU CẦU TÍNH NĂNG
## 2.1 Lệnh Boss gửi (text hoặc audio)
- `/new <nội_dung> [@YYYY‑MM‑DD] [@HH:mm]`
- `/list`
- `/done <số|ID>`
- `/delete <số|ID>`
- `/help`
- Hoặc **voice** nói tự nhiên, vd:  
  “Chiều mai 3 giờ họp nhóm dự án” (bot sẽ tự hiểu thành `/new … @<date> @15:00`).

## 2.2 Luồng chính
1. **Login QR** → giữ cookie `.cookies.json`.
2. Listener `message`  
   * Nếu `msg.isAudio`:  
     a. download file → `ffmpeg` convert wav → gọi STT (`whisper` or `google`) → ra `plainText`.  
   * Với `plainText` (từ audio **hoặc** tin nhắn text), gọi `parseCommand()` (regex / LLM).  
3. Cập nhật DB → Google Calendar `events.<insert|update|delete>`.  
4. Phản hồi Zalo (text).  
5. **Cron 07:00** gửi checklist; **cron mỗi phút** nhắc near‑due (15′).  
6. **Google push**: `events.watch()` TTL 7 ngày, renew. Webhook `POST /gcal` sync DB & (tuỳ) báo Boss.

# 3. OUTPUT CẦN SINH
### Cấu trúc thư mục
```
yen-nhi-task-bot/
  src/
    audio/
      audioDownloader.ts
      convert.ts             # wrap ffmpeg
      stt.ts
    config/
    db/
    gcal/
    zalo/
    parser/
    scheduler/
    webhooks/
    utils/
    index.ts
  test/
  Dockerfile
  docker-compose.yml
  .env.example
  README.md
  tsconfig.json
  .eslintrc.cjs
  .prettierrc
```

### .env.example (bổ sung)
```
OPENAI_API_KEY=
STT_PROVIDER=whisper      # whisper | google
FFMPEG_PATH=/usr/bin/ffmpeg
AUDIO_TMP=./tmp
MAX_AUDIO_MIN=10
```

### Mô-đun mới cần code
| File | Chức năng |
|------|-----------|
| `audio/audioDownloader.ts` | Tải file âm thanh từ Zalo (token/url) trả Buffer. |
| `audio/convert.ts` | `convertToWav(buf):Promise<Buffer>` – dùng child_process spawn ffmpeg. |
| `audio/stt.ts` | `transcribe(buf, lang='vi'):Promise<string>` – Whisper (fetch `v1/audio/transcriptions`) hoặc Google STT tuỳ ENV. |
| Parser update | hỗ trợ chuỗi plainText đến từ STT. |

Các file còn lại giữ như prompt cũ (task DB, gcal service, scheduler…).

# 4. PHONG CÁCH CODE
• TypeScript strict, async/await sạch.  
• Mỗi file ≤ 300 dòng, JSDoc.  
• Vitest coverage ≥ 80 %.  
• Error class + Express error MW.  
• README bổ sung “Voice command setup” (cài ffmpeg + chi phí Whisper).

# 5. BỐ CỤC TRẢ LỜI
1. Cây thư mục (code‑block).  
2. Files: Dockerfile, docker-compose.yml, package.json.  
3. Từng file src/… (block code).  
4. README.  
5. Hướng dẫn test & dev.  

# 6. GIỚI HẠN
• Không CI/CD yaml.  
• Không UI frontend.  
• 1 Boss user.  
• Tổng ≤ 2 800 dòng mã.  

Bắt đầu sinh mã ngay.
```