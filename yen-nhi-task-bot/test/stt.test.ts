import { describe, it, expect } from 'vitest';
import { transcribe } from '../src/audio/stt';

describe('transcribe', () => {
  it('should throw if missing OPENAI_API_KEY', async () => {
    process.env.STT_PROVIDER = 'whisper';
    process.env.OPENAI_API_KEY = '';
    await expect(transcribe(Buffer.from('test'))).rejects.toThrow('OPENAI_API_KEY missing');
  });
});
