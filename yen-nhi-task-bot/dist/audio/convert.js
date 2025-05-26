"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToWav = convertToWav;
/**
 * convert.ts
 * Convert audio buffer (m4a/opus) to wav 16kHz mono using ffmpeg.
 * @module audio/convert
 */
const child_process_1 = require("child_process");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
/**
 * Convert input audio buffer to wav 16kHz mono using ffmpeg.
 * @param inputBuf - Input audio buffer
 * @returns Promise<Buffer> - wav buffer
 */
async function convertToWav(inputBuf) {
    return new Promise((resolve, reject) => {
        const ffmpeg = (0, child_process_1.spawn)(FFMPEG_PATH, [
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
