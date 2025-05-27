import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('transcribe', () => {
    beforeEach(() => {
        // Reset all mocks and modules
        vi.resetAllMocks();
        vi.resetModules();
    });    it('should throw if missing Hugging Face API key', async () => {
        // Mock process.env to have no Hugging Face API key
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                HUGGINGFACE_API_KEY: undefined
            }
        });

        // Import after mocking env vars
        const { transcribe } = await import('../src/audio/stt');
        await expect(transcribe(Buffer.from('test'))).rejects.toThrow('Invalid or missing HUGGINGFACE_API_KEY');
    });    it('should throw if invalid Hugging Face API key', async () => {
        // Mock process.env with invalid HF key
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                HUGGINGFACE_API_KEY: 'invalid'
            }
        });

        // Import after mocking env vars
        const { transcribe } = await import('../src/audio/stt');
        await expect(transcribe(Buffer.from('test'))).rejects.toThrow('Invalid or missing HUGGINGFACE_API_KEY');
    });
});
