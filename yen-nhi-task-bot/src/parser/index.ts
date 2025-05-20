/**
 * parser/index.ts
 * Parse plainText (from STT or text) to command object.
 */

const LIST_CMD = /^\/list$/i;
const STATS_CMD = /^\/stats$/i;
const CMD_REGEX = /^\/(new|list|done|delete|help|stats)(?:\s+(.+))?/i;

export function parseCommand(text: string) {
  if (LIST_CMD.test(text)) return { cmd: 'list', args: '' };
  if (STATS_CMD.test(text)) return { cmd: 'stats', args: '' };
  const match = text.match(CMD_REGEX);
  if (match) {
    const [, cmd, args] = match;
    return { cmd: cmd.toLowerCase(), args: args || '' };
  }
  // Regex nhận diện lệnh tự nhiên đơn giản
  if (/thống kê|bao nhiêu|hoàn thành|chưa xong/i.test(text)) return { cmd: 'stats', args: '' };
  if (/danh sách|task|công việc/i.test(text)) return { cmd: 'list', args: '' };
  // Fallback: tạo task mới
  return { cmd: 'new', args: text };
}
