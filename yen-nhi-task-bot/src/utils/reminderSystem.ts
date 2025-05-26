/**
 * Task Reminder System
 * Gửi nhắc nhở cho các task sắp đến hạn
 */
import { TaskInfo } from '../google/manager.js';
import logger from '../utils/logger.js';
import { sendMessage } from '../zalo/index.js';
import { config } from '../config/index.js';

interface ReminderTask {
    id: string;
    taskInfo: TaskInfo;
    reminderTime: Date;
    userId: string;
    type: 'task' | 'calendar';
    sent: boolean;
}

class TaskReminderSystem {
    private reminders: Map<string, ReminderTask> = new Map();
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor() {
        logger.info('[Reminder] Task Reminder System initialized');
    }

    /**
     * Thêm reminder cho task mới
     */
    addReminder(taskInfo: TaskInfo, userId: string, taskId: string, type: 'task' | 'calendar'): void {
        try {
            if (!taskInfo.dueDate) {
                logger.warn('[Reminder] No due date provided, skipping reminder setup');
                return;
            }

            // Tính toán thời gian nhắc nhở (trước 1 giờ cho calendar events, trước 1 ngày cho tasks)
            const dueDate = new Date(taskInfo.dueDate);

            if (taskInfo.dueTime) {
                const [hours, minutes] = taskInfo.dueTime.split(':').map(Number);
                dueDate.setHours(hours, minutes, 0, 0);
            }

            let reminderTime: Date;

            if (type === 'calendar') {
                // Nhắc trước 1 giờ cho calendar events
                reminderTime = new Date(dueDate.getTime() - 60 * 60 * 1000);
            } else {
                // Nhắc trước 1 ngày cho tasks (lúc 9h sáng)
                reminderTime = new Date(dueDate);
                reminderTime.setDate(reminderTime.getDate() - 1);
                reminderTime.setHours(9, 0, 0, 0);
            }

            // Không tạo reminder cho quá khứ
            if (reminderTime <= new Date()) {
                logger.info('[Reminder] Reminder time is in the past, skipping');
                return;
            }

            const reminder: ReminderTask = {
                id: taskId,
                taskInfo,
                reminderTime,
                userId,
                type,
                sent: false
            };

            this.reminders.set(taskId, reminder);

            logger.info('[Reminder] Added reminder:', {
                taskId,
                title: taskInfo.title,
                reminderTime: reminderTime.toISOString(),
                type
            });

            // Start checking nếu chưa chạy
            this.startChecking();

        } catch (error) {
            logger.error('[Reminder] Error adding reminder:', error);
        }
    }

    /**
     * Xóa reminder
     */
    removeReminder(taskId: string): void {
        if (this.reminders.delete(taskId)) {
            logger.info(`[Reminder] Removed reminder for task ${taskId}`);
        }
    }

    /**
     * Bắt đầu check reminders
     */
    startChecking(): void {
        if (this.isRunning) return;

        this.isRunning = true;

        // Check mỗi phút
        this.intervalId = setInterval(() => {
            this.checkReminders();
        }, 60 * 1000);

        logger.info('[Reminder] Started checking reminders every minute');
    }

    /**
     * Dừng check reminders
     */
    stopChecking(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('[Reminder] Stopped checking reminders');
    }

    /**
     * Check và gửi reminders
     */
    private async checkReminders(): Promise<void> {
        const now = new Date();

        for (const [taskId, reminder] of this.reminders) {
            if (!reminder.sent && now >= reminder.reminderTime) {
                await this.sendReminder(reminder);
                reminder.sent = true;

                // Remove reminder sau khi gửi
                setTimeout(() => {
                    this.reminders.delete(taskId);
                }, 5 * 60 * 1000); // Remove after 5 minutes
            }
        }

        // Cleanup old sent reminders
        this.cleanupOldReminders();
    }

    /**
     * Gửi reminder message
     */
    private async sendReminder(reminder: ReminderTask): Promise<void> {
        try {
            const { taskInfo, type, userId } = reminder;

            let message = '';

            if (type === 'calendar') {
                message = `🔔 Nhắc nhở: Bạn có cuộc họp "${taskInfo.title}"`;

                if (taskInfo.dueTime) {
                    message += ` lúc ${taskInfo.dueTime}`;
                }

                if (taskInfo.location) {
                    message += ` tại ${taskInfo.location}`;
                }

                message += ' trong 1 giờ nữa!';

                if (taskInfo.description?.includes('[Google Meet requested]')) {
                    message += '\n📹 Cuộc họp có Google Meet link.';
                }

            } else {
                message = `📋 Nhắc nhở: Task "${taskInfo.title}" sẽ đến hạn`;

                if (taskInfo.dueDate) {
                    const dueDate = new Date(taskInfo.dueDate);
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);

                    if (dueDate.toDateString() === tomorrow.toDateString()) {
                        message += ' vào ngày mai';
                    } else {
                        message += ` vào ${dueDate.toLocaleDateString('vi-VN')}`;
                    }
                }

                message += '!';

                if (taskInfo.description) {
                    message += `\n📝 Ghi chú: ${taskInfo.description}`;
                }
            }            // Gửi message đến Boss
            if (userId === config.bossZaloId) {
                await sendMessage(userId, message);
                logger.info(`[Reminder] Sent reminder to Boss for ${type}: ${taskInfo.title}`);
            } else {
                logger.info(`[Reminder] Would send reminder to user ${userId} for ${type}: ${taskInfo.title}`);
                // TODO: Implement sending to other users when multi-user support is added
            }

        } catch (error) {
            logger.error('[Reminder] Error sending reminder:', error);
        }
    }

    /**
     * Cleanup old reminders
     */
    private cleanupOldReminders(): void {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for (const [taskId, reminder] of this.reminders) {
            if (reminder.reminderTime < oneDayAgo) {
                this.reminders.delete(taskId);
                logger.info(`[Reminder] Cleaned up old reminder for task ${taskId}`);
            }
        }
    }

    /**
     * Lấy danh sách pending reminders
     */
    getPendingReminders(): ReminderTask[] {
        return Array.from(this.reminders.values()).filter(r => !r.sent);
    }

    /**
     * Lấy stats về reminders
     */
    getStats(): { total: number; pending: number; sent: number } {
        const allReminders = Array.from(this.reminders.values());
        const pending = allReminders.filter(r => !r.sent).length;
        const sent = allReminders.filter(r => r.sent).length;

        return {
            total: allReminders.length,
            pending,
            sent
        };
    }
}

export default new TaskReminderSystem();
