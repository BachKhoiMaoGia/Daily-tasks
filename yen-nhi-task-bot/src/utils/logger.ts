/**
 * utils/logger.ts
 * Pino logger instance.
 */
import pino from 'pino';
import { config } from '../config/index.js';

const logger = pino({ level: config.logLevel });
export default logger;
