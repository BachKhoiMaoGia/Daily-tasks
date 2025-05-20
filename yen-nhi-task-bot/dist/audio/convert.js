/**
 * convert.ts
 * Convert audio buffer (m4a/opus) to wav 16kHz mono using ffmpeg.
 * @module audio/convert
 */
import { spawn } from 'child_process';
import { config } from 'dotenv';
config();
const FFMPEG_PATH = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
/**
 * Convert input audio buffer to wav 16kHz mono using ffmpeg.
 * @param inputBuf - Input audio buffer
 * @returns Promise<Buffer> - wav buffer
 */
export async function convertToWav(inputBuf) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(FFMPEG_PATH, [
            '-i',
            'pipe:0',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-f',
            'wav',
            'pipe:1',
        ]);
        const chunks = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => { }); // suppress
        ffmpeg.on('error', reject);
        ffmpeg.on('close', (code) => {
            if (code === 0)
                resolve(Buffer.concat(chunks));
            else
                reject(new Error('ffmpeg failed'));
        });
        ffmpeg.stdin.write(inputBuf);
        ffmpeg.stdin.end();
    });
}
