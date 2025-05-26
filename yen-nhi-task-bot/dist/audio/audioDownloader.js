"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadAudio = downloadAudio;
/**
 * audioDownloader.ts
 * Download audio file from Zalo (given token/url) and return as Buffer.
 * @module audio/audioDownloader
 */
const node_fetch_1 = __importDefault(require("node-fetch"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const AUDIO_TMP = process.env.AUDIO_TMP || './tmp';
/**
 * Download audio file from Zalo and return as Buffer.
 * @param url - Zalo audio file URL
 * @param token - Auth token/cookie if needed
 * @returns Buffer of audio file
 */
async function downloadAudio(url, token) {
    const res = await (0, node_fetch_1.default)(url, {
        headers: token ? { Cookie: token } : {},
    });
    if (!res.ok)
        throw new Error(`Failed to download audio: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Optionally save to tmp for ffmpeg
    await promises_1.default.mkdir(AUDIO_TMP, { recursive: true });
    const tmpPath = path_1.default.join(AUDIO_TMP, `${(0, uuid_1.v4)()}.audio`);
    await promises_1.default.writeFile(tmpPath, buf);
    return buf;
}
