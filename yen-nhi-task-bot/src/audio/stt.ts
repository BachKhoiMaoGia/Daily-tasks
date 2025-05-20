/**
 * stt.ts
 * Speech-to-text using OpenAI Whisper API (default) or Google STT.
 * @module audio/stt
 */
import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

const STT_PROVIDER = process.env.STT_PROVIDER || 'whisper';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Transcribe audio buffer to text.
 * @param buf - wav buffer
 * @param lang - language code (default 'vi')
 * @returns Promise<string> - transcribed text
 */
export async function transcribe(buf: Buffer, lang = 'vi'): Promise<string> {
  if (STT_PROVIDER === 'whisper') {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
    const form = new FormData();
    form.append('file', new Blob([buf]), 'audio.wav');
    form.append('model', 'whisper-1');
    form.append('language', lang);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form as any,
    });
    if (!res.ok) throw new Error('Whisper API failed');
    const data = await res.json();
    return data.text;
  } else if (STT_PROVIDER === 'google') {
    // Google STT implementation placeholder
    throw new Error('Google STT not implemented');
  }
  throw new Error('Unknown STT_PROVIDER');
}
