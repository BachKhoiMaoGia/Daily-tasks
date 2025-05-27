/**
 * Natural Conversation Module
 * Handles conversational task creation with missing information detection and follow-up questions
 */

import logger from '../utils/logger.js';
import { sendMessage } from '../zalo/index.js';
import llmParser, { LLMParseResult } from './llmParser.js';

// Conversation states
interface ConversationState {
    userId: string;
    stage: 'awaiting_deadline' | 'awaiting_time' | 'awaiting_confirmation' | 'complete';
    taskContent: string;
    dueDate?: string;
    dueTime?: string;
    timestamp: number;
}

// Store active conversations
const activeConversations = new Map<string, ConversationState>();

/**
 * Analyze task content for missing critical information using LLM when available
 */
export async function analyzeTaskInfo(content: string): Promise<{
    hasTitle: boolean;
    hasDate: boolean;
    hasTime: boolean;
    extractedDate?: string;
    extractedTime?: string;
    missingInfo: string[];
}> {
    const analysis = {
        hasTitle: true, // If they're creating a task, assume content is the title
        hasDate: false,
        hasTime: false,
        extractedDate: undefined as string | undefined,
        extractedTime: undefined as string | undefined,
        missingInfo: [] as string[]
    };

    try {
        // Try to extract date using LLM parser
        const dateParseResult = await llmParser.parseResponse(content, 'date', 'Extracting date from task description');
        if (dateParseResult.intent === 'date' && dateParseResult.extractedValue && dateParseResult.confidence > 0.6) {
            analysis.hasDate = true;
            analysis.extractedDate = dateParseResult.extractedValue;
        }

        // Try to extract time using LLM parser
        const timeParseResult = await llmParser.parseResponse(content, 'time', 'Extracting time from task description');
        if (timeParseResult.intent === 'time' && timeParseResult.extractedValue && timeParseResult.confidence > 0.6) {
            analysis.hasTime = true;
            analysis.extractedTime = timeParseResult.extractedValue;
        }

        logger.info('[Conversation] LLM analysis results:', {
            content,
            dateResult: dateParseResult,
            timeResult: timeParseResult,
            analysis
        });

    } catch (error) {
        logger.warn('[Conversation] LLM analysis failed, falling back to regex:', error);

        // Fallback to original regex-based analysis
        const fallbackAnalysis = analyzeTaskInfoRegex(content);
        analysis.hasDate = fallbackAnalysis.hasDate;
        analysis.hasTime = fallbackAnalysis.hasTime;
        analysis.extractedDate = fallbackAnalysis.extractedDate;
        analysis.extractedTime = fallbackAnalysis.extractedTime;
    }

    // Determine missing info
    if (!analysis.hasDate) {
        analysis.missingInfo.push('date');
    }

    // Only ask for time if it's a scheduled task (has date or time keywords)
    const hasScheduleKeywords = /lúc|vào|ngày|giờ|sáng|chiều|tối|am|pm/i.test(content);
    if (hasScheduleKeywords && !analysis.hasTime) {
        analysis.missingInfo.push('time');
    }

    return analysis;
}

/**
 * Fallback regex-based analysis (original function logic)
 */
function analyzeTaskInfoRegex(content: string): {
    hasDate: boolean;
    hasTime: boolean;
    extractedDate?: string;
    extractedTime?: string;
} {
    const analysis = {
        hasDate: false,
        hasTime: false,
        extractedDate: undefined as string | undefined,
        extractedTime: undefined as string | undefined
    };

    // Check for date patterns
    const datePatterns = [
        /(\d{4}-\d{2}-\d{2})/,           // 2025-05-25
        /(\d{2}\/\d{2}\/\d{4})/,        // 25/05/2025
        /(hôm nay|today)/i,             // hôm nay
        /(ngày mai|tomorrow)/i,         // ngày mai
        /(chủ nhật|sunday)/i,           // chủ nhật
        /(thứ hai|monday)/i,            // thứ hai
        /(thứ ba|tuesday)/i,            // thứ ba
        /(thứ tư|wednesday)/i,          // thứ tư
        /(thứ năm|thursday)/i,          // thứ năm
        /(thứ sáu|friday)/i,            // thứ sáu
        /(thứ bảy|saturday)/i           // thứ bảy
    ];

    for (const pattern of datePatterns) {
        const match = content.match(pattern);
        if (match) {
            analysis.hasDate = true;
            analysis.extractedDate = match[1];
            break;
        }
    }

    // Check for time patterns
    const timePatterns = [
        /(\d{1,2}:\d{2})/,              // 15:30
        /(\d{1,2}h\d{2})/,              // 15h30
        /(\d{1,2} giờ)/i,               // 3 giờ
        /(\d{1,2} giờ \d{2})/i,         // 3 giờ 30
        /(sáng|chiều|tối)/i,            // sáng/chiều/tối
        /(\d{1,2}am|\d{1,2}pm)/i        // 3pm, 9am
    ];

    for (const pattern of timePatterns) {
        const match = content.match(pattern);
        if (match) {
            analysis.hasTime = true;
            analysis.extractedTime = match[1];
            break;
        }
    }

    return analysis;
}

/**
 * Detect if a message contains task creation intent
 */
function detectTaskIntent(content: string): boolean {
    const taskIndicators = [
        // Vietnamese task keywords
        /nhắc tôi/i,
        /nhắc em/i,
        /tôi cần/i,
        /em cần/i,
        /làm.*vào/i,
        /deadline/i,
        /hẹn.*lúc/i,
        /cuộc họp/i,
        /meeting/i,
        /gặp.*lúc/i,
        /tại.*lúc/i,
        /vào.*lúc/i,
        /họp.*lúc/i,
        /học.*lúc/i,

        // English task keywords
        /remind me/i,
        /i need to/i,
        /schedule.*for/i,
        /due.*on/i,
        /deadline.*on/i,
        /meeting.*at/i
    ];

    return taskIndicators.some(pattern => pattern.test(content));
}

/**
 * Start a conversational task creation
 */
export async function startConversationalTask(userId: string, content: string): Promise<boolean> {
    // First check if this looks like a task creation request
    if (!detectTaskIntent(content)) {
        return false;
    }

    // Instead of handling conversation here, delegate to GoogleManager
    // This ensures consistent handling and missing info detection
    logger.info('[Conversation] Detected task intent, delegating to Google Manager');

    try {
        // Import task creation module to avoid circular imports
        const { handleTaskCreation } = await import('./taskCreation.js');

        // Call the same function that /new command uses
        await handleTaskCreation(content, userId);
        return true;

    } catch (error) {
        logger.error('[Conversation] Error delegating to task creation module:', error);

        // Fallback to old behavior if there's an error
        return await startConversationalTaskLegacy(userId, content);
    }
}

/**
 * Legacy conversational task creation (fallback)
 */
async function startConversationalTaskLegacy(userId: string, content: string): Promise<boolean> {
    const analysis = await analyzeTaskInfo(content);

    // If we have all info, create task directly
    if (analysis.missingInfo.length === 0) {
        logger.info('[Conversation] All task info present, creating task directly');

        // Import database for direct task creation
        const db = (await import('../db/index.js')).default;
        const { sendMessage } = await import('../zalo/index.js');

        // Extract clean task content (remove time/date info that's now stored separately)
        let cleanContent = content
            .replace(/nhắc tôi|nhắc em/gi, '')
            .replace(/lúc \d{1,2}(h|:|giờ)\d{0,2}/gi, '')
            .replace(/vào \w+/gi, '')
            .replace(/ngày mai|hôm nay/gi, '')
            .trim();

        if (!cleanContent) {
            cleanContent = content; // Fallback to original if cleaning failed
        }

        // Insert task to database  
        const stmt = db.prepare('INSERT INTO tasks (content, due_date, due_time, done, near_due_notified) VALUES (?, ?, ?, 0, 0)');
        const info = stmt.run(cleanContent, analysis.extractedDate, analysis.extractedTime);

        let reply = `✅ Đã tạo task: ${cleanContent}`;
        if (analysis.extractedDate) reply += `\n📅 Ngày: ${analysis.extractedDate}`;
        if (analysis.extractedTime) reply += `\n⏰ Giờ: ${analysis.extractedTime}`;

        await sendMessage(userId, reply);
        return true;
    }

    // Missing info, start conversation
    const conversation: ConversationState = {
        userId,
        stage: analysis.missingInfo.includes('date') ? 'awaiting_deadline' : 'awaiting_time',
        taskContent: content,
        dueDate: analysis.extractedDate,
        dueTime: analysis.extractedTime,
        timestamp: Date.now()
    };

    activeConversations.set(userId, conversation);

    // Ask for missing information
    if (analysis.missingInfo.includes('date')) {
        await sendMessage(userId,
            `📝 Tôi sẽ tạo task: "${content}"\n\n` +
            `⏰ Bạn muốn hoàn thành task này khi nào?\n\n` +
            `💡 Ví dụ:\n` +
            `• "hôm nay"\n` +
            `• "ngày mai"\n` +
            `• "thứ hai"\n` +
            `• "2025-05-26"\n` +
            `• "không cần deadline" (nếu không có thời hạn)`
        );
    } else if (analysis.missingInfo.includes('time')) {
        await sendMessage(userId,
            `📝 Tôi sẽ tạo task: "${content}"\n\n` +
            `🕐 Bạn muốn làm lúc mấy giờ?\n\n` +
            `💡 Ví dụ:\n` +
            `• "15:30"\n` +
            `• "3 giờ chiều"\n` +
            `• "sáng"\n` +
            `• "không cần giờ cụ thể"`
        );
    }

    return true;
}

/**
 * Handle response in conversation
 */
export async function handleConversationResponse(userId: string, response: string): Promise<{
    handled: boolean;
    taskData?: any;
    continueConversation?: boolean;
}> {
    const conversation = activeConversations.get(userId);

    if (!conversation) {
        return { handled: false };
    }

    // Clean expired conversations (older than 5 minutes)
    if (Date.now() - conversation.timestamp > 5 * 60 * 1000) {
        activeConversations.delete(userId);
        await sendMessage(userId, '⏰ Hết thời gian tạo task. Vui lòng thử lại.');
        return { handled: true };
    }

    const responseText = response.toLowerCase().trim();

    // CRITICAL FIX: Check for cancel commands first
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

    if (cancelPatterns.includes(responseText)) {
        logger.info(`[Conversation] Cancel command detected: "${response}"`);
        activeConversations.delete(userId);
        await sendMessage(userId, '❌ Đã hủy bỏ việc tạo task.');
        return { handled: true };
    } try {
        if (conversation.stage === 'awaiting_deadline') {
            // Use LLM parser for more flexible date parsing
            const parseResult = await llmParser.parseResponse(response, 'date', `Parsing deadline for task: "${conversation.taskContent}"`);

            logger.info(`[Conversation] LLM parse result for deadline:`, parseResult);

            if (parseResult.intent === 'cancel') {
                activeConversations.delete(userId);
                await sendMessage(userId, '❌ Đã hủy bỏ việc tạo task.');
                return { handled: true };
            }

            if (parseResult.intent === 'skip') {
                // User doesn't want deadline
                conversation.dueDate = undefined;
            } else if (parseResult.intent === 'date' && parseResult.extractedValue) {
                conversation.dueDate = parseResult.extractedValue;
            } else {
                // Invalid date format or unclear intent
                const errorMsg = parseResult.confidence < 0.5
                    ? `❌ Không hiểu thời gian "${response}". Vui lòng thử lại:\n\n` +
                    `💡 Ví dụ: "hôm nay", "ngày mai", "thứ hai", "2025-05-26"\n` +
                    `Hoặc "không cần deadline" nếu không có thời hạn.\n` +
                    `Gõ "hủy" để hủy bỏ tạo task.`
                    : `❌ Tôi hiểu bạn muốn nói về thời gian nhưng không rõ cụ thể. Vui lòng thử lại:\n\n` +
                    `💡 Ví dụ: "hôm nay", "ngày mai", "thứ hai", "15/6"\n` +
                    `Hoặc "không cần deadline" nếu không có thời hạn.\n` +
                    `Gõ "hủy" để hủy bỏ tạo task.`;

                await sendMessage(userId, errorMsg);
                return { handled: true, continueConversation: true };
            }

            // Check if we need time
            const needsTime = hasScheduleKeywords(conversation.taskContent) && !conversation.dueTime;

            if (needsTime && conversation.dueDate) {
                // Ask for time
                conversation.stage = 'awaiting_time';
                conversation.timestamp = Date.now();

                await sendMessage(userId,
                    `✅ Ngày: ${formatDate(conversation.dueDate)}\n\n` +
                    `🕐 Bạn muốn làm lúc mấy giờ?\n\n` +
                    `💡 Ví dụ: "15:30", "3 giờ chiều", "sáng"\n` +
                    `Hoặc "không cần giờ cụ thể"\n` +
                    `Gõ "hủy" để hủy bỏ tạo task.`
                );
                return { handled: true, continueConversation: true };
            } else {
                // Complete task creation
                return completeConversationalTask(userId, conversation);
            }
        }

        else if (conversation.stage === 'awaiting_time') {
            // Use LLM parser for more flexible time parsing
            const parseResult = await llmParser.parseResponse(response, 'time', `Parsing time for task: "${conversation.taskContent}" on ${conversation.dueDate}`);

            logger.info(`[Conversation] LLM parse result for time:`, parseResult);

            if (parseResult.intent === 'cancel') {
                activeConversations.delete(userId);
                await sendMessage(userId, '❌ Đã hủy bỏ việc tạo task.');
                return { handled: true };
            }

            if (parseResult.intent === 'skip') {
                conversation.dueTime = undefined;
            } else if (parseResult.intent === 'time' && parseResult.extractedValue) {
                conversation.dueTime = parseResult.extractedValue;
            } else {
                const errorMsg = parseResult.confidence < 0.5
                    ? `❌ Không hiểu thời gian "${response}". Vui lòng thử lại:\n\n` +
                    `💡 Ví dụ: "15:30", "3 giờ chiều", "sáng"\n` +
                    `Hoặc "không cần giờ cụ thể"\n` +
                    `Gõ "hủy" để hủy bỏ tạo task.`
                    : `❌ Tôi hiểu bạn muốn nói về thời gian nhưng không rõ cụ thể. Vui lòng thử lại:\n\n` +
                    `💡 Ví dụ: "15:30", "3 giờ chiều", "sáng"\n` +
                    `Hoặc "không cần giờ cụ thể"\n` +
                    `Gõ "hủy" để hủy bỏ tạo task.`;

                await sendMessage(userId, errorMsg);
                return { handled: true, continueConversation: true };
            }

            // Complete task creation
            return completeConversationalTask(userId, conversation);
        }

    } catch (error) {
        logger.error('[Conversation] Error handling response:', error);
        activeConversations.delete(userId);
        await sendMessage(userId, '❌ Có lỗi xảy ra. Vui lòng thử tạo task lại.');
        return { handled: true };
    }

    return { handled: false };
}

/**
 * Complete conversational task creation
 */
function completeConversationalTask(userId: string, conversation: ConversationState): {
    handled: boolean;
    taskData: any;
} {
    activeConversations.delete(userId);

    const taskData = {
        title: conversation.taskContent,
        dueDate: conversation.dueDate,
        dueTime: conversation.dueTime
    };

    logger.info('[Conversation] Completed conversational task:', taskData);

    return {
        handled: true,
        taskData
    };
}

/**
 * Parse date response from user
 */
function parseDateResponse(response: string): { date?: string; skip?: boolean } {
    // Handle skip phrases
    if (/không|chưa|sau|skip|no/i.test(response)) {
        return { skip: true };
    }

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Handle relative dates
    if (/hôm nay|today/i.test(response)) {
        return { date: today.toISOString().split('T')[0] };
    }

    if (/ngày mai|tomorrow/i.test(response)) {
        return { date: tomorrow.toISOString().split('T')[0] };
    }

    // Handle weekdays (Vietnamese)
    const weekdays = {
        'chủ nhật': 0, 'sunday': 0,
        'thứ hai': 1, 'monday': 1,
        'thứ ba': 2, 'tuesday': 2,
        'thứ tư': 3, 'wednesday': 3,
        'thứ năm': 4, 'thursday': 4,
        'thứ sáu': 5, 'friday': 5,
        'thứ bảy': 6, 'saturday': 6
    };

    for (const [day, dayNum] of Object.entries(weekdays)) {
        if (response.includes(day)) {
            const nextWeekday = getNextWeekday(dayNum);
            return { date: nextWeekday.toISOString().split('T')[0] };
        }
    }

    // Handle YYYY-MM-DD format
    const isoMatch = response.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        return { date: isoMatch[1] };
    }

    // Handle DD/MM/YYYY format
    const dmyMatch = response.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyMatch) {
        const [, day, month, year] = dmyMatch;
        return { date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
    }

    return {};
}

/**
 * Parse time response from user
 */
function parseTimeResponse(response: string): { time?: string; skip?: boolean } {
    // Handle skip phrases
    if (/không|chưa|sau|skip|no|cụ thể/i.test(response)) {
        return { skip: true };
    }

    // Handle HH:MM format
    const timeMatch = response.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        const [, hours, minutes] = timeMatch;
        return { time: `${hours.padStart(2, '0')}:${minutes}` };
    }

    // Handle Vietnamese time expressions
    if (/sáng/i.test(response)) {
        return { time: '09:00' };
    }
    if (/chiều/i.test(response)) {
        return { time: '15:00' };
    }
    if (/tối/i.test(response)) {
        return { time: '19:00' };
    }

    // Handle "X giờ" format
    const hourMatch = response.match(/(\d{1,2})\s*giờ(?:\s*(\d{2}))?/);
    if (hourMatch) {
        const [, hours, minutes = '00'] = hourMatch;
        let hour = parseInt(hours, 10);

        // Convert to 24-hour format if needed
        if (hour <= 12 && /chiều|pm/i.test(response)) {
            hour += 12;
        }

        return { time: `${hour.toString().padStart(2, '0')}:${minutes}` };
    }

    return {};
}

/**
 * Get next occurrence of a weekday
 */
function getNextWeekday(targetDay: number): Date {
    const today = new Date();
    const currentDay = today.getDay();
    let daysUntilTarget = targetDay - currentDay;

    if (daysUntilTarget <= 0) {
        daysUntilTarget += 7; // Next week
    }

    const nextWeekday = new Date(today);
    nextWeekday.setDate(today.getDate() + daysUntilTarget);
    return nextWeekday;
}

/**
 * Check if content has schedule-related keywords
 */
function hasScheduleKeywords(content: string): boolean {
    return /lúc|vào|ngày|giờ|sáng|chiều|tối|am|pm|meeting|họp|gặp/i.test(content);
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    if (dateStr === todayStr) return 'hôm nay';
    if (dateStr === tomorrowStr) return 'ngày mai';

    const weekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return `${weekdays[date.getDay()]} (${dateStr})`;
}

/**
 * Check if user has active conversation
 */
export function hasActiveConversation(userId: string): boolean {
    return activeConversations.has(userId);
}

/**
 * Clear conversation for a specific user
 */
export function clearConversation(userId: string): boolean {
    const hadConversation = activeConversations.has(userId);
    if (hadConversation) {
        activeConversations.delete(userId);
        logger.info(`[Conversation] Cleared active conversation for user ${userId}`);
    }
    return hadConversation;
}

/**
 * Clear expired conversations (cleanup)
 */
export function cleanupExpiredConversations(): void {
    const now = Date.now();
    const expiredTime = 5 * 60 * 1000; // 5 minutes

    for (const [userId, conversation] of activeConversations.entries()) {
        if (now - conversation.timestamp > expiredTime) {
            activeConversations.delete(userId);
            logger.info(`[Conversation] Cleaned up expired conversation for user ${userId}`);
        }
    }
}
