// scheduler/tasks.ts
// Hàm gửi checklist 8h sáng và nhắc task gần đến hạn (15 phút)
import db from '../db/index';
import { config } from '../config/index';
import { sendMessage } from '../zalo/index';
import { GoogleManager } from '../google/manager.js';
import { listEvents } from '../gcal/index.js';
import logger from '../utils/logger.js';

// Thêm cột near_due_notified nếu chưa có
try {
    db.exec('ALTER TABLE tasks ADD COLUMN near_due_notified INTEGER DEFAULT 0');
} catch {
    // Column already exists, ignore
}

export async function verifyFreshDataFlow() {
    const verificationStart = Date.now();
    const results = {
        googleCalendar: { success: false, responseTime: 0, error: null as any },
        googleTasks: { success: false, responseTime: 0, error: null as any },
        timestamp: new Date().toISOString()
    };

    // Test Google Calendar API
    try {
        const calStart = Date.now();
        const today = new Date();
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        const events = await listEvents(startOfDay.toISOString(), endOfDay.toISOString());
        results.googleCalendar.responseTime = Date.now() - calStart;
        results.googleCalendar.success = true;

        logger.info('[Fresh Data Verification] Google Calendar API call successful:', {
            responseTime: results.googleCalendar.responseTime,
            eventsCount: events?.length || 0
        });
    } catch (error) {
        results.googleCalendar.error = error;
        logger.error('[Fresh Data Verification] Google Calendar API failed:', error);
    }

    // Test Google Tasks API
    try {
        const tasksStart = Date.now();
        const googleManager = new GoogleManager();
        const tasks = await googleManager.getTasks();
        results.googleTasks.responseTime = Date.now() - tasksStart;
        results.googleTasks.success = true;

        logger.info('[Fresh Data Verification] Google Tasks API call successful:', {
            responseTime: results.googleTasks.responseTime,
            tasksCount: tasks?.length || 0
        });
    } catch (error) {
        results.googleTasks.error = error;
        logger.error('[Fresh Data Verification] Google Tasks API failed:', error);
    }

    const totalTime = Date.now() - verificationStart;
    logger.info('[Fresh Data Verification] Complete verification results:', {
        ...results,
        totalVerificationTime: totalTime,
        allSuccess: results.googleCalendar.success && results.googleTasks.success
    });

    return results;
}

export async function sendChecklist() {
    try {        // Log current LLM model configuration
        const logLlmProvider = config.openaiBaseUrl?.includes('github') ? 'GitHub Models' : 'OpenAI';
        logger.info('[Daily Checklist] System Model Configuration:', {
            llmEnabled: config.useLLM,
            hasApiKey: !!config.openaiApiKey,
            llmModel: config.openaiModelId,
            llmProvider: logLlmProvider,
            apiBaseUrl: config.openaiBaseUrl,
            sttProvider: config.sttProvider,
            whisperModel: config.huggingfaceWhisperModel,
            timestamp: new Date().toISOString()
        });

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        // Format ngày đẹp hơn cho hiển thị
        const displayDate = today.toLocaleDateString('vi-VN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Asia/Ho_Chi_Minh'
        }); let checklistMsg = `🌅 **CHECKLIST SÁNG - ${displayDate}**\n\n`;

        // Add system info to checklist with fresh data verification
        const displayLlmProvider = config.openaiBaseUrl?.includes('github') ? 'GitHub Models' : 'OpenAI';
        const llmModelDisplay = config.useLLM ? `${config.openaiModelId} (${displayLlmProvider})` : 'Disabled';

        checklistMsg += `🤖 **THÔNG TIN HỆ THỐNG:**\n`;
        checklistMsg += `   💬 LLM Model: ${llmModelDisplay}\n`;
        checklistMsg += `   🎙️ STT Model: ${config.huggingfaceWhisperModel}\n`;

        // Verify fresh data flow
        const freshDataResults = await verifyFreshDataFlow();
        const freshDataStatus = freshDataResults.googleCalendar.success && freshDataResults.googleTasks.success ? '✅' : '⚠️';
        checklistMsg += `   🔄 Fresh Data: ${freshDataStatus} Google APIs (Cal: ${freshDataResults.googleCalendar.responseTime}ms, Tasks: ${freshDataResults.googleTasks.responseTime}ms)\n\n`;

        // 1. Lấy lịch làm việc từ Google Calendar
        let calendarEvents = [];
        try {
            // Tạo thời gian bắt đầu và kết thúc cho hôm nay (UTC+7)
            const startOfDay = new Date(today);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(today);
            endOfDay.setHours(23, 59, 59, 999);

            const events = await listEvents(startOfDay.toISOString(), endOfDay.toISOString());
            calendarEvents = events || [];
        } catch (error) {
            console.error('Error fetching calendar events:', error);
        }

        // 2. Hiển thị lịch làm việc
        checklistMsg += `📅 **LỊCH LÀM VIỆC HÔM NAY:**\n`;
        if (calendarEvents.length === 0) {
            checklistMsg += `   ✨ Không có sự kiện nào trong calendar\n`;
        } else {
            for (let i = 0; i < calendarEvents.length; i++) {
                const event = calendarEvents[i];
                const eventTime = event.start?.dateTime ?
                    new Date(event.start.dateTime).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Ho_Chi_Minh'
                    }) : 'Cả ngày';

                checklistMsg += `   ${i + 1}. ${eventTime} - ${event.summary || 'Không có tiêu đề'}\n`;

                // Thêm location nếu có
                if (event.location) {
                    checklistMsg += `      📍 ${event.location}\n`;
                }
            }
        }

        // 3. Lấy nhiệm vụ từ Google Tasks và local database
        checklistMsg += `\n✅ **NHIỆM VỤ CẦN HOÀN THÀNH HÔM NAY:**\n`;

        let totalTasks = 0;

        // Lấy từ Google Tasks
        try {
            const googleManager = new GoogleManager();
            const googleTasks = await googleManager.getTasks();

            const todayTasks = googleTasks.filter(task => {
                if (!task.due) return false;

                const taskDue = new Date(task.due);
                const taskDueStr = taskDue.toISOString().split('T')[0];
                return taskDueStr === todayStr && task.status !== 'completed';
            });

            if (todayTasks.length > 0) {
                checklistMsg += `   **Google Tasks:**\n`;
                todayTasks.forEach((task, index) => {
                    checklistMsg += `   ${totalTasks + index + 1}. ${task.title}\n`;
                });
                totalTasks += todayTasks.length;
            }
        } catch (error) {
            console.error('Error fetching Google Tasks:', error);
        }

        // Lấy từ local database
        const localTasks: any[] = db.prepare(
            'SELECT * FROM tasks WHERE done = 0 AND due_date = ? ORDER BY due_time'
        ).all(todayStr);

        if (localTasks.length > 0) {
            if (totalTasks > 0) checklistMsg += `\n   **Local Tasks:**\n`;
            localTasks.forEach((task, index) => {
                const timeStr = task.due_time ? ` (${task.due_time})` : '';
                checklistMsg += `   ${totalTasks + index + 1}. ${task.content}${timeStr}\n`;
            });
            totalTasks += localTasks.length;
        }

        if (totalTasks === 0) {
            checklistMsg += `   ✨ Không có nhiệm vụ nào hôm nay\n`;
        }

        // 4. Thêm thống kê tổng quan
        checklistMsg += `\n📊 **TỔNG QUAN:**\n`;
        checklistMsg += `   🗓️ Sự kiện: ${calendarEvents.length}\n`;
        checklistMsg += `   📋 Nhiệm vụ: ${totalTasks}\n`;

        // 5. Thêm lời chúc
        const greetings = [
            "Chúc Boss một ngày làm việc hiệu quả! 💪",
            "Chúc Boss một ngày tràn đầy năng lượng! ⚡",
            "Chúc Boss hoàn thành tốt mọi kế hoạch! 🎯",
            "Chúc Boss một ngày thành công rực rỡ! ✨"
        ];
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

        checklistMsg += `\n🎉 ${randomGreeting}`;

        await sendMessage(config.bossZaloId || '', checklistMsg);

    } catch (error) {
        console.error('Error in sendChecklist:', error);
        await sendMessage(config.bossZaloId || '', '❌ Có lỗi khi tạo checklist sáng. Vui lòng kiểm tra hệ thống.');
    }
}

export async function sendNearDue() {
    // Use UTC+7 timezone for consistent date/time calculations
    const now = new Date();
    const utcOffset = 7 * 60; // UTC+7 in minutes
    const localTime = new Date(now.getTime() + (utcOffset * 60 * 1000));

    const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_time IS NOT NULL AND (near_due_notified IS NULL OR near_due_notified = 0)').all();

    for (const r of rows) {
        if (!r.due_date || !r.due_time) continue;

        // Create due date in UTC+7 timezone for accurate comparison
        const due = new Date(`${r.due_date}T${r.due_time}:00+07:00`);
        const diff = (due.getTime() - now.getTime()) / 60000; // phút

        if (diff > 0 && diff <= 15) {
            // Enhanced: Show full task information for pre-deadline reminders
            let reminderMsg = `🚨 Sắp đến hạn: ${r.content}\n`;
            reminderMsg += `📅 Thời gian: ${r.due_date} ${r.due_time}`;

            if (r.location) {
                reminderMsg += `\n📍 Địa điểm: ${r.location}`;
            }

            if (r.description) {
                reminderMsg += `\n📝 Mô tả: ${r.description}`;
            }

            if (r.end_time) {
                reminderMsg += `\n⏰ Kết thúc: ${r.end_time}`;
            }

            reminderMsg += `\n⏳ Còn ${Math.ceil(diff)} phút`;

            await sendMessage(config.bossZaloId || '', reminderMsg);
            db.prepare('UPDATE tasks SET near_due_notified = 1 WHERE id = ?').run(r.id);
        }
    }
}
