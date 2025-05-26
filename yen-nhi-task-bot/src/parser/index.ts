/**
 * parser/index.ts
 * Parse plainText (from STT or text) to command object.
 */
import logger from '../utils/logger.js';

const LIST_CMD = /^\/list$/i;
const STATS_CMD = /^\/stats$/i;
// Enhanced command regex to support Vietnamese commands
const CMD_REGEX = /^\/(new|tạo|list|done|delete|help|stats|xong|xóa|hoàn|hoàn\s*thành|hoành\s*thành)(?:\s+(.+))?/i;

export function parseCommand(text: string) {
    // Safety check for non-string input
    if (typeof text !== 'string') {
        logger.warn('parseCommand received non-string input:', text);
        return { cmd: 'unknown', args: '' };
    }

    text = text.trim();

    if (LIST_CMD.test(text)) return { cmd: 'list', args: '' };
    if (STATS_CMD.test(text)) return { cmd: 'stats', args: '' };

    // Check for Vietnamese done commands
    if (/^\/(?:xong|hoàn|hoàn\s*thành|hoành\s*thành|done)(?:\s+(.+))?/i.test(text)) {
        const match = text.match(/^\/(?:xong|hoàn|hoàn\s*thành|hoành\s*thành|done)(?:\s+(.+))?/i);
        return { cmd: 'done', args: match?.[1] || '' };
    }

    // Check for Vietnamese delete commands - ONLY for numbers
    if (/^\/(?:xóa|xoa|delete)\s+(\d+)$/i.test(text)) {
        const match = text.match(/^\/(?:xóa|xoa|delete)\s+(\d+)$/i);
        return { cmd: 'delete', args: match?.[1] || '' };
    }

    const match = text.match(CMD_REGEX);
    if (match) {
        const [, cmd, args] = match;
        let normalizedCmd = cmd.toLowerCase();        // Normalize Vietnamese commands to English
        if (['xong', 'hoàn', 'hoành'].includes(normalizedCmd)) {
            normalizedCmd = 'done';
        }
        if (['xóa', 'xoa'].includes(normalizedCmd)) {
            normalizedCmd = 'delete';
        }
        if (['tạo'].includes(normalizedCmd)) {
            normalizedCmd = 'new';
        }
        return { cmd: normalizedCmd, args: args || '' };
    }

    // Regex nhận diện lệnh tự nhiên đơn giản - CHỈ cho câu lệnh đơn giản
    if (/^(thống kê|bao nhiêu|hoàn thành|chưa xong)$/i.test(text)) return { cmd: 'stats', args: '' };
    if (/^(danh sách|xem task|liệt kê)$/i.test(text)) return { cmd: 'list', args: '' };    // NO MORE FALLBACK - Return unknown instead of auto-creating tasks
    logger.info(`[Parser] Unknown command: "${text}"`);
    return { cmd: 'unknown', args: text };
}

export default { parseCommand };
