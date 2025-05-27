/**
 * config/index.ts
 * Centralized config loader using dotenv.
 */
import * as dotenv from 'dotenv';
dotenv.config();

// Debug environment variables on startup
console.log('[CONFIG] Environment Variables Debug:', {
    NODE_ENV: process.env.NODE_ENV,
    hasZALO_CREDENTIALS_BASE64: !!process.env.ZALO_CREDENTIALS_BASE64,
    ZALO_CREDENTIALS_BASE64_length: process.env.ZALO_CREDENTIALS_BASE64?.length || 0,
    hasZALO_SESSION_BASE64: !!process.env.ZALO_SESSION_BASE64,
    ZALO_SESSION_BASE64_length: process.env.ZALO_SESSION_BASE64?.length || 0,
    hasOPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    totalEnvVars: Object.keys(process.env).length,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL,
    port: process.env.PORT
});

export const config = {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiModelId: process.env.OPENAI_MODEL_ID || 'gpt-3.5-turbo',
    sttProvider: process.env.STT_PROVIDER || 'whisper',
    ffmpegPath: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
    audioTmp: process.env.AUDIO_TMP || './tmp',
    maxAudioMin: Number(process.env.MAX_AUDIO_MIN || 10),
    zaloCookiePath: process.env.ZALO_COOKIE_PATH || '.cookies.credentials.json',
    zaloCredentialsBase64: process.env.ZALO_CREDENTIALS_BASE64,
    zaloSessionBase64: process.env.ZALO_SESSION_BASE64,
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY,
    huggingfaceWhisperModel: process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v3',
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    },
    bossZaloId: process.env.BOSS_ZALO_ID,
    port: Number(process.env.PORT || 3000),
    logLevel: process.env.LOG_LEVEL || 'info',
    useLLM: process.env.USE_LLM === 'true',
};
