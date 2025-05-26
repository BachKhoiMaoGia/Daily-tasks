/**
 * stt.ts
 * Speech-to-text using OpenAI Whisper API (default) or Google STT.
 * Enhanced with retry logic and multiple fallbacks.
 * @module audio/stt
 */
import fetch from 'node-fetch';
import { config } from 'dotenv';
import logger from '../utils/logger.js';

config();

/**
 * Transcribe audio buffer to text with retry logic and fallbacks.
 * @param buf - wav buffer
 * @param lang - language code (default 'vi')
 * @returns Promise<string> - transcribed text
 */
export async function transcribe(buf: Buffer, lang = 'vi'): Promise<string> {
    // Read environment variables at runtime, not import time
    const STT_PROVIDER = process.env.STT_PROVIDER || 'whisper';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
    const HUGGINGFACE_WHISPER_MODEL = process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v3';

    logger.info(`[STT] Attempting transcription with provider: ${STT_PROVIDER}`);

    if (STT_PROVIDER === 'whisper') {
        // Try Hugging Face first if API key is available
        if (HUGGINGFACE_API_KEY) {
            try {
                const result = await transcribeWithHuggingFace(buf, HUGGINGFACE_API_KEY, HUGGINGFACE_WHISPER_MODEL);
                logger.info('[STT] ✅ Hugging Face Whisper successful');
                return result;
            } catch (error) {
                logger.error('[STT] ❌ Hugging Face Whisper failed:', error);

                // If we also have OpenAI key, try as fallback
                if (OPENAI_API_KEY) {
                    logger.info('[STT] 🔄 Falling back to OpenAI Whisper...');
                    try {
                        const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, lang);
                        logger.info('[STT] ✅ OpenAI Whisper fallback successful');
                        return result;
                    } catch (fallbackError) {
                        logger.error('[STT] ❌ OpenAI Whisper fallback also failed:', fallbackError);
                        throw new Error(`Both Hugging Face and OpenAI Whisper failed. Last error: ${(fallbackError as Error).message}`);
                    }
                } else {
                    throw new Error(`Hugging Face Whisper failed: ${(error as Error).message}`);
                }
            }
        } else if (OPENAI_API_KEY) {
            // Only OpenAI available
            try {
                const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, lang);
                logger.info('[STT] ✅ OpenAI Whisper successful');
                return result;
            } catch (error) {
                logger.error('[STT] ❌ OpenAI Whisper failed:', error);
                throw new Error(`OpenAI Whisper failed: ${(error as Error).message}`);
            }
        } else {
            throw new Error('No STT API key provided (neither HUGGINGFACE_API_KEY nor OPENAI_API_KEY)');
        }
    } else if (STT_PROVIDER === 'google') {
        // Google STT implementation placeholder
        throw new Error('Google STT not implemented');
    }

    throw new Error('Unknown STT_PROVIDER');
}

/**
 * Transcribe using Hugging Face Whisper API with retry logic
 */
async function transcribeWithHuggingFace(buf: Buffer, apiKey: string, model: string, retries = 3): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`[STT] Hugging Face attempt ${attempt}/${retries}`);

            const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'audio/wav',
                },
                body: buf,
                timeout: 30000, // 30 second timeout
            });

            if (!res.ok) {
                const errorText = await res.text();
                logger.error(`[STT] Hugging Face API error ${res.status}: ${errorText}`);

                if (res.status === 503 && attempt < retries) {
                    // Service unavailable, wait and retry
                    const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
                    logger.info(`[STT] Service unavailable, waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                throw new Error(`Hugging Face API failed with status ${res.status}: ${errorText}`);
            }

            const data = await res.json();

            if (data.text && typeof data.text === 'string' && data.text.trim()) {
                return data.text.trim();
            }

            if (data.error) {
                throw new Error(`Hugging Face API error: ${data.error}`);
            }

            throw new Error('No text returned from Hugging Face Whisper');

        } catch (error) {
            logger.error(`[STT] Hugging Face attempt ${attempt} failed:`, error);

            if (attempt === retries) {
                throw error;
            }

            // Wait before retry (except for the last attempt)
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
            logger.info(`[STT] Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw new Error('All Hugging Face retry attempts failed');
}

/**
 * Transcribe using OpenAI Whisper API
 */
async function transcribeWithOpenAI(buf: Buffer, apiKey: string, lang: string): Promise<string> {
    try {
        const form = new FormData();
        form.append('file', new Blob([buf]), 'audio.wav');
        form.append('model', 'whisper-1');
        form.append('language', lang);

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form as any,
            timeout: 30000, // 30 second timeout
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`OpenAI API failed with status ${res.status}: ${errorText}`);
        }

        const data = await res.json();

        if (data.text && typeof data.text === 'string' && data.text.trim()) {
            return data.text.trim();
        }

        throw new Error('No text returned from OpenAI Whisper');

    } catch (error) {
        logger.error('[STT] OpenAI Whisper error:', error);
        throw error;
    }
}
