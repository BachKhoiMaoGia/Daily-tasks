import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('transcribe', () => {
    beforeEach(() => {
        // Reset all mocks and modules
        vi.resetAllMocks();
        vi.resetModules();
    });

    it('should throw if missing both API keys', async () => {
        // Mock process.env to have no API keys
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                STT_PROVIDER: 'whisper',
                OPENAI_API_KEY: undefined,
                HUGGINGFACE_API_KEY: undefined
            }
        });

        // Import after mocking env vars
        const { transcribe } = await import('../src/audio/stt');
        await expect(transcribe(Buffer.from('test'))).rejects.toThrow('No STT API key provided');
    }); it('should try Hugging Face first when HF key exists', async () => {
        // Mock process.env with HF key but no OpenAI key
        vi.stubGlobal('process', {
            ...process,
            env: {
                ...process.env,
                STT_PROVIDER: 'whisper',
                OPENAI_API_KEY: undefined,
                HUGGINGFACE_API_KEY: 'invalid'
            }
        });

        // Import after mocking env vars
        const { transcribe } = await import('../src/audio/stt');
        await expect(transcribe(Buffer.from('test'))).rejects.toThrow('Hugging Face Whisper API failed');
    });
});
