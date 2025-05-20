/**
 * parser/index.ts
 * Parse plainText (from STT or text) to command object.
 */
import { config } from '../config/index.js';

const CMD_REGEX = /^\/(new|list|done|delete|help)(?:\s+(.+))?/i;

export function parseCommand(text: string) {
  const match = text.match(CMD_REGEX);
  if (match) {
    const [, cmd, args] = match;
    return { cmd: cmd.toLowerCase(), args: args || '' };
  }
  // Fallback: LLM or regex for natural language
  if (config.useLLM) {
    // ...call OpenAI GPT-4o for parsing...
    return { cmd: 'new', args: text };
  }
  // Simple regex for Vietnamese date/time
  // ...implement basic date/time extraction...
  return { cmd: 'new', args: text };
}
