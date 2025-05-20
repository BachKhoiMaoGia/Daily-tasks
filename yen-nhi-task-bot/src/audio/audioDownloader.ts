/**
 * audioDownloader.ts
 * Download audio file from Zalo (given token/url) and return as Buffer.
 * @module audio/audioDownloader
 */
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'dotenv';

config();

const AUDIO_TMP = process.env.AUDIO_TMP || './tmp';

/**
 * Download audio file from Zalo and return as Buffer.
 * @param url - Zalo audio file URL
 * @param token - Auth token/cookie if needed
 * @returns Buffer of audio file
 */
export async function downloadAudio(url: string, token?: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: token ? { Cookie: token } : {},
  });
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Optionally save to tmp for ffmpeg
  await fs.mkdir(AUDIO_TMP, { recursive: true });
  const tmpPath = path.join(AUDIO_TMP, `${uuidv4()}.audio`);
  await fs.writeFile(tmpPath, buf);
  return buf;
}
