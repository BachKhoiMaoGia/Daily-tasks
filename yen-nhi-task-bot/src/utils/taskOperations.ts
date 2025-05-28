/**
 * Enhanced Task Operations Module
 * Handles improved task identification, batch operations, and natural conversation
 */

import db from '../db/index.js';
import logger from '../utils/logger.js';
import { sendMessage } from '../zalo/index.js';

// Task matching modes
export interface TaskMatchResult {
    task: any;
    method: 'position' | 'id' | 'keyword' | 'partial';
    matchedText?: string;
}

/**
 * Enhanced task finder that supports multiple matching methods
 */
export function findTaskByReference(reference: string, unfinishedOnly = false): TaskMatchResult | null {
    try {
        reference = reference.trim();

        // Get the task list in the same order as displayed to user
        const query = unfinishedOnly ?
            'SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time' :
            'SELECT * FROM tasks ORDER BY done ASC, due_date ASC, due_time ASC';
        const allTasks: any[] = db.prepare(query).all();

        if (allTasks.length === 0) {
            return null;
        }

        // Method 1: Position number (1-based index) - PRIORITY
        if (/^\d+$/.test(reference)) {
            const position = parseInt(reference, 10);

            // Try position first (what users typically mean)
            if (position >= 1 && position <= allTasks.length) {
                const task = allTasks[position - 1];
                logger.info(`[TaskOps] Found task by position ${position}: "${task.content}"`);
                return { task, method: 'position', matchedText: `vị trí ${position}` };
            }

            // Fallback to ID if position doesn't match
            const taskById = allTasks.find(t => t.id === position);
            if (taskById) {
                logger.info(`[TaskOps] Found task by ID ${position}: "${taskById.content}"`);
                return { task: taskById, method: 'id', matchedText: `ID ${position}` };
            }
        }

        // Method 2: Exact keyword matching (case-insensitive)
        const searchTerm = reference.toLowerCase();
        const exactMatch = allTasks.find(t =>
            t.content.toLowerCase().includes(searchTerm)
        );

        if (exactMatch) {
            logger.info(`[TaskOps] Found task by keyword "${reference}": "${exactMatch.content}"`);
            return { task: exactMatch, method: 'keyword', matchedText: `từ khóa "${reference}"` };
        }

        // Method 3: Partial matching with fuzzy search
        const partialMatches = allTasks.filter(t => {
            const content = t.content.toLowerCase();
            const words = searchTerm.split(' ').filter(w => w.length > 2);
            return words.some(word => content.includes(word));
        });

        if (partialMatches.length === 1) {
            logger.info(`[TaskOps] Found task by partial match "${reference}": "${partialMatches[0].content}"`);
            return { task: partialMatches[0], method: 'partial', matchedText: `từ khóa gần đúng "${reference}"` };
        }

        // If multiple partial matches, return the first one but log ambiguity
        if (partialMatches.length > 1) {
            logger.warn(`[TaskOps] Multiple partial matches for "${reference}": ${partialMatches.length} tasks`);
            return { task: partialMatches[0], method: 'partial', matchedText: `từ khóa gần đúng "${reference}" (có ${partialMatches.length} kết quả)` };
        }

        return null;
    } catch (error) {
        logger.error('[TaskOps] Error in findTaskByReference:', error);
        return null;
    }
}

/**
 * Parse batch operations like "1,2,3" or "1-5" or "task1,task2"
 */
export function parseBatchReferences(input: string): string[] {
    const references: string[] = [];

    // Handle comma-separated values: "1,2,3" or "task1,task2"
    if (input.includes(',')) {
        return input.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    // Handle ranges: "1-5"
    const rangeMatch = input.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);

        if (start <= end && start >= 1 && end <= 50) { // Reasonable limits
            for (let i = start; i <= end; i++) {
                references.push(i.toString());
            }
            return references;
        }
    }

    // Single reference
    return [input.trim()];
}

/**
 * Enhanced task list display with clear position indicators
 */
export function formatTaskList(tasks: any[], includeIds = true, includePositions = true): string {
    if (tasks.length === 0) {
        return 'Không có task nào.';
    }

    const today = new Date().toISOString().split('T')[0];

    return tasks.map((task, index) => {
        const position = index + 1;
        let status = task.done ? '✅' : '📝';

        // Add urgency indicators
        if (!task.done && task.due_date) {
            if (task.due_date < today) status = '⚠️'; // Overdue
            else if (task.due_date === today) status = '🔥'; // Today
        }

        let line = '';

        if (includePositions) {
            line += `${position}. `;
        }

        line += `${status} ${task.content}`;

        if (task.due_date) {
            line += ` @${task.due_date}`;
        }

        if (task.due_time) {
            line += ` @${task.due_time}`;
        }

        if (includeIds) {
            line += ` (ID:${task.id})`;
        }

        return line;
    }).join('\n');
}

/**
 * Generate helpful error message when task not found
 */
export async function sendTaskNotFoundMessage(senderId: string, reference: string, showOptions = true): Promise<void> {
    let message = `❌ Không tìm thấy task "${reference}".`;

    if (showOptions) {
        const unfinishedTasks = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();

        if (unfinishedTasks.length > 0) {
            message += '\n\n📋 Danh sách task hiện có:';
            message += '\n' + formatTaskList(unfinishedTasks.slice(0, 10), true, true);

            if (unfinishedTasks.length > 10) {
                message += `\n... và ${unfinishedTasks.length - 10} task khác.`;
            }

            message += '\n\n💡 Bạn có thể dùng:';
            message += '\n• Số thứ tự: "1", "2", "3"...';
            message += '\n• Từ khóa: "họp", "mua đồ"...';
            message += '\n• ID: "ID:123"';
        }
    }

    await sendMessage(senderId, message);
}

/**
 * Batch task operations
 */
export interface BatchResult {
    success: number;
    failed: number;
    details: Array<{
        reference: string;
        success: boolean;
        task?: any;
        error?: string;
    }>;
}

/**
 * Execute batch done operation
 */
export async function batchDoneTasks(references: string[], senderId: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: 0, details: [] };

    for (const ref of references) {
        try {
            const match = findTaskByReference(ref, true);

            if (!match) {
                result.failed++;
                result.details.push({
                    reference: ref,
                    success: false,
                    error: 'Không tìm thấy task'
                });
                continue;
            }

            // Mark as done
            db.prepare('UPDATE tasks SET done = 1, near_due_notified = 0 WHERE id = ?').run(match.task.id);

            // Handle Google Calendar sync
            if (match.task.gcal_event_id) {
                try {
                    await import('../gcal/index.js').then(m => m.deleteEvent(match.task.gcal_event_id));
                } catch (err) {
                    logger.error('[TaskOps] Error deleting GCal event:', err);
                }
            }

            result.success++;
            result.details.push({
                reference: ref,
                success: true,
                task: match.task
            });

        } catch (error) {
            result.failed++;
            result.details.push({
                reference: ref,
                success: false,
                error: (error as Error).message
            });
        }
    }

    return result;
}

/**
 * Execute batch delete operation - FIXED: Collect all tasks first to prevent position shifting
 */
export async function batchDeleteTasks(references: string[], senderId: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: 0, details: [] };

    // Step 1: Collect all tasks first to prevent position shifting during deletion
    const tasksToDelete: { reference: string; task: any }[] = [];

    for (const ref of references) {
        try {
            const match = findTaskByReference(ref, false);

            if (!match) {
                result.failed++;
                result.details.push({
                    reference: ref,
                    success: false,
                    error: 'Không tìm thấy task'
                });
                continue;
            }

            tasksToDelete.push({ reference: ref, task: match.task });
            logger.info(`[TaskOps] Collected task for deletion: "${match.task.content}" (ID:${match.task.id})`);

        } catch (error) {
            result.failed++;
            result.details.push({
                reference: ref,
                success: false,
                error: (error as Error).message
            });
            logger.error(`[TaskOps] Error finding task "${ref}":`, error);
        }
    }

    // Step 2: Now delete all collected tasks by ID (position-independent)
    for (const { reference, task } of tasksToDelete) {
        try {
            // Store deleted task in deleted_tasks table
            db.prepare(`INSERT INTO deleted_tasks 
                (original_task_id, content, due_date, due_time, gcal_event_id, was_done, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                task.id, task.content, task.due_date, task.due_time,
                task.gcal_event_id, task.done, task.created_at
            );

            // Delete from Google Calendar first
            if (task.gcal_event_id) {
                try {
                    await import('../gcal/index.js').then(m => m.deleteEvent(task.gcal_event_id));
                    logger.info(`[TaskOps] Deleted GCal event: ${task.gcal_event_id}`);
                } catch (err) {
                    logger.error('[TaskOps] Error deleting GCal event:', err);
                }
            }

            // Delete from database using ID (not position)
            db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);

            result.success++;
            result.details.push({
                reference: reference,
                success: true,
                task: task
            });

            logger.info(`[TaskOps] Successfully deleted task: "${task.content}" (ID:${task.id})`);

        } catch (error) {
            result.failed++;
            result.details.push({
                reference: reference,
                success: false,
                error: (error as Error).message
            });
            logger.error(`[TaskOps] Error deleting task "${reference}":`, error);
        }
    }

    return result;
}

/**
 * Format batch operation result message with better task display
 */
export function formatBatchResultMessage(operation: string, result: BatchResult): string {
    let message = `📊 Kết quả ${operation}:\n`;

    if (result.success > 0) {
        message += `✅ Thành công: ${result.success} task\n`;
    }

    if (result.failed > 0) {
        message += `❌ Thất bại: ${result.failed} task\n`;
    }

    // Show details for successful operations with proper task content
    const successful = result.details.filter(d => d.success);
    if (successful.length > 0 && successful.length <= 5) {
        message += `\n🎯 Các task đã ${operation}:\n`;
        successful.forEach((detail, i) => {
            const taskContent = detail.task?.content || 'Unknown task';
            message += `${i + 1}. ${taskContent}\n`;
        });
    }

    // Show first few failed operations
    const failed = result.details.filter(d => !d.success);
    if (failed.length > 0 && failed.length <= 3) {
        message += `\n⚠️ Không thể ${operation}:\n`;
        failed.forEach((detail, i) => {
            message += `• "${detail.reference}": ${detail.error}\n`;
        });
    }

    return message.trim();
}

/**
 * Get deleted tasks list
 */
export function getDeletedTasks(limit = 20): any[] {
    return db.prepare(`
        SELECT * FROM deleted_tasks 
        ORDER BY deleted_at DESC 
        LIMIT ?
    `).all(limit);
}

/**
 * Format deleted tasks list
 */
export function formatDeletedTasksList(deletedTasks: any[]): string {
    if (deletedTasks.length === 0) {
        return 'Chưa có task nào bị xóa.';
    }

    return deletedTasks.map((task, index) => {
        const position = index + 1;
        const deletedDate = new Date(task.deleted_at).toLocaleDateString('vi-VN');
        const deletedTime = new Date(task.deleted_at).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let line = `${position}. 🗑️ ${task.content}`;

        if (task.due_date) {
            line += ` @${task.due_date}`;
        }

        if (task.due_time) {
            line += ` @${task.due_time}`;
        }

        line += `\n   └─ Xóa vào: ${deletedDate} ${deletedTime}`;

        if (task.was_done) {
            line += ' (đã hoàn thành)';
        }

        return line;
    }).join('\n\n');
}

/**
 * Smart task categorization for calendar vs meeting vs task - ENHANCED: Handle prefixes
 */
export function categorizeTaskType(content: string): 'calendar' | 'meeting' | 'task' {
    const content_lower = content.toLowerCase();    // Check for explicit prefixes first (highest priority)
    if (/^\[meeting\]/i.test(content) || /^\[họp\]/i.test(content)) {
        return 'meeting';
    }
    if (/^\[calendar\]/i.test(content) || /^\[lịch\]/i.test(content)) {
        return 'calendar';
    }
    if (/^\[task\]/i.test(content) || /^\[công việc\]/i.test(content)) {
        return 'task';
    }

    // FIXED: Respect explicit "task" keyword - highest priority
    if (/(?:tạo|làm|create)\s+task/i.test(content) || /task\s*:/i.test(content)) {
        return 'task';
    }    // Meeting keywords (formal business meetings)
    const meetingKeywords = [
        'họp', 'meeting', 'cuộc họp', 'hội nghị', 'hội thảo',
        'phỏng vấn', 'interview', 'tư vấn', 'thảo luận công việc',
        'gọi điện công việc', 'call meeting', 'zoom meeting', 'teams meeting',
        'bàn bạc', 'thương lượng', 'negotiate',
        'họp team', 'họp dự án', 'meeting project'
    ];

    // Calendar event keywords (personal events, appointments, social meetings)
    const calendarKeywords = [
        'gặp', 'gặp mặt', 'hẹn', 'appointment', 'lịch hẹn',
        'sinh nhật', 'birthday', 'lễ', 'event', 'sự kiện',
        'khám bác sĩ', 'doctor', 'bác sĩ', 'bệnh viện',
        'deadline', 'hạn chót', 'due date',
        'đi', 'đến', 'tại', 'ở', // location-based events
        'lúc', 'vào', 'vào lúc', 'thời gian', // time-specific events
        'với', 'cùng', // meeting with someone (personal)
        'reminder', 'nhắc nhở', 'nhắc',
        'conference', 'seminar', 'workshop', // conferences and seminars
        'khóa học', 'training', 'đào tạo', 'class', 'lớp học',
        'buổi', 'session', 'show', 'concert', 'biểu diễn'
    ];

    // Task keywords (actions, work items) - FIXED: Move presentation keywords here
    const taskKeywords = [
        'làm', 'viết', 'tạo', 'hoàn thành', 'complete',
        'mua', 'buy', 'đọc', 'read', 'học', 'study',
        'kiểm tra', 'check', 'review', 'dọn dẹp',
        'chuẩn bị', 'prepare', 'nộp', 'submit',
        'gửi', 'send', 'email', 'báo cáo', 'report',
        'trình bày', 'thuyết trình', 'present', 'demo', // MOVED: These are work tasks, not meetings
        'code', 'lập trình', 'debug', 'test', 'deploy'
    ];// Count matches
    const meetingMatches = meetingKeywords.filter(keyword =>
        content_lower.includes(keyword)
    ).length;

    const calendarMatches = calendarKeywords.filter(keyword =>
        content_lower.includes(keyword)
    ).length;

    const taskMatches = taskKeywords.filter(keyword =>
        content_lower.includes(keyword)
    ).length;

    // Special logic: Personal meetings with specific time are calendar events
    const hasPersonalMeeting = /gặp|gặp mặt/.test(content_lower);
    const hasSpecificTime = /\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|lúc\s*\d+|vào\s*\d+/.test(content_lower);
    const hasPersonNames = /anh|chị|ông|bà|ms\.|mr\./.test(content_lower);

    if (hasPersonalMeeting && (hasSpecificTime || hasPersonNames)) {
        return 'calendar';
    }

    // Formal meeting keywords take priority for business meetings
    const formalMeetingKeywords = ['họp', 'meeting', 'cuộc họp', 'hội nghị', 'phỏng vấn'];
    const hasFormalMeeting = formalMeetingKeywords.some(keyword => content_lower.includes(keyword));

    if (hasFormalMeeting) {
        return 'meeting';
    }

    // Calendar events with time/date take priority
    if (calendarMatches > 0 && (hasSpecificTime || content_lower.includes('ngày') || content_lower.includes('thứ'))) {
        return 'calendar';
    }

    // Remaining meeting keywords
    if (meetingMatches > taskMatches) {
        return 'meeting';
    }

    // Default logic based on keyword count
    if (calendarMatches > taskMatches) {
        return 'calendar';
    }

    // Default to task
    return 'task';
}

/**
 * Check for scheduling conflicts (events within 60 minutes of each other)
 */
export interface ConflictResult {
    hasConflict: boolean;
    conflicts?: {
        task: any;
        timeDifference: number; // minutes
        conflictType: 'overlap' | 'too-close';
    }[];
    suggestedTimes?: string[];
}

export function checkScheduleConflicts(dueDate: string, dueTime: string, endTime?: string): ConflictResult {
    try {
        // Validate input parameters
        if (!dueDate || !dueTime) {
            logger.warn('[TaskOps] Invalid parameters for conflict check:', { dueDate, dueTime, endTime });
            return { hasConflict: false };
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            logger.warn('[TaskOps] Invalid date format for conflict check:', dueDate);
            return { hasConflict: false };
        }

        // Validate time format
        if (!/^\d{2}:\d{2}$/.test(dueTime)) {
            logger.warn('[TaskOps] Invalid time format for conflict check:', dueTime);
            return { hasConflict: false };
        }

        const newStartTime = parseTimeToMinutes(dueTime);
        const newEndTime = endTime ? parseTimeToMinutes(endTime) : newStartTime + 60; // Default 1 hour

        logger.info('[TaskOps] Checking conflicts for:', {
            dueDate,
            dueTime,
            endTime,
            newStartTime,
            newEndTime
        });

        // Get all tasks/events for the same date
        const existingTasks = db.prepare(`
            SELECT * FROM tasks 
            WHERE due_date = ? AND done = 0 AND due_time IS NOT NULL
            ORDER BY due_time
        `).all(dueDate);

        logger.info('[TaskOps] Found existing tasks for conflict check:', {
            date: dueDate,
            taskCount: existingTasks.length,
            tasks: existingTasks.map((t: any) => ({
                id: t.id,
                content: t.content,
                due_time: t.due_time,
                end_time: t.end_time
            }))
        });

        const conflicts: ConflictResult['conflicts'] = [];
        for (const task of existingTasks) {
            try {
                const taskDueTime = (task as any).due_time;
                const taskEndTime = (task as any).end_time;

                // Skip if due_time is invalid
                if (!taskDueTime || !/^\d{2}:\d{2}$/.test(taskDueTime)) {
                    logger.warn('[TaskOps] Skipping task with invalid due_time:', {
                        taskId: (task as any).id,
                        due_time: taskDueTime
                    });
                    continue;
                }

                const existingStartTime = parseTimeToMinutes(taskDueTime);
                const existingEndTime = taskEndTime && /^\d{2}:\d{2}$/.test(taskEndTime) ?
                    parseTimeToMinutes(taskEndTime) : existingStartTime + 60;

                // Check for overlap
                const hasOverlap = (newStartTime < existingEndTime) && (newEndTime > existingStartTime);

                // Check if too close (within 60 minutes)
                const timeDifference = Math.min(
                    Math.abs(newStartTime - existingEndTime),
                    Math.abs(existingStartTime - newEndTime)
                );

                if (hasOverlap) {
                    conflicts.push({
                        task,
                        timeDifference: 0,
                        conflictType: 'overlap'
                    });
                    logger.info('[TaskOps] Found overlap conflict:', {
                        newEvent: `${dueTime}-${endTime || 'auto'}`,
                        existingTask: `${taskDueTime}-${taskEndTime || 'auto'}`,
                        taskContent: (task as any).content
                    });
                } else if (timeDifference < 60) {
                    conflicts.push({
                        task,
                        timeDifference,
                        conflictType: 'too-close'
                    });
                    logger.info('[TaskOps] Found too-close conflict:', {
                        newEvent: `${dueTime}-${endTime || 'auto'}`,
                        existingTask: `${taskDueTime}-${taskEndTime || 'auto'}`,
                        timeDifference,
                        taskContent: (task as any).content
                    });
                }
            } catch (taskError) {
                logger.error('[TaskOps] Error processing task for conflict check:', {
                    taskId: (task as any).id,
                    error: taskError,
                    taskData: task
                });
                // Continue with other tasks
            }
        }

        // Generate suggested times if conflicts exist
        let suggestedTimes: string[] = [];
        if (conflicts.length > 0) {
            try {
                suggestedTimes = generateSuggestedTimes(dueDate, newEndTime - newStartTime, existingTasks);
            } catch (suggestionError) {
                logger.error('[TaskOps] Error generating suggested times:', suggestionError);
            }
        }

        const result = {
            hasConflict: conflicts.length > 0,
            conflicts: conflicts.length > 0 ? conflicts : undefined,
            suggestedTimes: suggestedTimes.length > 0 ? suggestedTimes : undefined
        };

        logger.info('[TaskOps] Conflict check result:', {
            hasConflict: result.hasConflict,
            conflictCount: conflicts.length,
            suggestedTimesCount: suggestedTimes.length
        });

        return result;

    } catch (error) {
        logger.error('[TaskOps] Error checking schedule conflicts:', {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            input: { dueDate, dueTime, endTime }
        });
        return { hasConflict: false };
    }
}

/**
 * Convert time string to minutes since midnight
 */
function parseTimeToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + (minutes || 0);
}

/**
 * Generate suggested alternative times
 */
function generateSuggestedTimes(date: string, durationMinutes: number, existingTasks: any[]): string[] {
    const suggestions: string[] = [];
    const workingHours = { start: 8 * 60, end: 18 * 60 }; // 8 AM to 6 PM

    // Sort existing tasks by time
    const sortedTasks = existingTasks
        .map(task => ({
            start: parseTimeToMinutes(task.due_time),
            end: task.end_time ? parseTimeToMinutes(task.end_time) : parseTimeToMinutes(task.due_time) + 60
        }))
        .sort((a, b) => a.start - b.start);

    // Find gaps between existing tasks
    let currentTime = workingHours.start;

    for (const task of sortedTasks) {
        // Check if there's enough space before this task
        if (task.start - currentTime >= durationMinutes + 60) { // 60 min buffer
            const suggestedStart = Math.max(currentTime, workingHours.start);
            if (suggestedStart + durationMinutes <= workingHours.end) {
                suggestions.push(formatMinutesToTime(suggestedStart));
            }
        }
        currentTime = Math.max(currentTime, task.end + 60); // 60 min buffer after task
    }

    // Check if there's space after all tasks
    if (currentTime + durationMinutes <= workingHours.end) {
        suggestions.push(formatMinutesToTime(currentTime));
    }

    // If no suggestions within working hours, suggest early morning or next day
    if (suggestions.length === 0) {
        suggestions.push('07:00'); // Early morning
        suggestions.push('19:00'); // Evening
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
}

/**
 * Convert minutes since midnight to time string
 */
function formatMinutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Enhanced calendar sync with conflict checking
 */
export async function createTaskWithConflictCheck(taskInfo: any): Promise<{
    success: boolean;
    taskId?: number;
    conflictInfo?: ConflictResult;
    error?: string;
}> {
    try {
        // Check for conflicts if it's a calendar event or meeting
        let conflictInfo: ConflictResult | undefined;

        if ((taskInfo.taskType === 'calendar' || taskInfo.taskType === 'meeting') &&
            taskInfo.dueDate && taskInfo.dueTime) {

            conflictInfo = checkScheduleConflicts(
                taskInfo.dueDate,
                taskInfo.dueTime,
                taskInfo.endTime
            );

            // If conflicts exist, return without creating the task
            if (conflictInfo.hasConflict) {
                logger.warn('[TaskOps] Schedule conflict detected:', conflictInfo);
                return {
                    success: false,
                    conflictInfo,
                    error: 'Schedule conflict detected'
                };
            }
        }

        // If no conflicts, create the task
        const result = db.prepare(`
            INSERT INTO tasks (content, due_date, due_time, end_time, task_type, location, attendees, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            taskInfo.title || taskInfo.content,
            taskInfo.dueDate,
            taskInfo.dueTime,
            taskInfo.endTime,
            taskInfo.taskType || 'task',
            taskInfo.location,
            taskInfo.attendees ? JSON.stringify(taskInfo.attendees) : null,
            taskInfo.description
        );

        logger.info('[TaskOps] Task created successfully with ID:', result.lastInsertRowid);

        return {
            success: true,
            taskId: result.lastInsertRowid as number,
            conflictInfo
        };

    } catch (error) {
        logger.error('[TaskOps] Error creating task:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Task edit operations
 */
export interface TaskEditInfo {
    content?: string;
    dueDate?: string;
    dueTime?: string;
    endTime?: string;
    location?: string;
    description?: string;
}

/**
 * Edit a single task
 */
export async function editTask(reference: string, editInfo: TaskEditInfo, senderId: string): Promise<{
    success: boolean;
    task?: any;
    error?: string;
    conflictInfo?: ConflictResult;
}> {
    try {
        // Find the task
        const match = findTaskByReference(reference, false);
        if (!match) {
            return {
                success: false,
                error: 'Không tìm thấy task'
            };
        }

        const task = match.task;
        logger.info(`[TaskOps] Editing task "${task.content}" (ID:${task.id})`);

        // Check for schedule conflicts if changing time/date
        let conflictInfo: ConflictResult | undefined;
        const newDueDate = editInfo.dueDate || task.due_date;
        const newDueTime = editInfo.dueTime || task.due_time;
        const newEndTime = editInfo.endTime || task.end_time;

        if ((task.task_type === 'calendar' || task.task_type === 'meeting') &&
            (editInfo.dueDate || editInfo.dueTime || editInfo.endTime) &&
            newDueDate && newDueTime) {

            conflictInfo = checkScheduleConflicts(newDueDate, newDueTime, newEndTime);

            // Filter out the current task from conflicts
            if (conflictInfo.conflicts) {
                conflictInfo.conflicts = conflictInfo.conflicts.filter(c => c.task.id !== task.id);
                conflictInfo.hasConflict = conflictInfo.conflicts.length > 0;
            }

            // If conflicts exist, return without updating
            if (conflictInfo.hasConflict) {
                logger.warn('[TaskOps] Schedule conflict detected for task edit:', conflictInfo);
                return {
                    success: false,
                    conflictInfo,
                    error: 'Schedule conflict detected'
                };
            }
        }

        // Prepare update fields
        const updateFields: string[] = [];
        const updateValues: any[] = [];

        if (editInfo.content !== undefined) {
            updateFields.push('content = ?');
            updateValues.push(editInfo.content);
        }
        if (editInfo.dueDate !== undefined) {
            updateFields.push('due_date = ?');
            updateValues.push(editInfo.dueDate);
        }
        if (editInfo.dueTime !== undefined) {
            updateFields.push('due_time = ?');
            updateValues.push(editInfo.dueTime);
        }
        if (editInfo.endTime !== undefined) {
            updateFields.push('end_time = ?');
            updateValues.push(editInfo.endTime);
        }
        if (editInfo.location !== undefined) {
            updateFields.push('location = ?');
            updateValues.push(editInfo.location);
        }
        if (editInfo.description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(editInfo.description);
        }

        if (updateFields.length === 0) {
            return {
                success: false,
                error: 'Không có thông tin nào để cập nhật'
            };
        }

        // Update database
        updateValues.push(task.id);
        const updateQuery = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`;
        db.prepare(updateQuery).run(...updateValues);        // Get updated task
        const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as any;

        // Update Google Calendar if needed
        if (task.gcal_event_id) {
            try {
                const gcalModule = await import('../gcal/index.js');

                const eventUpdate: any = {};
                if (editInfo.content) {
                    eventUpdate.summary = editInfo.content;
                }
                if (editInfo.description) {
                    eventUpdate.description = editInfo.description;
                }
                if (editInfo.location) {
                    eventUpdate.location = editInfo.location;
                }

                // Update date/time if changed
                if (editInfo.dueDate || editInfo.dueTime || editInfo.endTime) {
                    const startDateTime = newDueDate && newDueTime ?
                        `${newDueDate}T${newDueTime}:00` :
                        task.due_date && task.due_time ? `${task.due_date}T${task.due_time}:00` : null;

                    const endDateTime = newEndTime ?
                        `${newDueDate || task.due_date}T${newEndTime}:00` :
                        startDateTime ? new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString().slice(0, 19) : null;

                    if (startDateTime) {
                        eventUpdate.start = {
                            dateTime: startDateTime,
                            timeZone: 'Asia/Ho_Chi_Minh'
                        };
                        eventUpdate.end = {
                            dateTime: endDateTime,
                            timeZone: 'Asia/Ho_Chi_Minh'
                        };
                    }
                }

                await gcalModule.updateEvent(task.gcal_event_id, eventUpdate);
                logger.info(`[TaskOps] Updated Google Calendar event: ${task.gcal_event_id}`);

            } catch (err) {
                logger.error('[TaskOps] Error updating Google Calendar event:', err);
                // Don't fail the entire operation for calendar sync issues
            }
        }

        logger.info(`[TaskOps] Successfully edited task: "${updatedTask.content}" (ID:${task.id})`);

        return {
            success: true,
            task: updatedTask,
            conflictInfo
        };

    } catch (error) {
        logger.error('[TaskOps] Error editing task:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Execute batch edit operation
 */
export async function batchEditTasks(references: string[], editInfo: TaskEditInfo, senderId: string): Promise<BatchResult> {
    const result: BatchResult = { success: 0, failed: 0, details: [] };

    for (const ref of references) {
        try {
            const editResult = await editTask(ref, editInfo, senderId);

            if (editResult.success) {
                result.success++;
                result.details.push({
                    reference: ref,
                    success: true,
                    task: editResult.task
                });
            } else {
                result.failed++;
                result.details.push({
                    reference: ref,
                    success: false,
                    error: editResult.error || 'Unknown error'
                });
            }

        } catch (error) {
            result.failed++;
            result.details.push({
                reference: ref,
                success: false,
                error: (error as Error).message
            });
        }
    }

    return result;
}

/**
 * Parse edit command and extract fields to update
 */
export function parseEditCommand(content: string): {
    references: string[];
    editInfo: TaskEditInfo;
    isValidEdit: boolean;
    error?: string;
} {
    try {
        // Remove /edit or /sua prefix
        const cleanContent = content.replace(/^\/(edit|sua|chỉnh sửa|chinh sua)\s*/i, '').trim();

        if (!cleanContent) {
            return {
                references: [],
                editInfo: {},
                isValidEdit: false,
                error: 'Thiếu thông tin cần chỉnh sửa'
            };
        }

        // Parse format: "reference(s) field1:value1 field2:value2"
        // or "reference(s) new_content" (for content update)
        const parts = cleanContent.split(' ');

        if (parts.length === 0) {
            return {
                references: [],
                editInfo: {},
                isValidEdit: false,
                error: 'Thiếu tham số'
            };
        }

        // First part is references
        const referencesPart = parts[0];
        const references = parseBatchReferences(referencesPart);

        // Rest is edit info
        const editParts = parts.slice(1);
        const editInfo: TaskEditInfo = {};

        if (editParts.length === 0) {
            return {
                references,
                editInfo: {},
                isValidEdit: false,
                error: 'Thiếu thông tin cần chỉnh sửa'
            };
        }

        // Check if it's field:value format or just new content
        const hasFieldFormat = editParts.some(part => part.includes(':'));

        if (hasFieldFormat) {
            // Parse field:value pairs
            for (const part of editParts) {
                if (part.includes(':')) {
                    const [field, ...valueParts] = part.split(':');
                    const value = valueParts.join(':').trim();

                    if (!value) continue;

                    switch (field.toLowerCase()) {
                        case 'content':
                        case 'noi dung':
                        case 'nội dung':
                            editInfo.content = value;
                            break;
                        case 'date':
                        case 'ngay':
                        case 'ngày':
                            // Parse date format
                            editInfo.dueDate = parseEditDate(value);
                            break;
                        case 'time':
                        case 'gio':
                        case 'giờ':
                            editInfo.dueTime = parseEditTime(value);
                            break;
                        case 'endtime':
                        case 'end':
                        case 'ket thuc':
                        case 'kết thúc':
                            editInfo.endTime = parseEditTime(value);
                            break;
                        case 'location':
                        case 'noi':
                        case 'nơi':
                        case 'dia diem':
                        case 'địa điểm':
                            editInfo.location = value;
                            break;
                        case 'description':
                        case 'mo ta':
                        case 'mô tả':
                        case 'ghi chu':
                        case 'ghi chú':
                            editInfo.description = value;
                            break;
                    }
                }
            }
        } else {
            // Treat as new content
            editInfo.content = editParts.join(' ');
        }

        const isValidEdit = Object.keys(editInfo).length > 0;

        return {
            references,
            editInfo,
            isValidEdit,
            error: isValidEdit ? undefined : 'Không tìm thấy thông tin hợp lệ để chỉnh sửa'
        };

    } catch (error) {
        logger.error('[TaskOps] Error parsing edit command:', error);
        return {
            references: [],
            editInfo: {},
            isValidEdit: false,
            error: 'Lỗi phân tích câu lệnh'
        };
    }
}

/**
 * Parse date for editing (supports various formats)
 */
function parseEditDate(dateStr: string): string {
    try {
        dateStr = dateStr.trim().toLowerCase();

        // Handle relative dates
        if (dateStr === 'today' || dateStr === 'hôm nay' || dateStr === 'hom nay') {
            return new Date().toISOString().split('T')[0];
        }
        if (dateStr === 'tomorrow' || dateStr === 'ngày mai' || dateStr === 'ngay mai') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }

        // Handle dd/mm/yyyy or dd-mm-yyyy format
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(dateStr)) {
            const [day, month, year] = dateStr.split(/[\/\-]/).map(Number);
            return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        }

        // Handle yyyy-mm-dd format (already correct)
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }

        // Handle dd/mm (current year)
        if (/^\d{1,2}[\/\-]\d{1,2}$/.test(dateStr)) {
            const [day, month] = dateStr.split(/[\/\-]/).map(Number);
            const year = new Date().getFullYear();
            return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        }

        return dateStr; // Return as-is if can't parse
    } catch (error) {
        logger.error('[TaskOps] Error parsing edit date:', error);
        return dateStr;
    }
}

/**
 * Parse time for editing (supports various formats)
 */
function parseEditTime(timeStr: string): string {
    try {
        timeStr = timeStr.trim();

        // Handle HH:MM format
        if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }

        // Handle HH format (add :00)
        if (/^\d{1,2}$/.test(timeStr)) {
            const hours = parseInt(timeStr, 10);
            return `${hours.toString().padStart(2, '0')}:00`;
        }

        // Handle h(h)h format with 'h' suffix
        if (/^\d{1,2}h$/.test(timeStr)) {
            const hours = parseInt(timeStr.replace('h', ''), 10);
            return `${hours.toString().padStart(2, '0')}:00`;
        }

        return timeStr; // Return as-is if can't parse
    } catch (error) {
        logger.error('[TaskOps] Error parsing edit time:', error);
        return timeStr;
    }
}

/**
 * Format edit result message
 */
export function formatEditResultMessage(references: string[], result: BatchResult, editInfo: TaskEditInfo): string {
    let message = `📝 Kết quả chỉnh sửa:\n`;

    if (result.success > 0) {
        message += `✅ Thành công: ${result.success} task\n`;
    }

    if (result.failed > 0) {
        message += `❌ Thất bại: ${result.failed} task\n`;
    }

    // Show what was changed
    const changes: string[] = [];
    if (editInfo.content) changes.push(`Nội dung: "${editInfo.content}"`);
    if (editInfo.dueDate) changes.push(`Ngày: ${editInfo.dueDate}`);
    if (editInfo.dueTime) changes.push(`Giờ: ${editInfo.dueTime}`);
    if (editInfo.endTime) changes.push(`Giờ kết thúc: ${editInfo.endTime}`);
    if (editInfo.location) changes.push(`Địa điểm: ${editInfo.location}`);
    if (editInfo.description) changes.push(`Mô tả: ${editInfo.description}`);

    if (changes.length > 0) {
        message += `\n🎯 Thay đổi:\n${changes.join('\n')}\n`;
    }

    // Show successful edits
    const successful = result.details.filter(d => d.success);
    if (successful.length > 0 && successful.length <= 5) {
        message += `\n✏️ Các task đã chỉnh sửa:\n`;
        successful.forEach((detail, i) => {
            const taskContent = detail.task?.content || 'Unknown task';
            message += `${i + 1}. ${taskContent}\n`;
        });
    }

    // Show failed edits
    const failed = result.details.filter(d => !d.success);
    if (failed.length > 0 && failed.length <= 3) {
        message += `\n⚠️ Không thể chỉnh sửa:\n`;
        failed.forEach((detail) => {
            message += `• "${detail.reference}": ${detail.error}\n`;
        });
    }

    return message.trim();
}
