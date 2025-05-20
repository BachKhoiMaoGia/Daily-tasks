import { describe, it, expect, vi } from 'vitest';
import { convertToWav } from '../src/audio/convert';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: () => {
    const events = {};
    return {
      stdout: { on: (e, cb) => { if (e === 'data') cb(Buffer.from('wavdata')); } },
      stderr: { on: () => {} },
      stdin: { write: () => {}, end: () => {} },
      on: (e, cb) => { if (e === 'close') cb(0); },
    };
  },
}));

describe('convertToWav', () => {
  it('should convert buffer to wav buffer', async () => {
    const input = Buffer.from('test');
    const output = await convertToWav(input);
    expect(output.toString()).toBe('wavdata');
  });
});
