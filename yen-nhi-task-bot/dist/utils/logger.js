"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * utils/logger.ts
 * Pino logger instance.
 */
const pino_1 = __importDefault(require("pino"));
const index_js_1 = require("../config/index.js");
const logger = (0, pino_1.default)({ level: index_js_1.config.logLevel });
exports.default = logger;
