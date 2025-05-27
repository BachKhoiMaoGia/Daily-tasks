/**
 * Enhanced parser with LLM integration for intelligent command detection
 * Phân biệt đâu là task command thực sự vs trò chuyện bình thường
 */
import logger from '../utils/logger';
import { config } from '../config/index';

// Simple regex patterns for obvious commands
const EXPLICIT_COMMANDS = /^\/(?:new|tạo|list|done|delete|xóa|help|stats|xong|hoàn|hoàn\s*thành|hoành\s*thành|me|edit|sửa|chỉnh\s*sửa)\b/i;
const SIMPLE_QUERIES = /^(thống kê|bao nhiêu|hoàn thành|chưa xong|danh sách|xem task|liệt kê)$/i;

// Keywords that indicate task creation intent
const TASK_INTENT_KEYWORDS = [
    'nhắc nhở', 'nhắc', 'thêm task', 'tạo task', 'task mới', 'việc cần làm',
    'cần làm', 'phải làm', 'lưu ý', 'ghi nhớ', 'deadline', 'hạn chót',
    'meeting', 'họp', 'cuộc họp', 'appointment', 'hẹn', 'lịch hẹn',
    'báo cáo', 'làm', 'hoàn thành', 'nộp', 'presentation', 'thuyết trình',
    'học', 'tập', 'ôn', 'luyện', 'thực hiện', 'chuẩn bị', 'setup',
    'cài đặt', 'kiểm tra', 'review', 'check', 'test', 'deploy',
    'buổi', 'lớp', 'khóa', 'course', 'class', 'training'
];

// Delete/done action keywords
const DELETE_KEYWORDS = [
    'xóa', 'delete', 'remove', 'hủy', 'cancel', 'bỏ', 'loại bỏ'
];

const DONE_KEYWORDS = [
    'xong', 'done', 'hoàn thành', 'finish', 'complete', 'đã làm', 'đã xong'
];

const EDIT_KEYWORDS = [
    'sửa', 'edit', 'chỉnh sửa', 'thay đổi', 'cập nhật', 'update', 'modify', 'change'
];

// Phrases that indicate NOT a task (casual conversation)
const NON_TASK_INDICATORS = [
    'chào', 'hello', 'hi', 'xin chào', 'như thế nào', 'thế nào', 'sao rồi',
    'có khỏe không', 'khỏe không', 'ăn cơm chưa', 'làm gì đó', 'đang làm gì',
    'ok', 'okay', 'được rồi', 'cảm ơn', 'thanks', 'thank you', 'bye', 'tạm biệt',
    'haha', 'hihi', 'lol', '😂', '😊', '👍', 'good', 'tốt', 'đúng rồi'
];

export interface EnhancedCommand {
    cmd: string;
    args: string;
    confidence: number; // 0-1, mức độ tin cậy là command thực sự
    reasoning: string; // Lý do phân loại
}

/**
 * Enhanced parser with "/" prefix logic and natural language support
 * - Messages with "/" are task-related commands
 * - Messages without "/" are analyzed for natural language task intent
 * - Special handling for delete/done actions without "/" prefix
 */
export function parseCommandEnhanced(text: string): EnhancedCommand | null {
    if (typeof text !== 'string') {
        logger.warn('parseCommandEnhanced received non-string input:', text);
        return null;
    }

    text = text.trim();

    // Quick exit for empty text
    if (!text) return null;

    // Check "/" prefix first
    const hasSlashPrefix = text.startsWith('/');

    if (hasSlashPrefix) {
        // Messages with "/" are ALWAYS task-related commands
        logger.info(`[Parser] Task command detected with "/" prefix: "${text}"`);
        return parseTaskCommand(text);
    } else {
        // Messages without "/" - check for natural language task intent
        logger.info(`[Parser] Analyzing natural language for task intent: "${text}"`);

        // Special check for delete/done actions without "/" prefix first
        const actionCommand = detectActionCommand(text);
        if (actionCommand) {
            return actionCommand;
        }

        return parseNaturalLanguage(text);
    }
}

/**
 * Parse task commands with "/" prefix
 * This function handles all task-related operations and can call LLM for classification
 */
function parseTaskCommand(text: string): EnhancedCommand {
    // 1. Direct command mapping first
    if (text.startsWith('/help')) return { cmd: 'help', args: '', confidence: 1.0, reasoning: 'Help command' };
    if (text.startsWith('/list')) return { cmd: 'list', args: '', confidence: 1.0, reasoning: 'List command' };
    if (text.startsWith('/stats')) return { cmd: 'stats', args: '', confidence: 1.0, reasoning: 'Stats command' };
    if (text.startsWith('/me')) return { cmd: 'me', args: '', confidence: 1.0, reasoning: 'Me command' };    // 2. Handle specific Vietnamese and English commands with proper argument extraction
    if (text.startsWith('/tạo ')) {
        return { cmd: 'new', args: text.substring(5).trim(), confidence: 1.0, reasoning: 'Explicit Vietnamese create command' };
    }
    if (text.startsWith('/new ')) {
        return { cmd: 'new', args: text.substring(5).trim(), confidence: 1.0, reasoning: 'Explicit new command' };
    }

    // Handle Vietnamese list commands (multi-word)
    if (text.startsWith('/danh sách')) {
        const afterCommand = text.substring(10).trim(); // "/danh sách".length = 10
        return { cmd: 'list', args: afterCommand, confidence: 1.0, reasoning: 'Vietnamese list command' };
    }    // Handle pending commands
    if (text.startsWith('/pending ')) {
        return { cmd: 'pending', args: text.substring(9).trim(), confidence: 1.0, reasoning: 'Explicit pending command' };
    }
    if (text.startsWith('/chờ ') || text.startsWith('/đang chờ ')) {
        const prefix = text.startsWith('/chờ ') ? '/chờ ' : '/đang chờ ';
        return { cmd: 'pending', args: text.substring(prefix.length).trim(), confidence: 1.0, reasoning: 'Vietnamese pending command' };
    }

    // Handle search commands
    if (text.startsWith('/search ')) {
        return { cmd: 'search', args: text.substring(8).trim(), confidence: 1.0, reasoning: 'Explicit search command' };
    }
    if (text.startsWith('/tìm ') || text.startsWith('/tìm kiếm ')) {
        const prefix = text.startsWith('/tìm kiếm ') ? '/tìm kiếm ' : '/tìm ';
        return { cmd: 'search', args: text.substring(prefix.length).trim(), confidence: 1.0, reasoning: 'Vietnamese search command' };
    }

    if (text.startsWith('/xong ') || text.startsWith('/hoàn ') || text.startsWith('/done ')) {
        const prefix = text.startsWith('/xong ') ? '/xong ' :
            text.startsWith('/hoàn ') ? '/hoàn ' : '/done ';
        return { cmd: 'done', args: text.substring(prefix.length).trim(), confidence: 1.0, reasoning: 'Explicit done command' };
    } if (text.startsWith('/xóa ') || text.startsWith('/delete ')) {
        const prefix = text.startsWith('/xóa ') ? '/xóa ' : '/delete ';
        return { cmd: 'delete', args: text.substring(prefix.length).trim(), confidence: 1.0, reasoning: 'Explicit delete command' };
    }
    if (text.startsWith('/sửa ') || text.startsWith('/edit ') || text.startsWith('/chỉnh sửa ')) {
        const prefix = text.startsWith('/chỉnh sửa ') ? '/chỉnh sửa ' :
            text.startsWith('/sửa ') ? '/sửa ' : '/edit ';
        return { cmd: 'edit', args: text.substring(prefix.length).trim(), confidence: 1.0, reasoning: 'Explicit edit command' };
    }

    // 3. Intelligent classification for complex commands
    // TODO: Add LLM integration here for better classification
    // For now, use regex-based classification

    // Check for task management patterns
    if (text.includes('pending') || text.includes('chờ') || text.includes('đang chờ')) {
        return { cmd: 'pending', args: text, confidence: 0.9, reasoning: 'Pending task pattern detected' };
    }

    if (text.includes('overdue') || text.includes('quá hạn') || text.includes('trễ hạn')) {
        return { cmd: 'overdue', args: text, confidence: 0.9, reasoning: 'Overdue task pattern detected' };
    }    // 4. Extract args for other commands that take them - handle Vietnamese characters properly
    const match = text.match(/^\/([^\s]+)(?:\s+(.+))?/);
    if (match) {
        const [, cmd, args] = match;
        const normalizedCmd = cmd.toLowerCase();        // Normalize Vietnamese commands to English
        if (normalizedCmd === 'tạo') {
            return { cmd: 'new', args: args || '', confidence: 1.0, reasoning: 'Vietnamese create command via regex' };
        }
        if (['xong', 'hoàn', 'hoành'].includes(normalizedCmd)) {
            return { cmd: 'done', args: args || '', confidence: 1.0, reasoning: 'Vietnamese done command via regex' };
        } if (['xóa', 'xoa'].includes(normalizedCmd)) {
            return { cmd: 'delete', args: args || '', confidence: 1.0, reasoning: 'Vietnamese delete command via regex' };
        }
        if (['sửa', 'edit', 'chỉnh'].includes(normalizedCmd)) {
            return { cmd: 'edit', args: args || '', confidence: 1.0, reasoning: 'Vietnamese edit command via regex' };
        }
        if (['danh', 'list'].includes(normalizedCmd)) {
            return { cmd: 'list', args: args || '', confidence: 1.0, reasoning: 'List command via regex' };
        } if (['chờ', 'pending', 'đang'].includes(normalizedCmd)) {
            return { cmd: 'pending', args: args || '', confidence: 1.0, reasoning: 'Pending command via regex' };
        }
        if (['thống', 'stats', 'thống_kê'].includes(normalizedCmd)) {
            return { cmd: 'stats', args: args || '', confidence: 1.0, reasoning: 'Stats command via regex' };
        }
        if (['tìm', 'search', 'tìm_kiếm'].includes(normalizedCmd)) {
            return { cmd: 'search', args: args || '', confidence: 1.0, reasoning: 'Search command via regex' };
        }

        return { cmd: normalizedCmd, args: args || '', confidence: 1.0, reasoning: 'Explicit command with / prefix' };
    }

    // 5. Default to new task creation for any "/" prefixed message
    return { cmd: 'new', args: text.substring(1).trim(), confidence: 0.8, reasoning: 'Default task creation from / prefix' };
}

function parseSimpleQuery(text: string): EnhancedCommand {
    if (/^(thống kê|bao nhiêu|hoàn thành|chưa xong)$/i.test(text)) {
        return {
            cmd: 'stats',
            args: '',
            confidence: 0.95,
            reasoning: 'Simple stats query'
        };
    }
    if (/^(danh sách|xem task|liệt kê)$/i.test(text)) {
        return {
            cmd: 'list',
            args: '',
            confidence: 0.95,
            reasoning: 'Simple list query'
        };
    }

    return {
        cmd: 'unknown',
        args: '',
        confidence: 0.0,
        reasoning: 'Unknown simple query'
    };
}

function isObviouslyNotTask(text: string): boolean {
    const textLower = text.toLowerCase();

    // Check for casual conversation indicators
    for (const indicator of NON_TASK_INDICATORS) {
        if (textLower.includes(indicator)) {
            return true;
        }
    }

    // Very short responses (1-3 characters) are usually not tasks
    if (text.length <= 3 && !/^\//.test(text)) {
        return true;
    }

    // Only emojis or punctuation
    if (/^[\s\p{Emoji}\p{P}]*$/u.test(text)) {
        return true;
    } return false;
}

/**
 * Detect action commands (delete, done) without "/" prefix
 * Examples: "delete hoc buoi chieu", "xong task 1", "hoàn thành báo cáo"
 */
function detectActionCommand(text: string): EnhancedCommand | null {
    const textLower = text.toLowerCase();

    // Check for delete patterns
    for (const keyword of DELETE_KEYWORDS) {
        if (textLower.startsWith(keyword.toLowerCase() + ' ')) {
            const args = text.substring(keyword.length).trim();
            return {
                cmd: 'delete',
                args: args,
                confidence: 0.9,
                reasoning: `Delete action detected with keyword: "${keyword}"`
            };
        }
    }    // Check for done patterns
    for (const keyword of DONE_KEYWORDS) {
        if (textLower.startsWith(keyword.toLowerCase() + ' ')) {
            const args = text.substring(keyword.length).trim();
            return {
                cmd: 'done',
                args: args,
                confidence: 0.9,
                reasoning: `Done action detected with keyword: "${keyword}"`
            };
        }
    }

    // Check for edit patterns
    for (const keyword of EDIT_KEYWORDS) {
        if (textLower.startsWith(keyword.toLowerCase() + ' ')) {
            const args = text.substring(keyword.length).trim();
            return {
                cmd: 'edit',
                args: args,
                confidence: 0.9,
                reasoning: `Edit action detected with keyword: "${keyword}"`
            };
        }
    }

    // Check for "xong" at the end of sentence (Vietnamese style)
    if (textLower.endsWith(' xong') || textLower.endsWith(' rồi')) {
        const keyword = textLower.endsWith(' xong') ? ' xong' : ' rồi';
        const args = text.substring(0, text.length - keyword.length).trim();
        return {
            cmd: 'done',
            args: args,
            confidence: 0.8,
            reasoning: `Done action detected with suffix: "${keyword}"`
        };
    }

    return null;
}

function detectTaskIntent(text: string): { isTask: boolean; confidence: number; reasoning: string } {
    const textLower = text.toLowerCase();

    // Check for explicit task keywords
    for (const keyword of TASK_INTENT_KEYWORDS) {
        if (textLower.includes(keyword)) {
            return {
                isTask: true,
                confidence: 0.8,
                reasoning: `Contains task keyword: "${keyword}"`
            };
        }
    }    // Check for time/date patterns (indicates scheduling)
    const timePatterns = [
        /\b\d{1,2}:\d{2}\b/, // HH:mm
        /\b\d{1,2}h\d{0,2}\b/, // 3h30, 15h
        /\b\d{1,2}\s*(giờ|h)\s*\d{0,2}\s*(phút)?\b/i, // 3 giờ 30 phút, 15h30
        /\b\d{1,2}\/\d{1,2}(\/\d{4})?\b/, // MM/DD or DD/MM/YYYY
        /\b\d{4}-\d{2}-\d{2}\b/, // YYYY-MM-DD
        /\b\d{1,2}-\d{1,2}(-\d{4})?\b/, // DD-MM-YYYY
        /\b(ngày|tháng|năm|giờ|phút|tuần|thứ)\s*\d+\b/i, // ngày 15, tháng 5, thứ 2
        /\b\d+\s*(ngày|tháng|năm|giờ|phút|tuần)\b/i, // 15 ngày, 5 tháng
        /\b(thứ\s*[2-8]|chủ\s*nhật|cn)\b/i, // thứ 2, thứ 3, chủ nhật
        /\b(hôm nay|ngày mai|kia|tuần sau|tuần tới|tháng sau|tháng tới|năm sau)\b/i, // Relative time
        /\b(sáng|chiều|tối|đêm)\b/i, // Time of day
        /\b(buổi\s*(sáng|chiều|tối))\b/i, // buổi sáng, buổi chiều
        /\b(lúc\s*\d{1,2})\b/i, // lúc 3, lúc 15
        /\b(\d{1,2}\s*(pm|am))\b/i, // 3pm, 2am
        /\b(deadline|hạn\s*chót|due)\b/i // Deadline keywords
    ];

    for (const pattern of timePatterns) {
        if (pattern.test(text)) {
            return {
                isTask: true,
                confidence: 0.7,
                reasoning: 'Contains time/date information'
            };
        }
    }    // Check for action verbs that suggest tasks
    const actionVerbs = [
        'làm', 'hoàn thành', 'gửi', 'gọi', 'kiểm tra', 'mua', 'đi', 'viết',
        'chuẩn bị', 'sửa', 'tạo', 'build', 'deploy', 'test', 'review',
        'học', 'ôn', 'tập', 'luyện', 'đọc', 'xem', 'nghe', 'thực hiện',
        'setup', 'cài đặt', 'config', 'configure', 'fix', 'debug',
        'submit', 'nộp', 'giao', 'trình bày', 'present', 'demo'
    ];

    for (const verb of actionVerbs) {
        if (textLower.includes(verb)) {
            return {
                isTask: true,
                confidence: 0.6,
                reasoning: `Contains action verb: "${verb}"`
            };
        }
    }

    return { isTask: false, confidence: 0, reasoning: 'No task indicators found' };
}

function analyzeStructure(text: string): { isLikelyTask: boolean; confidence: number; reasoning: string } {
    // Very short texts are usually not tasks
    if (text.length < 5) {
        return {
            isLikelyTask: false,
            confidence: 0.1,
            reasoning: 'Too short to be a task'
        };
    }

    // Very long texts might be conversations
    if (text.length > 200) {
        return {
            isLikelyTask: false,
            confidence: 0.2,
            reasoning: 'Too long, likely conversation'
        };
    }

    // Contains question words - likely not a task
    const questionWords = ['sao', 'gì', 'ai', 'đâu', 'khi nào', 'bao giờ', 'why', 'what', 'when', 'where', 'how', '?'];
    const textLower = text.toLowerCase();

    for (const word of questionWords) {
        if (textLower.includes(word)) {
            return {
                isLikelyTask: false,
                confidence: 0.3,
                reasoning: `Contains question word: "${word}"`
            };
        }
    }

    // Reasonable length, declarative sentence - could be a task
    if (text.length >= 10 && text.length <= 100) {
        return {
            isLikelyTask: true,
            confidence: 0.4,
            reasoning: 'Reasonable length declarative sentence'
        };
    }

    return {
        isLikelyTask: false,
        confidence: 0.1,
        reasoning: 'No strong structural indicators'
    };
}

/**
 * Parse natural language messages for task intent
 * Analyzes messages without "/" prefix to detect task creation requests
 */
function parseNaturalLanguage(text: string): EnhancedCommand | null {
    const lowerText = text.toLowerCase();

    // Check for obvious non-task indicators first
    const hasNonTaskIndicator = NON_TASK_INDICATORS.some(indicator =>
        lowerText.includes(indicator.toLowerCase())
    );

    if (hasNonTaskIndicator) {
        logger.info(`[Parser] Non-task conversation detected: "${text}"`);
        return null;
    }

    // Check for task creation intent keywords
    const hasTaskIntent = TASK_INTENT_KEYWORDS.some(keyword =>
        lowerText.includes(keyword.toLowerCase())
    );    // Check for reminder patterns
    const reminderPatterns = [
        /nhắc\s+(.+)/i,
        /reminder?\s*(.+)/i,
        /ghi nhớ\s*(.+)/i,
        /lưu ý\s*(.+)/i,
        /cần\s*(phải\s*)?làm\s*(.+)/i,
        /làm\s+(.+)/i,
        /deadline\s*(.+)/i,
        /meeting\s*(.+)/i,
        /họp\s*(.+)/i,
        /hẹn\s*(.+)/i,
        /báo cáo\s*(.+)/i,
        /nộp\s*(.+)/i,
        /học\s+(.+)/i,
        /ôn\s+(.+)/i,
        /tập\s+(.+)/i,
        /luyện\s+(.+)/i,
        /kiểm tra\s*(.+)/i,
        /chuẩn bị\s*(.+)/i,
        /setup\s*(.+)/i,
        /review\s*(.+)/i,
        /test\s*(.+)/i
    ];

    // Check for date/time patterns that suggest scheduling
    const hasDateTimePattern = /(\bngày mai\b|\bhôm nay\b|\bkia\b|\btuần\s*sau\b|\btuần\s*tới\b|\btháng\s*sau\b|\btháng\s*tới\b|\d+\s*(giờ|h)\b|\d+:\d+|\d+\s*(tháng|ngày)|\bthứ\s*[2-8]\b|\bchủ\s*nhật\b|\bcn\b|\blúc\s*\d+|\bbuổi\s*(sáng|chiều|tối)|\b\d+\s*(pm|am)\b)/i.test(text);

    // If has reminder pattern, extract task content
    for (const pattern of reminderPatterns) {
        const match = text.match(pattern);
        if (match) {
            const taskContent = match[1] || match[2] || text;
            return {
                cmd: 'new',
                args: taskContent.trim(),
                confidence: 0.9,
                reasoning: 'Natural language reminder pattern detected'
            };
        }
    }

    // If has task intent keywords or date/time patterns
    if (hasTaskIntent || hasDateTimePattern) {
        return {
            cmd: 'new',
            args: text,
            confidence: hasTaskIntent ? 0.8 : 0.7,
            reasoning: hasTaskIntent ? 'Task intent keywords detected' : 'Date/time pattern suggests task scheduling'
        };
    }

    // Check for simple queries
    if (/^(danh sách|list|xem task|liệt kê|thống kê|stats|bao nhiêu)$/i.test(text)) {
        const isStats = /^(thống kê|stats|bao nhiêu)$/i.test(text);
        return {
            cmd: isStats ? 'stats' : 'list',
            args: '',
            confidence: 0.95,
            reasoning: 'Simple query command in natural language'
        };
    }

    // Default: not a task command
    logger.info(`[Parser] No task intent detected in natural language: "${text}"`);
    return null;
}

/**
 * Fallback to legacy parser for backward compatibility
 * Note: Removed to avoid circular dependency issues
 */
// export function parseCommandLegacy(text: string) {
//     return import('./index.js').then(module => module.parseCommand(text));
// }