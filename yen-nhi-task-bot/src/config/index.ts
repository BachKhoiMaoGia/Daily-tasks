/**
 * config/index.ts
 * Centralized config loader using dotenv.
 */
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  sttProvider: process.env.STT_PROVIDER || 'whisper',
  ffmpegPath: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
  audioTmp: process.env.AUDIO_TMP || './tmp',
  maxAudioMin: Number(process.env.MAX_AUDIO_MIN || 10),
  zaloCookiePath: process.env.ZALO_COOKIE_PATH || '.cookies.json',
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
