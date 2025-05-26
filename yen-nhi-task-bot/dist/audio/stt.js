"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribe = transcribe;
/**
 * stt.ts
 * Speech-to-text using OpenAI Whisper API (default) or Google STT.
 * Enhanced with retry logic and multiple fallbacks.
 * @module audio/stt
 */
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = require("dotenv");
const logger_js_1 = __importDefault(require("../utils/logger.js"));
(0, dotenv_1.config)();
/**
 * Transcribe audio buffer to text with retry logic and fallbacks.
 * @param buf - wav buffer
 * @param lang - language code (default 'vi')
 * @returns Promise<string> - transcribed text
 */
async function transcribe(buf, lang = 'vi') {
    // Read environment variables at runtime, not import time
    const STT_PROVIDER = process.env.STT_PROVIDER || 'whisper';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
    const HUGGINGFACE_WHISPER_MODEL = process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v3';
    logger_js_1.default.info(`[STT] Attempting transcription with provider: ${STT_PROVIDER}`);
    if (STT_PROVIDER === 'whisper') {
        // Try Hugging Face first if API key is available
        if (HUGGINGFACE_API_KEY) {
            try {
                const result = await transcribeWithHuggingFace(buf, HUGGINGFACE_API_KEY, HUGGINGFACE_WHISPER_MODEL);
                logger_js_1.default.info('[STT] ✅ Hugging Face Whisper successful');
                return result;
            }
            catch (error) {
                logger_js_1.default.error('[STT] ❌ Hugging Face Whisper failed:', error);
                // If we also have OpenAI key, try as fallback
                if (OPENAI_API_KEY) {
                    logger_js_1.default.info('[STT] 🔄 Falling back to OpenAI Whisper...');
                    try {
                        const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, lang);
                        logger_js_1.default.info('[STT] ✅ OpenAI Whisper fallback successful');
                        return result;
                    }
                    catch (fallbackError) {
                        logger_js_1.default.error('[STT] ❌ OpenAI Whisper fallback also failed:', fallbackError);
                        throw new Error(`Both Hugging Face and OpenAI Whisper failed. Last error: ${fallbackError.message}`);
                    }
                }
                else {
                    throw new Error(`Hugging Face Whisper failed: ${error.message}`);
                }
            }
        }
        else if (OPENAI_API_KEY) {
            // Only OpenAI available
            try {
                const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, lang);
                logger_js_1.default.info('[STT] ✅ OpenAI Whisper successful');
                return result;
            }
            catch (error) {
                logger_js_1.default.error('[STT] ❌ OpenAI Whisper failed:', error);
                throw new Error(`OpenAI Whisper failed: ${error.message}`);
            }
        }
        else {
            throw new Error('No STT API key provided (neither HUGGINGFACE_API_KEY nor OPENAI_API_KEY)');
        }
    }
    else if (STT_PROVIDER === 'google') {
        // Google STT implementation placeholder
        throw new Error('Google STT not implemented');
    }
    throw new Error('Unknown STT_PROVIDER');
}
/**
 * Transcribe using Hugging Face Whisper API with retry logic
 */
async function transcribeWithHuggingFace(buf, apiKey, model, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger_js_1.default.info(`[STT] Hugging Face attempt ${attempt}/${retries}`);
            const res = await (0, node_fetch_1.default)(`https://api-inference.huggingface.co/models/${model}`, {
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
                logger_js_1.default.error(`[STT] Hugging Face API error ${res.status}: ${errorText}`);
                if (res.status === 503 && attempt < retries) {
                    // Service unavailable, wait and retry
                    const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
                    logger_js_1.default.info(`[STT] Service unavailable, waiting ${waitTime}ms before retry...`);
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
        }
        catch (error) {
            logger_js_1.default.error(`[STT] Hugging Face attempt ${attempt} failed:`, error);
            if (attempt === retries) {
                throw error;
            }
            // Wait before retry (except for the last attempt)
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
            logger_js_1.default.info(`[STT] Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    throw new Error('All Hugging Face retry attempts failed');
}
/**
 * Transcribe using OpenAI Whisper API
 */
async function transcribeWithOpenAI(buf, apiKey, lang) {
    try {
        const form = new FormData();
        form.append('file', new Blob([buf]), 'audio.wav');
        form.append('model', 'whisper-1');
        form.append('language', lang);
        const res = await (0, node_fetch_1.default)('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
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
    }
    catch (error) {
        logger_js_1.default.error('[STT] OpenAI Whisper error:', error);
        throw error;
    }
}
