"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
/**
 * config/index.ts
 * Centralized config loader using dotenv.
 */
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    openaiApiKey: process.env.OPENAI_API_KEY,
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
