"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * src/index.ts
 * Main entry: Zalo login, message listener, audio/text handling, scheduler, webhooks.
 */
const express_1 = __importDefault(require("express"));
const index_1 = require("./config/index");
const logger_1 = __importDefault(require("./utils/logger"));
const index_2 = require("./zalo/index");
const audioDownloader_1 = require("./audio/audioDownloader");
const convert_1 = require("./audio/convert");
const stt_1 = require("./audio/stt");
// import { parseCommand } from './parser/index';
const enhanced_1 = require("./parser/enhanced");
const index_3 = __importDefault(require("./webhooks/index"));
const index_4 = require("./scheduler/index");
const index_5 = __importDefault(require("./db/index"));
const index_6 = require("./gcal/index");
const manager_1 = require("./google/manager");
const selection_1 = __importDefault(require("./google/selection"));
const taskOperations_js_1 = require("./utils/taskOperations.js");
const conversation_js_1 = require("./utils/conversation.js");
const taskCreation_js_1 = require("./utils/taskCreation.js");
const reminderSystem_1 = __importDefault(require("./utils/reminderSystem"));
// Initialize Google Manager
let googleManager;
async function main() {
    try {
        googleManager = new manager_1.GoogleManager();
        logger_1.default.info('[Google] Google Manager initialized');
        // Initialize task creation module with the Google Manager instance
        (0, taskCreation_js_1.initializeTaskCreation)(googleManager);
        logger_1.default.info('[TaskCreation] Task creation module initialized');
        logger_1.default.info('[TaskOps] Task Operations functions imported');
    }
    catch (err) {
        logger_1.default.error('[Google] Failed to initialize Google Manager:', err);
    }
    logger_1.default.info('[Zalo] Bắt đầu đăng nhập Zalo...');
    try {
        const result = await (0, index_2.login)();
        if (result) {
            logger_1.default.info('[Zalo] ✅ Đăng nhập thành công! API instance available.');
        }
        else {
            logger_1.default.warn('[Zalo] ⚠️ Login function returned null/undefined');
        }
        logger_1.default.info('[Zalo] Đã gọi xong hàm login(). Nếu có QR, hãy kiểm tra terminal để quét.');
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ Lỗi khi đăng nhập:', err);
        logger_1.default.error('[Zalo] Error details:', {
            message: err.message,
            stack: err.stack?.split('\n').slice(0, 5).join('\n')
        });
        // Don't throw, keep server running
    }
    (0, index_2.onMessage)(async (msg) => {
        try {
            // Extract text and sender ID from message
            let plainText = '';
            const senderId = msg.uidFrom || msg.data?.uidFrom || msg.senderId;
            logger_1.default.info({ zaloMsg: msg }, '[Zalo] Nhận message');
            // ENHANCED MESSAGE FILTERING
            // 1. Check sender ID
            if (!senderId || senderId !== index_1.config.bossZaloId) {
                logger_1.default.info(`[Zalo] IGNORED - Message from non-Boss user: ${senderId} vs Boss: ${index_1.config.bossZaloId}`);
                return;
            }
            // 2. Check if it's a group message (should reject group messages)
            if (msg.data?.isGroup || msg.groupId || msg.data?.groupId) {
                logger_1.default.info(`[Zalo] IGNORED - Group message from Boss (groupId: ${msg.groupId || msg.data?.groupId})`);
                return;
            } // 3. Check message type validity - Accept text and voice messages
            const msgType = msg.data?.msgType || msg.type;
            if (msgType && !['chat.text', 'chat.voice', 'webchat'].includes(msgType)) {
                logger_1.default.info(`[Zalo] IGNORED - Unsupported message type: ${msgType}`);
                return;
            }
            logger_1.default.info(`[Zalo] ✅ PROCESSING - Valid private message from Boss: ${senderId}`);
            // Handle different message types
            if (msg.data?.msgType === 'chat.voice' || (msg.data?.content && typeof msg.data.content === 'object' && msg.data.content.href)) {
                // Voice message
                logger_1.default.info('[Zalo] Đây là tin nhắn audio');
                try {
                    const audioUrl = msg.data.content.href || msg.data.content.params?.m4a;
                    if (audioUrl) {
                        logger_1.default.info(`[Zalo] Audio URL: ${audioUrl}`);
                        const audioBuf = await (0, audioDownloader_1.downloadAudio)(audioUrl, msg.token || '');
                        const wavBuf = await (0, convert_1.convertToWav)(audioBuf);
                        plainText = await (0, stt_1.transcribe)(wavBuf, 'vi');
                        logger_1.default.info({ plainText }, '[Zalo] STT audio -> text');
                    }
                    else {
                        logger_1.default.warn('[Zalo] Không tìm thấy audio URL');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không thể xử lý tin nhắn audio này.');
                        return;
                    }
                }
                catch (audioError) {
                    logger_1.default.error('[Zalo] Lỗi xử lý audio:', {
                        error: audioError,
                        message: audioError.message,
                        stack: audioError.stack,
                        audioUrl: msg.data.content.href || msg.data.content.params?.m4a
                    });
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Lỗi khi xử lý tin nhắn audio: ${audioError.message}`);
                    return;
                }
            }
            else {
                // Text message
                plainText = msg.text || msg.data?.content || '';
                // CRITICAL FIX: Handle [object Object] bug
                if (typeof plainText === 'object') {
                    logger_1.default.warn('[Zalo] Received object as content, attempting to extract text:', plainText);
                    // Try to extract text from object
                    if (plainText && typeof plainText === 'object') {
                        const textObj = plainText;
                        plainText = textObj.text || textObj.message || textObj.content || JSON.stringify(plainText);
                    }
                }
                if (typeof plainText !== 'string') {
                    logger_1.default.warn('[Zalo] plainText không phải string:', plainText);
                    plainText = String(plainText);
                }
                // Additional safety check for [object Object] strings
                if (plainText === '[object Object]') {
                    logger_1.default.error('[Zalo] Detected [object Object] bug - skipping message');
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Lỗi: Không thể đọc được nội dung tin nhắn.');
                    return;
                }
            }
            logger_1.default.info(`[Zalo] Text: "${plainText}", From: ${senderId}`); // Check if this is a response to pending selection
            const handledSelection = await selection_1.default.handleSelectionResponse(senderId, plainText);
            if (handledSelection.handled) {
                logger_1.default.info('[Selection] Handled pending selection response');
                // If selection was completed and we have task context, continue with task creation
                if (handledSelection.continueTask) {
                    const taskInfo = handledSelection.continueTask;
                    // Continue with calendar/task list selection or create task
                    await (0, taskCreation_js_1.handleCalendarAndTaskListSelection)(taskInfo, senderId);
                }
                return;
            } // Check if this is a response to pending task info request
            const handledPending = await (0, taskCreation_js_1.handleMissingInfoResponse)(plainText, senderId);
            if (handledPending) {
                logger_1.default.info('[Task] Handled pending task info response');
                return;
            }
            // Check if this is a response to conflict decision request
            if (googleManager.hasPendingTask(senderId)) {
                const pendingTask = googleManager.getPendingTask(senderId);
                if (pendingTask && pendingTask.awaitingConflictDecision) {
                    logger_1.default.info('[Conflict] Handling conflict decision response');
                    const response = plainText.toLowerCase().trim();
                    if (response === 'có' || response === 'yes' || response === 'ok' || response === 'y') {
                        // User wants to proceed with original time despite conflicts
                        logger_1.default.info('[Conflict] User chose to proceed with original time');
                        // Remove conflict info and proceed with task creation
                        const taskInfoWithoutConflict = { ...pendingTask };
                        delete taskInfoWithoutConflict.conflictInfo;
                        delete taskInfoWithoutConflict.awaitingConflictDecision;
                        // Clear pending task first
                        googleManager.clearPendingTask(senderId);
                        // Continue with calendar/task list selection or create task
                        await (0, taskCreation_js_1.handleCalendarAndTaskListSelection)(taskInfoWithoutConflict, senderId);
                    }
                    else if (response === 'không' || response === 'no' || response === 'cancel' || response === 'n') {
                        // User wants to cancel task creation
                        logger_1.default.info('[Conflict] User chose to cancel due to conflicts');
                        googleManager.clearPendingTask(senderId);
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', '❌ Đã hủy bỏ việc tạo task do xung đột lịch trình.');
                    }
                    else {
                        // Invalid response, ask again
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Vui lòng phản hồi "có" để tạo task với thời gian gốc hoặc "không" để hủy bỏ.');
                    }
                    return; // Task handled
                }
            }
            // Check if user has active conversation for task creation
            if ((0, conversation_js_1.hasActiveConversation)(senderId)) {
                const conversationResult = await (0, conversation_js_1.handleConversationResponse)(senderId, plainText);
                if (conversationResult.handled) {
                    logger_1.default.info('[Conversation] Handled conversation response');
                    return;
                }
            }
            // ENHANCED PARSING: Use intelligent parser instead of fallback
            const enhancedCmd = (0, enhanced_1.parseCommandEnhanced)(plainText);
            if (!enhancedCmd) {
                // Not a command - check if it's a natural task request
                logger_1.default.info(`[Zalo] No command detected, checking for conversational task: "${plainText}"`);
                const handledConversation = await (0, conversation_js_1.startConversationalTask)(senderId, plainText);
                if (handledConversation) {
                    logger_1.default.info('[Conversation] Started conversational task creation');
                    return;
                }
                // Truly just casual conversation
                logger_1.default.info(`[Zalo] Casual conversation detected, not processing: "${plainText}"`);
                return;
            }
            // Log parsing results
            logger_1.default.info({
                cmd: enhancedCmd,
                confidence: enhancedCmd.confidence,
                reasoning: enhancedCmd.reasoning
            }, '[Zalo] Enhanced parsed command');
            // Use enhanced command
            const cmd = { cmd: enhancedCmd.cmd, args: enhancedCmd.args };
            logger_1.default.info({ cmd }, '[Zalo] Parsed command');
            if (cmd.cmd === 'list') {
                const arg = cmd.args.trim().toLowerCase();
                if (arg === 'all' || arg === 'tất cả') {
                    // Show all tasks including completed ones
                    const rows = index_5.default.prepare('SELECT * FROM tasks ORDER BY done ASC, due_date ASC, due_time ASC').all();
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào trong database.');
                    }
                    else {
                        const taskList = rows.map((r, i) => {
                            const status = r.done ? '✅' : '⏳';
                            return `${i + 1}. ${status} ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`;
                        }).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `📋 Tất cả tasks:\n${taskList}`);
                    }
                }
                else if (arg === 'done' || arg === 'hoàn thành') {
                    // Show completed tasks
                    const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 1 ORDER BY due_date DESC, due_time DESC').all();
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Chưa có task nào hoàn thành.');
                    }
                    else {
                        const taskList = rows.map((r, i) => `${i + 1}. ✅ ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `✅ Tasks đã hoàn thành (${rows.length}):\n${taskList}`);
                    }
                }
                else if (arg === 'deleted' || arg === 'đã xóa') {
                    // Show deleted tasks
                    const deletedTasks = (0, taskOperations_js_1.getDeletedTasks)(15);
                    const deletedList = (0, taskOperations_js_1.formatDeletedTasksList)(deletedTasks);
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `🗑️ Tasks đã xóa (${deletedTasks.length} gần nhất):\n\n${deletedList}`);
                }
                else {
                    // Default: show only pending tasks
                    const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào chưa xong.');
                    }
                    else {
                        const today = new Date().toISOString().split('T')[0];
                        const taskList = rows.map((r, i) => {
                            let status = '';
                            if (r.due_date) {
                                if (r.due_date < today)
                                    status = ' ⚠️';
                                else if (r.due_date === today)
                                    status = ' 🔥';
                            }
                            return `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}${status}`;
                        }).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `⏳ Tasks chưa xong (${rows.length}):\n${taskList}\n\n💡 Dùng /list all|done để xem thêm`);
                    }
                }
                return;
            }
            if (cmd.cmd === 'stats') {
                const total = index_5.default.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
                const done = index_5.default.prepare('SELECT COUNT(*) as c FROM tasks WHERE done = 1').get().c;
                const undone = total - done;
                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Tổng: ${total}\nHoàn thành: ${done}\nChưa xong: ${undone}`);
                return;
            }
            if (cmd.cmd === 'pending') {
                const arg = cmd.args.trim().toLowerCase();
                // Different pending views
                if (arg === 'today' || arg === 'hôm nay') {
                    const today = new Date().toISOString().split('T')[0];
                    const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date = ? ORDER BY due_time').all(today);
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào hôm nay.');
                    }
                    else {
                        const taskList = rows.map((r, i) => `${i + 1}. ${r.content}${r.due_time ? ' @' + r.due_time : ''}`).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `📅 Tasks hôm nay (${today}):\n${taskList}`);
                    }
                }
                else if (arg === 'overdue' || arg === 'quá hạn') {
                    const today = new Date().toISOString().split('T')[0];
                    const now = new Date().toTimeString().slice(0, 5); // HH:MM
                    const rows = index_5.default.prepare(`
                        SELECT * FROM tasks 
                        WHERE done = 0 AND (
                            due_date < ? OR 
                            (due_date = ? AND due_time < ?)
                        ) 
                        ORDER BY due_date DESC, due_time DESC
                    `).all(today, today, now);
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', '✅ Không có task nào quá hạn.');
                    }
                    else {
                        const taskList = rows.map((r, i) => `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''} ⚠️`).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `⚠️ Tasks quá hạn:\n${taskList}`);
                    }
                }
                else if (arg === 'urgent' || arg === 'gấp') {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const tomorrowStr = tomorrow.toISOString().split('T')[0];
                    const rows = index_5.default.prepare(`
                        SELECT * FROM tasks 
                        WHERE done = 0 AND due_date <= ? 
                        ORDER BY due_date ASC, due_time ASC
                    `).all(tomorrowStr);
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', '✅ Không có task gấp nào trong 2 ngày tới.');
                    }
                    else {
                        const taskList = rows.map((r, i) => `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''} 🔥`).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `🔥 Tasks gấp (trong 2 ngày):\n${taskList}`);
                    }
                }
                else {
                    // Default: show all pending tasks with status
                    const today = new Date().toISOString().split('T')[0];
                    const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                    if (rows.length === 0) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào đang chờ xử lý.');
                    }
                    else {
                        const taskList = rows.map((r, i) => {
                            let status = '';
                            if (r.due_date) {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                const tomorrowStr = tomorrow.toISOString().split('T')[0];
                                if (r.due_date < today)
                                    status = ' ⚠️ Quá hạn';
                                else if (r.due_date === today)
                                    status = ' 🔥 Hôm nay';
                                else if (r.due_date <= tomorrowStr)
                                    status = ' ⏰ Gấp';
                            }
                            return `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}${status}`;
                        }).join('\n');
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `📋 Tasks đang chờ xử lý:\n${taskList}\n\n💡 Dùng /pending today|overdue|urgent để xem chi tiết`);
                    }
                }
                return;
            }
            if (cmd.cmd === 'cancel') {
                // Cancel any pending task creation process
                let cancelled = false;
                // Clear pending Google Manager tasks
                if (googleManager && googleManager.hasPendingTask(senderId)) {
                    googleManager.clearPendingTask(senderId);
                    cancelled = true;
                }
                // Clear selection manager state
                if (selection_1.default && selection_1.default.hasPendingSelection(senderId)) {
                    selection_1.default.clearPendingSelection(senderId);
                    cancelled = true;
                }
                // Clear conversation state
                if ((0, conversation_js_1.hasActiveConversation)(senderId)) {
                    (0, conversation_js_1.clearConversation)(senderId);
                    cancelled = true;
                }
                if (cancelled) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', '❌ Đã hủy bỏ quá trình tạo task hiện tại.');
                }
                else {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có quá trình tạo task nào đang diễn ra.');
                }
                return;
            }
            if (cmd.cmd === 'search') {
                const searchTerm = cmd.args.trim();
                if (!searchTerm) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Vui lòng nhập từ khóa cần tìm kiếm.');
                    return;
                }
                const rows = index_5.default.prepare('SELECT * FROM tasks WHERE content LIKE ? ORDER BY done ASC, due_date ASC, due_time ASC').all(`%${searchTerm}%`);
                if (rows.length === 0) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Không tìm thấy task nào chứa từ khóa "${searchTerm}".`);
                }
                else {
                    const taskList = rows.map((r, i) => {
                        const status = r.done ? '✅' : '⏳';
                        return `${i + 1}. ${status} ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`;
                    }).join('\n');
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `🔍 Kết quả tìm kiếm "${searchTerm}" (${rows.length} tasks):\n${taskList}`);
                }
                return;
            }
            // Handle /new command using Google Manager
            if (cmd.cmd === 'new') {
                await (0, taskCreation_js_1.handleTaskCreation)(cmd.args, senderId);
                return;
            }
            if (cmd.cmd === 'done') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Vui lòng nhập số thứ tự, ID, từ khóa hoặc danh sách task cần hoàn thành.\n\n💡 Ví dụ:\n- done 1\n- done 1,2,3\n- done 1-5\n- done họp');
                    return;
                }
                try {
                    // Check if it's a batch operation
                    const references = (0, taskOperations_js_1.parseBatchReferences)(arg);
                    if (references.length > 1) {
                        // Batch operation
                        const result = await (0, taskOperations_js_1.batchDoneTasks)(references, index_1.config.bossZaloId || '');
                        const message = (0, taskOperations_js_1.formatBatchResultMessage)('hoàn thành', result);
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', message); // Handle Google Calendar cleanup
                        if (result.success > 0) {
                            for (const detail of result.details) {
                                if (detail.success && detail.task && detail.task.gcal_event_id) {
                                    try {
                                        await Promise.resolve().then(() => __importStar(require('./gcal/index.js'))).then(m => m.deleteEvent(detail.task.gcal_event_id));
                                    }
                                    catch (err) {
                                        logger_1.default.error('[GCal] Lỗi khi xóa event:', err);
                                    }
                                }
                            }
                        }
                    }
                    else {
                        // Single task operation
                        const taskMatch = (0, taskOperations_js_1.findTaskByReference)(arg, true);
                        if (!taskMatch) {
                            const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                            if (rows.length === 0) {
                                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào chưa hoàn thành.');
                            }
                            else {
                                const taskList = rows.map((r, i) => `${i + 1}. ${r.content} (ID: ${r.id})`).join('\n');
                                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Không tìm thấy task "${arg}". Danh sách task hiện tại:\n${taskList}`);
                            }
                            return;
                        }
                        const task = taskMatch.task;
                        index_5.default.prepare('UPDATE tasks SET done = 1, near_due_notified = 0 WHERE id = ?').run(task.id);
                        if (task.gcal_event_id) {
                            try {
                                await Promise.resolve().then(() => __importStar(require('./gcal/index.js'))).then(m => m.deleteEvent(task.gcal_event_id));
                            }
                            catch (err) {
                                logger_1.default.error('[GCal] Lỗi khi xóa event:', err);
                            }
                        }
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `✅ Đã đánh dấu hoàn thành: ${task.content}`);
                    }
                }
                catch (error) {
                    logger_1.default.error('[Done] Error:', error);
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Lỗi khi đánh dấu hoàn thành task.');
                }
                return;
            }
            if (cmd.cmd === 'delete') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Vui lòng nhập số thứ tự, ID, từ khóa hoặc danh sách task cần xóa.\n\n💡 Ví dụ:\n- delete 1\n- delete 1,2,3\n- delete 1-5\n- delete họp');
                    return;
                }
                try {
                    // Check if it's a batch operation
                    const references = (0, taskOperations_js_1.parseBatchReferences)(arg);
                    if (references.length > 1) {
                        // Batch operation
                        const result = await (0, taskOperations_js_1.batchDeleteTasks)(references, index_1.config.bossZaloId || '');
                        const message = (0, taskOperations_js_1.formatBatchResultMessage)('xóa', result);
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', message);
                        // Handle Google Calendar cleanup
                        if (result.success > 0) {
                            for (const detail of result.details) {
                                if (detail.success && detail.task && detail.task.gcal_event_id) {
                                    try {
                                        await Promise.resolve().then(() => __importStar(require('./gcal/index.js'))).then(m => m.deleteEvent(detail.task.gcal_event_id));
                                    }
                                    catch (err) {
                                        logger_1.default.error('[GCal] Lỗi khi xóa event:', err);
                                    }
                                }
                            }
                        }
                    }
                    else {
                        // Single task operation
                        const taskMatch = (0, taskOperations_js_1.findTaskByReference)(arg, true);
                        if (!taskMatch) {
                            const rows = index_5.default.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                            if (rows.length === 0) {
                                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Không có task nào chưa hoàn thành.');
                            }
                            else {
                                const taskList = rows.map((r, i) => `${i + 1}. ${r.content} (ID: ${r.id})`).join('\n');
                                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Không tìm thấy task "${arg}". Danh sách task hiện tại:\n${taskList}`);
                            }
                            return;
                        }
                        const task = taskMatch.task;
                        // Store deleted task in deleted_tasks table before deletion
                        index_5.default.prepare(`INSERT INTO deleted_tasks 
                            (original_task_id, content, due_date, due_time, gcal_event_id, was_done, created_at) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(task.id, task.content, task.due_date, task.due_time, task.gcal_event_id, task.done, task.created_at);
                        if (task.gcal_event_id) {
                            try {
                                await Promise.resolve().then(() => __importStar(require('./gcal/index.js'))).then(m => m.deleteEvent(task.gcal_event_id));
                            }
                            catch (err) {
                                logger_1.default.error('[GCal] Lỗi khi xóa event:', err);
                            }
                        }
                        index_5.default.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `🗑️ Đã xóa task: ${task.content}`);
                    }
                }
                catch (error) {
                    logger_1.default.error('[Delete] Error:', error);
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Lỗi khi xóa task.');
                }
                return;
            }
            if (cmd.cmd === 'edit') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Vui lòng nhập lệnh chỉnh sửa task.\n\n💡 Ví dụ:\n- edit 1 content:Họp với khách hàng\n- edit 2 time:15:00 date:2024-05-30\n- edit họp location:Văn phòng Hà Nội\n- edit 1,2,3 content:Task đã được cập nhật');
                    return;
                }
                try { // Parse edit command
                    const editCommand = (0, taskOperations_js_1.parseEditCommand)(arg);
                    if (!editCommand.isValidEdit) {
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `❌ Lỗi: ${editCommand.error}\n\n💡 Định dạng: edit <task_ref> <field>:<value>\nVí dụ: edit 1 content:Nội dung mới`);
                        return;
                    }
                    const { references, editInfo } = editCommand; // Check if it's a batch operation
                    if (references.length > 1) {
                        // Batch edit operation
                        const result = await (0, taskOperations_js_1.batchEditTasks)(references, editInfo, index_1.config.bossZaloId || '');
                        const message = (0, taskOperations_js_1.formatEditResultMessage)(references, result, editInfo);
                        await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', message);
                    }
                    else {
                        // Single task edit operation
                        const result = await (0, taskOperations_js_1.editTask)(references[0], editInfo, index_1.config.bossZaloId || '');
                        if (result.success) {
                            const batchResult = {
                                success: 1,
                                failed: 0,
                                details: [{ success: true, task: result.task, reference: references[0] }]
                            };
                            const message = (0, taskOperations_js_1.formatEditResultMessage)(references, batchResult, editInfo);
                            await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', message);
                        }
                        else if (result.conflictInfo) {
                            // Handle schedule conflicts
                            let conflictMsg = `⚠️ Phát hiện xung đột lịch trình:\n\n`;
                            if (result.conflictInfo.conflicts) {
                                for (const conflict of result.conflictInfo.conflicts) {
                                    conflictMsg += `📅 ${conflict.task.content} (${conflict.task.due_date} ${conflict.task.due_time})\n`;
                                }
                            }
                            conflictMsg += `\n❌ Không thể chỉnh sửa task do xung đột thời gian.`;
                            await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', conflictMsg);
                        }
                        else {
                            await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `❌ ${result.error || 'Không thể chỉnh sửa task'}`);
                        }
                    }
                }
                catch (error) {
                    logger_1.default.error('[Edit] Error:', error);
                    await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Lỗi khi chỉnh sửa task.');
                }
                return;
            }
            if (cmd.cmd === 'help') {
                const helpMsg = `🤖 Hướng dẫn sử dụng bot:

📝 QUẢN LÝ TASKS:
/new <nội_dung> [@YYYY-MM-DD] [@HH:mm] - Thêm task mới
/list - Xem danh sách task chưa xong
/list all - Xem tất cả tasks (cả đã xong)
/list done - Xem tasks đã hoàn thành
/list deleted - Xem tasks đã xóa (MỚI)
/done <số|ID|từ_khóa> - Đánh dấu hoàn thành
/delete <số|ID|từ_khóa> - Xóa task
/edit <số|ID|từ_khóa> <field>:<value> - Chỉnh sửa task (MỚI)
/search <từ_khóa> - Tìm kiếm task theo nội dung
/cancel - Hủy bỏ quá trình tạo task (MỚI)

✏️ CHỈNH SỬA TASK (MỚI):
/edit 1 content:Nội dung mới - Sửa nội dung
/edit 2 date:2024-05-30 - Sửa ngày
/edit 3 time:15:00 - Sửa giờ
/edit 4 location:Văn phòng - Sửa địa điểm
/edit 5 description:Ghi chú - Sửa mô tả

🔄 BATCH OPERATIONS (MỚI):
/done 1,2,3 - Hoàn thành nhiều task cùng lúc
/done 1-5 - Hoàn thành task từ vị trí 1 đến 5
/delete 1,2,3 - Xóa nhiều task cùng lúc  
/delete 1-5 - Xóa task từ vị trí 1 đến 5
/edit 1,2,3 content:Cập nhật - Sửa nhiều task cùng lúc

📊 XEM THÔNG TIN:
/stats - Thống kê tổng quan
/pending - Xem tất cả tasks đang chờ
/pending today - Tasks hôm nay
/pending overdue - Tasks quá hạn
/pending urgent - Tasks gấp (2 ngày tới)

🤖 TỰ ĐỘNG PHÂN LOẠI (MỚI):
Bot tự động phân biệt:
📅 Calendar Events: Họp, hẹn, cuộc gọi, sự kiện
📝 Tasks: Làm việc, mua sắm, học tập, báo cáo

💬 NATURAL CONVERSATION (MỚI):
Chỉ cần nói tự nhiên:
- "Nhắc tôi họp lúc 3h chiều mai"
- "Tôi cần làm báo cáo vào thứ 6"
- "Deadline dự án ngày 30/5"
Bot sẽ hỏi thêm thông tin thiếu!

ℹ️ KHÁC:
/help - Xem hướng dẫn này
/me - Xem Zalo ID của bạn

💡 TIPS:
- Dùng số thứ tự (1,2,3) thay vì ID database
- Tìm task theo từ khóa: "done họp", "delete báo cáo"
- Bot hiểu tiếng Việt tự nhiên!
- Gửi lệnh bằng giọng nói cũng được`;
                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', helpMsg);
                return;
            }
            if (cmd.cmd === 'me') {
                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Zalo userId của Boss là: ${index_1.config.bossZaloId}`);
                return;
            }
            // Handle unknown commands gracefully
            if (cmd.cmd === 'unknown') {
                logger_1.default.info(`[Zalo] Unknown command received: "${plainText}"`);
                await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Tôi không hiểu lệnh này. Gửi /help để xem hướng dẫn.');
                return;
            }
            // TODO: handle command, update DB, sync GCal, reply
            await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', `Đã nhận lệnh: ${cmd.cmd}`);
        }
        catch (err) {
            logger_1.default.error({ err }, '[Zalo] Lỗi xử lý lệnh');
            await (0, index_2.sendMessage)(index_1.config.bossZaloId || '', 'Lỗi xử lý lệnh.');
        }
    }); // Start Express for webhooks first
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Health check endpoint for production
    app.get('/health', (req, res) => {
        try {
            // Basic database health check
            const dbCheck = index_5.default.prepare('SELECT 1 as test').get();
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                database: dbCheck ? 'connected' : 'disconnected',
                environment: process.env.NODE_ENV || 'development'
            });
        }
        catch (error) {
            logger_1.default.error('[Health] Health check failed:', error);
            res.status(500).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message,
                environment: process.env.NODE_ENV || 'development'
            });
        }
    });
    app.get('/', (req, res) => res.send('Vietnamese Task Bot is running! 🤖'));
    app.use(index_3.default);
    app.listen(index_1.config.port, () => {
        logger_1.default.info(`Server running on :${index_1.config.port}`);
        logger_1.default.info(`QR endpoint: http://localhost:${index_1.config.port}/qr`);
    }); // Start scheduler
    (0, index_4.startScheduler)();
    // Start reminder system
    reminderSystem_1.default.startChecking();
    logger_1.default.info('[Reminder] Task reminder system started');
    // Định kỳ đồng bộ 2 chiều Google Calendar - Add prevention for testing
    const enableAutoSync = process.env.ENABLE_AUTO_SYNC !== 'false';
    if (enableAutoSync) {
        setInterval(index_6.syncFromGCal, 5 * 60 * 1000); // 5 phút
        logger_1.default.info('[Main] Auto-sync Google Calendar enabled (5 min interval)');
    }
    else {
        logger_1.default.info('[Main] Auto-sync Google Calendar disabled for testing');
    }
}
main().catch((e) => logger_1.default.error(e));
