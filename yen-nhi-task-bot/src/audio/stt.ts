/**
 * stt.ts
 * Speech-to-text using Hugging Face Whisper API.
 * Enhanced with retry logic and error handling.
 * @module audio/stt
 */
import fetch from 'node-fetch';
import { config } from 'dotenv';
import logger from '../utils/logger.js';

config();

/**
 * Transcribe audio buffer to text using Hugging Face Whisper API.
 * @param buf - wav buffer
 * @param lang - language code (default 'vi')
 * @returns Promise<string> - transcribed text
 */
export async function transcribe(buf: Buffer, lang = 'vi'): Promise<string> {
    // Read environment variables at runtime
    const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
    const HUGGINGFACE_WHISPER_MODEL = process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v3';

    logger.info(`[STT] Attempting transcription with Hugging Face Whisper`);

    // Check if we have a valid Hugging Face API key
    if (!HUGGINGFACE_API_KEY || !HUGGINGFACE_API_KEY.startsWith('hf_')) {
        throw new Error('Invalid or missing HUGGINGFACE_API_KEY. Please set a valid Hugging Face API key that starts with "hf_".');
    }

    logger.info(`[STT] Using Hugging Face API with model: ${HUGGINGFACE_WHISPER_MODEL}`);

    try {
        const result = await transcribeWithHuggingFace(buf, HUGGINGFACE_API_KEY, HUGGINGFACE_WHISPER_MODEL);
        logger.info('[STT] ✅ Hugging Face Whisper transcription successful');
        return result;
    } catch (error) {
        logger.error('[STT] ❌ Hugging Face Whisper transcription failed:', error);
        throw new Error(`Hugging Face Whisper transcription failed: ${(error as Error).message}`);
    }
}

/**
 * Transcribe using Hugging Face Inference API with retry logic
 */
async function transcribeWithHuggingFace(buf: Buffer, apiKey: string, model: string, retries = 3): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`[STT] Hugging Face Inference API attempt ${attempt}/${retries} using model: ${model}`);
            logger.info(`[STT] Audio buffer size: ${buf.length} bytes`);

            // Use the traditional Inference API endpoint with raw audio buffer
            const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                body: buf,
                timeout: 30000, // 30 second timeout
            });

            logger.info(`[STT] Hugging Face API response status: ${res.status}`); if (!res.ok) {
                const errorText = await res.text();
                logger.error(`[STT] Hugging Face API error ${res.status}: ${errorText}`);

                // Check for errors that should not be retried
                if (res.status === 401) {
                    // Authentication error - no point in retrying
                    logger.error(`[STT] Authentication failed - check Hugging Face API key`);
                    throw new Error(`Hugging Face Whisper API failed: ${errorText}`);
                } else if (res.status === 400) {
                    // Bad request - likely audio format issue, no point in retrying
                    logger.error(`[STT] Bad request - possible audio format issue`);
                    throw new Error(`Hugging Face Whisper API failed: ${errorText}`);
                } else if (res.status === 503 && attempt < retries) {
                    // Service unavailable, wait and retry
                    const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
                    logger.info(`[STT] Service unavailable, waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // For other errors, only throw on last attempt
                if (attempt === retries) {
                    throw new Error(`Hugging Face Whisper API failed: ${errorText}`);
                }

                // Wait before retry for other error types
                const waitTime = Math.pow(2, attempt) * 1000;
                logger.info(`[STT] Error ${res.status}, waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            const data = await res.json();
            logger.info(`[STT] Hugging Face API response data:`, data);

            if (data.text && typeof data.text === 'string' && data.text.trim()) {
                logger.info(`[STT] ✅ Transcription successful: "${data.text.trim()}"`);
                return data.text.trim();
            }

            if (data.error) {
                logger.error(`[STT] Hugging Face API returned error: ${data.error}`);
                throw new Error(`Hugging Face API error: ${data.error}`);
            }

            logger.warn(`[STT] No valid text returned from Hugging Face, response:`, data);
            throw new Error('No text returned from Hugging Face Whisper');
        } catch (error) {
            logger.error(`[STT] Hugging Face attempt ${attempt} failed:`, error);

            // Check if this is an authentication or bad request error that was thrown earlier
            if (error instanceof Error && error.message.includes('Hugging Face Whisper API failed:')) {
                // This is an API error that was already processed - don't retry
                logger.error(`[STT] API error detected, not retrying: ${error.message}`);
                throw error;
            }

            // Throw immediately on the last attempt
            if (attempt === retries) {
                throw error;
            }

            // For network errors or other exceptions, wait before retry
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
            logger.info(`[STT] Network error, waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw new Error('All Hugging Face retry attempts failed');
}


