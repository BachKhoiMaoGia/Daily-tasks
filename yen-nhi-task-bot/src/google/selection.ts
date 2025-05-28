/**
 * Google Selection System - Quản lý việc chọn calendar/task list
 * Khi có nhiều options, hỏi Boss để chọn
 */
import logger from '../utils/logger';
import { sendMessage } from '../zalo/index';

export interface SelectionOption {
    id: string;
    name: string;
    description?: string;
    type: 'calendar' | 'tasklist';
}

export interface PendingSelection {
    userId: string;
    options: SelectionOption[];
    type: 'calendar' | 'tasklist';
    context: any; // Original task info or context
    timestamp: number;
}

class SelectionManager {
    private pendingSelections: Map<string, PendingSelection> = new Map();

    /**
     * Tạo selection prompt cho Boss
     */
    async promptSelection(
        userId: string,
        options: SelectionOption[],
        type: 'calendar' | 'tasklist',
        context: any
    ): Promise<void> {
        if (options.length === 0) {
            await sendMessage(userId, `Không tìm thấy ${type === 'calendar' ? 'calendar' : 'task list'} nào.`);
            return;
        }

        if (options.length === 1) {
            // Chỉ có 1 option, tự động chọn
            logger.info(`[Selection] Auto-selecting single ${type}: ${options[0].name}`);
            if (type === 'calendar') {
                context.calendarId = options[0].id;
            } else {
                context.taskListId = options[0].id;
            }
            return;
        }

        // Có nhiều options, hỏi Boss chọn
        const selection: PendingSelection = {
            userId,
            options,
            type,
            context,
            timestamp: Date.now()
        };

        this.pendingSelections.set(userId, selection);        // Tạo message với danh sách options
        const typeText = type === 'calendar' ? 'Calendar' : 'Task List';
        let message = `🔍 Tìm thấy ${options.length} ${typeText}s. Vui lòng chọn:\n\n`;

        options.forEach((option, index) => {
            message += `${index + 1}. ${option.name}`;
            if (option.description) {
                message += ` - ${option.description}`;
            }
            message += '\n';
        });

        if (type === 'tasklist') {
            message += `\nTrả lời bằng số thứ tự (1-${options.length}) để chọn task list.`;
            message += `\n💡 Chọn "${options.length}" để tạo task list mới với tên tùy chỉnh.`;
        } else {
            message += `\nTrả lời bằng số thứ tự (1-${options.length}) để chọn ${typeText.toLowerCase()}.`;
        }

        await sendMessage(userId, message);
        logger.info(`[Selection] Prompted user ${userId} to select from ${options.length} ${type}s`);
    }    /**
     * Xử lý response từ Boss
     */
    async handleSelectionResponse(userId: string, response: string): Promise<{ handled: boolean; continueTask?: any }> {
        const pending = this.pendingSelections.get(userId);
        if (!pending) {
            return { handled: false }; // Không có pending selection
        }

        // Kiểm tra timeout (5 phút)
        if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
            this.pendingSelections.delete(userId);
            await sendMessage(userId, '⏰ Timeout: Quá thời gian chọn. Vui lòng thử lại.');
            return { handled: true };
        }

        // Handle task list name input
        if ((pending as any).type === 'tasklist-name') {
            const taskListName = response.trim();

            if (taskListName.length < 2) {
                await sendMessage(userId, '❌ Tên Task List quá ngắn. Vui lòng nhập tên có ít nhất 2 ký tự.');
                return { handled: true };
            }

            if (taskListName.length > 100) {
                await sendMessage(userId, '❌ Tên Task List quá dài. Vui lòng nhập tên ngắn hơn 100 ký tự.');
                return { handled: true };
            }

            logger.info(`[Selection] Creating new task list: "${taskListName}" for user ${userId}`);

            try {
                // Import GoogleManager dynamically to avoid circular dependency
                const { GoogleManager } = await import('../google/manager.js');
                const googleManager = new GoogleManager();

                // Create new task list
                const result = await googleManager.createTaskList(taskListName);

                if (result.success && result.taskListId) {
                    // Update context with new task list ID
                    pending.context.taskListId = result.taskListId;

                    const context = pending.context;
                    this.pendingSelections.delete(userId);

                    await sendMessage(userId, `✅ Đã tạo Task List mới: "${taskListName}"`);

                    return { handled: true, continueTask: context };
                } else {
                    await sendMessage(userId, `❌ Lỗi tạo Task List: ${result.error || 'Unknown error'}`);
                    return { handled: true };
                }
            } catch (error: any) {
                logger.error('[Selection] Error creating task list:', error);
                await sendMessage(userId, `❌ Lỗi hệ thống khi tạo Task List: ${error.message}`);
                return { handled: true };
            }
        }

        // CRITICAL FIX: Check for cancel commands first
        const normalizedResponse = response.toLowerCase().trim();
        const cancelPatterns = [
            'không',
            'hủy',
            'huy',
            'cancel',
            '/cancel',
            'no',
            'n',
            'stop',
            'quit',
            'exit',
            'bỏ',
            'thôi'
        ];

        if (cancelPatterns.includes(normalizedResponse)) {
            logger.info(`[Selection] Cancel command detected: "${response}"`);
            this.pendingSelections.delete(userId);
            await sendMessage(userId, '❌ Đã hủy bỏ việc chọn. Quá trình tạo task đã bị hủy.');
            return { handled: true };
        }

        // Parse response
        const choice = parseInt(response.trim());
        if (isNaN(choice) || choice < 1 || choice > pending.options.length) {
            await sendMessage(userId, `❌ Lựa chọn không hợp lệ. Vui lòng chọn số từ 1-${pending.options.length} hoặc gõ "hủy" để hủy bỏ.`);
            return { handled: true }; // Handled but invalid
        }        // Apply selection
        const selectedOption = pending.options[choice - 1];

        // Handle "Create New Task List" option
        if (selectedOption.id === 'CREATE_NEW_TASKLIST') {
            logger.info(`[Selection] User ${userId} chose to create new task list`);

            // Store context with special flag
            pending.context.createNewTaskList = true;
            this.pendingSelections.delete(userId);

            await sendMessage(userId, '📝 Tên cho Task List mới?\nVí dụ: "Project ABC", "Cá nhân", "Công việc khẩn cấp"...');

            // Set pending task list creation
            this.pendingSelections.set(userId, {
                userId,
                options: [],
                type: 'tasklist-name',
                context: pending.context,
                timestamp: Date.now()
            } as any);

            return { handled: true };
        }

        if (pending.type === 'calendar') {
            pending.context.calendarId = selectedOption.id;
        } else {
            pending.context.taskListId = selectedOption.id;
        }

        // Clear pending and confirm
        const context = pending.context;
        this.pendingSelections.delete(userId);
        await sendMessage(userId, `✅ Đã chọn ${pending.type === 'calendar' ? 'Calendar' : 'Task List'}: ${selectedOption.name}`);

        logger.info(`[Selection] User ${userId} selected ${pending.type}: ${selectedOption.name} (${selectedOption.id})`);

        return { handled: true, continueTask: context };
    }

    /**
     * Check if user has pending selection
     */
    hasPendingSelection(userId: string): boolean {
        return this.pendingSelections.has(userId);
    }

    /**
     * Get pending selection context
     */
    getPendingSelection(userId: string): PendingSelection | undefined {
        return this.pendingSelections.get(userId);
    }

    /**
     * Clear pending selection
     */
    clearPendingSelection(userId: string): void {
        this.pendingSelections.delete(userId);
        logger.info(`[Selection] Cleared pending selection for user ${userId}`);
    }

    /**
     * Convert Google Calendar list to selection options
     */
    static formatCalendarOptions(calendars: any[]): SelectionOption[] {
        return calendars.map(cal => ({
            id: cal.id,
            name: cal.summary || cal.summaryOverride || 'Unnamed Calendar',
            description: cal.description || (cal.primary ? '(Primary)' : undefined),
            type: 'calendar'
        }));
    }

    /**
     * Convert Google Task lists to selection options
     */
    static formatTaskListOptions(taskLists: any[]): SelectionOption[] {
        return taskLists.map(list => ({
            id: list.id,
            name: list.title || 'Unnamed Task List',
            description: undefined,
            type: 'tasklist'
        }));
    }

    /**
     * Clean up expired selections (older than 5 minutes)
     */
    cleanupExpiredSelections(): void {
        const now = Date.now();
        for (const [userId, selection] of this.pendingSelections.entries()) {
            if (now - selection.timestamp > 5 * 60 * 1000) {
                this.pendingSelections.delete(userId);
                logger.info(`[Selection] Cleaned up expired selection for user ${userId}`);
            }
        }
    }
}

export { SelectionManager };
export default new SelectionManager();