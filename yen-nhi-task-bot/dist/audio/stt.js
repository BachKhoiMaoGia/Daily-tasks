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
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
    const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
    const HUGGINGFACE_WHISPER_MODEL = process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v3';
    logger_js_1.default.info(`[STT] Attempting transcription with provider: ${STT_PROVIDER}`);
    if (STT_PROVIDER === 'whisper') {
        // Prioritize Hugging Face if API key is available
        if (HUGGINGFACE_API_KEY) {
            try {
                const result = await transcribeWithHuggingFace(buf, HUGGINGFACE_API_KEY, HUGGINGFACE_WHISPER_MODEL);
                logger_js_1.default.info('[STT] ✅ Hugging Face Whisper successful');
                return result;
            }
            catch (error) {
                logger_js_1.default.error('[STT] ❌ Hugging Face Whisper failed:', error);
                // Check if we have OpenAI key (GitHub token is valid for GitHub Models)
                if (OPENAI_API_KEY) {
                    logger_js_1.default.info('[STT] 🔄 Falling back to OpenAI/GitHub Models Whisper...');
                    try {
                        const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, OPENAI_BASE_URL, lang);
                        logger_js_1.default.info('[STT] ✅ OpenAI/GitHub Models Whisper fallback successful');
                        return result;
                    }
                    catch (fallbackError) {
                        logger_js_1.default.error('[STT] ❌ OpenAI/GitHub Models Whisper fallback also failed:', fallbackError);
                        throw new Error(`Both Hugging Face and OpenAI/GitHub Models Whisper failed. Last error: ${fallbackError.message}`);
                    }
                }
                else {
                    logger_js_1.default.warn('[STT] ⚠️ No OpenAI API key available for fallback');
                    throw new Error(`Hugging Face Whisper failed and no OpenAI fallback: ${error.message}`);
                }
            }
        }
        else if (OPENAI_API_KEY) {
            // Only OpenAI/GitHub Models available
            try {
                const result = await transcribeWithOpenAI(buf, OPENAI_API_KEY, OPENAI_BASE_URL, lang);
                logger_js_1.default.info('[STT] ✅ OpenAI/GitHub Models Whisper successful');
                return result;
            }
            catch (error) {
                logger_js_1.default.error('[STT] ❌ OpenAI/GitHub Models Whisper failed:', error);
                throw new Error(`OpenAI/GitHub Models Whisper failed: ${error.message}`);
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
            logger_js_1.default.info(`[STT] Hugging Face attempt ${attempt}/${retries} using model: ${model}`);
            logger_js_1.default.info(`[STT] Audio buffer size: ${buf.length} bytes`);
            const res = await (0, node_fetch_1.default)(`https://api-inference.huggingface.co/models/${model}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'audio/wav',
                },
                body: buf,
                timeout: 30000, // 30 second timeout
            });
            logger_js_1.default.info(`[STT] Hugging Face API response status: ${res.status}`);
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
                else if (res.status === 400) {
                    // Bad request - likely audio format issue
                    logger_js_1.default.error(`[STT] Bad request - possible audio format issue`);
                    throw new Error(`Hugging Face API bad request (${res.status}): ${errorText}`);
                }
                else if (res.status === 401) {
                    // Authentication error
                    logger_js_1.default.error(`[STT] Authentication failed - check Hugging Face API key`);
                    throw new Error(`Hugging Face API authentication failed: ${errorText}`);
                }
                throw new Error(`Hugging Face API failed with status ${res.status}: ${errorText}`);
            }
            const data = await res.json();
            logger_js_1.default.info(`[STT] Hugging Face API response data:`, data);
            if (data.text && typeof data.text === 'string' && data.text.trim()) {
                logger_js_1.default.info(`[STT] ✅ Transcription successful: "${data.text.trim()}"`);
                return data.text.trim();
            }
            if (data.error) {
                logger_js_1.default.error(`[STT] Hugging Face API returned error: ${data.error}`);
                throw new Error(`Hugging Face API error: ${data.error}`);
            }
            logger_js_1.default.warn(`[STT] No valid text returned from Hugging Face, response:`, data);
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
 * Transcribe using OpenAI Whisper API (or GitHub Models API)
 */
async function transcribeWithOpenAI(buf, apiKey, baseUrl, lang) {
    try {
        logger_js_1.default.info(`[STT] Using OpenAI API with base URL: ${baseUrl || 'https://api.openai.com'}`);
        const form = new FormData();
        form.append('file', new Blob([buf]), 'audio.wav');
        form.append('model', 'whisper-1');
        form.append('language', lang);
        // Use custom base URL if provided (for GitHub Models), otherwise default OpenAI
        const apiUrl = baseUrl
            ? `${baseUrl}/v1/audio/transcriptions`
            : 'https://api.openai.com/v1/audio/transcriptions';
        logger_js_1.default.info(`[STT] Making request to: ${apiUrl}`);
        const res = await (0, node_fetch_1.default)(apiUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            timeout: 30000, // 30 second timeout
        });
        if (!res.ok) {
            const errorText = await res.text();
            logger_js_1.default.error(`[STT] OpenAI/GitHub Models API error: ${res.status} - ${errorText}`);
            throw new Error(`OpenAI API failed with status ${res.status}: ${errorText}`);
        }
        const data = await res.json();
        logger_js_1.default.info(`[STT] OpenAI/GitHub Models response:`, data);
        if (data.text && typeof data.text === 'string' && data.text.trim()) {
            return data.text.trim();
        }
        throw new Error('No text returned from OpenAI/GitHub Models Whisper');
    }
    catch (error) {
        logger_js_1.default.error('[STT] OpenAI/GitHub Models Whisper error:', error);
        throw error;
    }
}
