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
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HUGGINGFACE_WHISPER_MODEL = process.env.HUGGINGFACE_WHISPER_MODEL || 'openai/whisper-large-v2';

/**
 * Transcribe audio buffer to text.
 * @param buf - wav buffer
 * @param lang - language code (default 'vi')
 * @returns Promise<string> - transcribed text
 */
export async function transcribe(buf: Buffer, lang = 'vi'): Promise<string> {
  if (STT_PROVIDER === 'whisper') {
    if (HUGGINGFACE_API_KEY) {
      // Hugging Face Whisper API
      const res = await fetch(`https://api-inference.huggingface.co/models/${HUGGINGFACE_WHISPER_MODEL}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
            'Content-Type': 'audio/wav',
          },
          body: buf,
        });
      if (!res.ok) throw new Error('Hugging Face Whisper API failed');
      const data = await res.json();
      if (data.text) return data.text;
      throw new Error('No text returned from Hugging Face Whisper');
    } else if (OPENAI_API_KEY) {
      // OpenAI Whisper API
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
    } else {
      throw new Error('No STT API key provided');
    }
  } else if (STT_PROVIDER === 'google') {
    // Google STT implementation placeholder
    throw new Error('Google STT not implemented');
  }
  throw new Error('Unknown STT_PROVIDER');
}
