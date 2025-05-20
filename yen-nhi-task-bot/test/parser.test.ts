import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/parser';

describe('parseCommand', () => {
  it('should parse /new command', () => {
    const result = parseCommand('/new test task @2025-05-21 @15:00');
    expect(result.cmd).toBe('new');
    expect(result.args).toContain('test task');
  });

  it('should fallback to new for natural language', () => {
    const result = parseCommand('Chiều mai họp nhóm');
    expect(result.cmd).toBe('new');
  });
});
