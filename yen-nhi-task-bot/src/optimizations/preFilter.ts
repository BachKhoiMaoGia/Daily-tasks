/**
 * Pre-Filter for Non-Task Messages
 * Quickly identify and filter out messages that are clearly not task-related
 * to minimize unnecessary LLM calls
 */
import logger from '../utils/logger.js';

interface PreFilterResult {
    isTaskLikely: boolean;
    confidence: number;
    reason: string;
    quickReply?: string;
}

class MessagePreFilter {
    // Common greeting patterns
    private greetingPatterns = [
        /^(xin chào|chào|hi|hello|good morning|good afternoon|good evening)$/i,
        /^(chào bạn|chào em|chào anh|chào chị)$/i,
        /^(tôi|mình|em) (tên|là) /i
    ];

    // Common question patterns that are NOT tasks
    private questionPatterns = [
        /^(bạn|em|anh|chị) (là ai|tên gì|làm gì|ở đâu)/i,
        /^(ai|gì|sao|tại sao|như thế nào|thế nào)/i,
        /^(có thể|bạn có thể) (giúp|hỗ trợ|làm gì)/i
    ];

    // Task indicator patterns
    private taskIndicators = [
        // Time patterns
        /\b(\d{1,2}:\d{2}|\d{1,2}h\d{0,2}|sáng|chiều|tối|ngày mai|hôm nay|tuần sau)\b/i,
        // Action verbs
        /\b(gặp|họp|meeting|call|gọi|làm|thực hiện|hoàn thành|submit|nộp|deadline)\b/i,
        // Calendar words
        /\b(lịch|calendar|cuộc họp|appointment|sự kiện|event|task|nhiệm vụ)\b/i,
        // People/locations
        /\b(với|cùng|tại|ở|phòng|zoom|teams|google meet)\b/i
    ];

    // Non-task patterns
    private nonTaskPatterns = [
        // Pure greetings
        /^(chào|hi|hello)!*$/i,
        // Status questions
        /^(thế nào|như thế nào|sao|tình hình)/i,
        // Thanks/goodbye
        /^(cảm ơn|thanks|tạm biệt|bye|chào tạm biệt)$/i,
        // Weather/general chat
        /\b(thời tiết|weather|ăn gì|uống gì|mệt|vui|buồn)\b/i
    ];

    /**
     * Quick pre-filter to determine if message is likely a task
     */
    public preFilter(message: string): PreFilterResult {
        const normalizedMessage = message.trim().toLowerCase();

        // Empty or very short messages - likely not tasks
        if (normalizedMessage.length < 3) {
            return {
                isTaskLikely: false,
                confidence: 0.9,
                reason: 'Message too short',
                quickReply: 'Xin chào! Bạn cần tôi giúp gì? Hãy mô tả công việc hoặc lịch hẹn bạn muốn tạo.'
            };
        }

        // Check for pure greetings
        if (this.greetingPatterns.some(pattern => pattern.test(normalizedMessage))) {
            return {
                isTaskLikely: false,
                confidence: 0.85,
                reason: 'Pure greeting detected',
                quickReply: 'Xin chào! Tôi là trợ lý quản lý công việc. Bạn muốn tạo task hay lịch hẹn gì không?'
            };
        }

        // Check for non-task patterns
        if (this.nonTaskPatterns.some(pattern => pattern.test(normalizedMessage))) {
            return {
                isTaskLikely: false,
                confidence: 0.8,
                reason: 'Non-task pattern detected'
            };
        }

        // Check for question patterns (likely not tasks)
        if (this.questionPatterns.some(pattern => pattern.test(normalizedMessage))) {
            return {
                isTaskLikely: false,
                confidence: 0.75,
                reason: 'Question pattern detected (not task)',
                quickReply: 'Tôi là trợ lý giúp bạn quản lý công việc và lịch hẹn. Hãy cho tôi biết task cần tạo nhé!'
            };
        }

        // Count task indicators
        const taskIndicatorCount = this.taskIndicators.reduce((count, pattern) => {
            return count + (pattern.test(normalizedMessage) ? 1 : 0);
        }, 0);

        // Strong task indicators
        if (taskIndicatorCount >= 2) {
            return {
                isTaskLikely: true,
                confidence: 0.9,
                reason: `Multiple task indicators found (${taskIndicatorCount})`
            };
        }

        // Some task indicators
        if (taskIndicatorCount >= 1) {
            return {
                isTaskLikely: true,
                confidence: 0.7,
                reason: `Task indicators found (${taskIndicatorCount})`
            };
        }

        // Check message length and complexity
        if (normalizedMessage.length > 20 && normalizedMessage.split(' ').length > 3) {
            return {
                isTaskLikely: true,
                confidence: 0.6,
                reason: 'Complex message - might contain task'
            };
        }

        // Default to uncertain
        return {
            isTaskLikely: false,
            confidence: 0.5,
            reason: 'Unclear intent - requires LLM analysis'
        };
    }

    /**
     * Enhanced pre-filter with context awareness
     */
    public preFilterWithContext(message: string, conversationHistory?: string[]): PreFilterResult {
        const basicResult = this.preFilter(message);

        // If we have conversation history, use it for better context
        if (conversationHistory && conversationHistory.length > 0) {
            const lastMessage = conversationHistory[conversationHistory.length - 1];

            // If last message was asking for task details, current message is likely task-related
            if (lastMessage && this.isTaskDetailRequest(lastMessage)) {
                return {
                    ...basicResult,
                    isTaskLikely: true,
                    confidence: Math.max(basicResult.confidence, 0.8),
                    reason: 'Following task detail request'
                };
            }
        }

        return basicResult;
    }

    /**
     * Check if message is requesting task details
     */
    private isTaskDetailRequest(message: string): boolean {
        const taskDetailPatterns = [
            /\b(thời gian|time|khi nào|lúc nào)\b/i,
            /\b(ai|who|với ai|cùng ai)\b/i,
            /\b(ở đâu|where|tại đâu|địa điểm)\b/i,
            /\b(mô tả|chi tiết|details|description)\b/i
        ];

        return taskDetailPatterns.some(pattern => pattern.test(message));
    }

    /**
     * Get statistics for monitoring
     */
    public getFilterStats(): any {
        return {
            greetingPatterns: this.greetingPatterns.length,
            questionPatterns: this.questionPatterns.length,
            taskIndicators: this.taskIndicators.length,
            nonTaskPatterns: this.nonTaskPatterns.length
        };
    }
}

export default new MessagePreFilter();