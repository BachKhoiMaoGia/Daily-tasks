# 🤖 Vietnamese Task Bot

**Zalo-powered AI task management bot** với voice recognition, Google Calendar sync và intelligent scheduling.

[![Production Ready](https://img.shields.io/badge/status-production%20ready-green)](https://render.com)
[![Docker](https://img.shields.io/badge/docker-optimized-blue)](./Dockerfile)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue)](./tsconfig.json)

## ✨ **Tính năng chính**

### 🗣️ **Voice & Text Interface**
- ✅ Nhận lệnh qua **Zalo** (text hoặc audio)
- ✅ **Vietnamese STT** (Whisper API + HuggingFace)
- ✅ Phân tích ngôn ngữ tự nhiên thông minh

### 📅 **Task Management**
- ✅ **Batch operations**: `/done 1,2,3`, `/delete 1-5`
- ✅ **Smart edit**: `/edit 1 content:New task`
- ✅ **Conflict detection**: Tự động phát hiện xung đột lịch
- ✅ **Auto-categorization**: Meeting/Calendar/Task

### 🔄 **Google Integration**
- ✅ **Bi-directional sync** với Google Calendar & Tasks
- ✅ **Real-time updates** qua webhook
- ✅ **Smart scheduling** với conflict prevention
- ✅ **Multiple calendars/tasklists** support

### 🔔 **Smart Reminders**
- ✅ **Daily checklist** (07:00 sáng)
- ✅ **Near-due alerts** (15 phút trước)
- ✅ **Anti-spam** intelligent notifications
- ✅ **Context-aware** reminders

## 🚀 **Production Features**

### 🐳 **Docker Optimized**
- ✅ Multi-stage build (builder + production)
- ✅ Security: Non-root user
- ✅ Size: Optimized slim image
- ✅ Health checks included

### 📊 **Monitoring**
- ✅ Health endpoint: `/health`
- ✅ Structured JSON logging (pino)
- ✅ Error tracking & graceful degradation
- ✅ Production-ready error handling

### 🔐 **Security**
- ✅ Environment-based configuration
- ✅ Secure OAuth2 flow
- ✅ Cookie encryption & persistence
- ✅ API key protection

---

## 🛠️ **Tech Stack**

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 18+ TypeScript | ES modules, strict typing |
| **Zalo** | zca-js | QR login, message handling |
| **STT** | OpenAI Whisper, HuggingFace | Vietnamese speech recognition |
| **Database** | SQLite (better-sqlite3) | Local task storage |
| **Calendar** | Google APIs | Calendar/Tasks sync |
| **Audio** | ffmpeg | Audio format conversion |
| **Web** | Express | Webhooks, health checks |
| **Scheduler** | node-cron | Automated reminders |
| **Containerization** | Docker | Production deployment |

---

## 🏃‍♂️ **Quick Start**

### **Local Development**
```bash
git clone <repository>
cd yen-nhi-task-bot
cp .env.example .env
# Edit .env with your API keys
npm install
npm run build
npm start
```

### **Docker (Local)**
```bash
docker-compose up --build
```

### **Production (Render.com)**
```bash
# Run deployment script
.\deploy-render.ps1 -Build -Test -Push
```

📖 **Full deployment guide:** [RENDER_DEPLOY_GUIDE.md](./RENDER_DEPLOY_GUIDE.md)

---

### 1. Deploy
- Push code lên GitHub.
- Tạo dịch vụ mới trên Render (Web Service).
- Chọn repo, đặt **Root Directory** là `yen-nhi-task-bot`.
- Render sẽ tự nhận Dockerfile, build và deploy.
- Vào tab Environment, thêm các biến từ `.env.example` (hoặc upload file `.env`).
- Khi build xong, app sẽ chạy ở URL dạng: `https://<your-app>.onrender.com/`

### 2. Đăng nhập Zalo
#### **🌐 QR Code trên Web (Recommended for Render):**
1. Mở trình duyệt và truy cập: `https://your-app.onrender.com/qr`
2. Quét QR code bằng app Zalo trên điện thoại
3. QR code tự động refresh và có hướng dẫn chi tiết
4. Sau khi đăng nhập thành công, QR sẽ biến mất

#### **📋 Kiểm tra status:**
- `https://your-app.onrender.com/status` - JSON status của bot
- `https://your-app.onrender.com/qr.png` - QR image trực tiếp

#### **📝 Fallback (nếu web không hoạt động):**
- Kiểm tra log Render (View Logs) để lấy QR code dạng base64 PNG
- Cookie sẽ được lưu lại, không cần quét lại trừ khi hết hạn

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
