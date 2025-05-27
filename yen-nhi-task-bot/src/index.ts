/**
 * src/index.ts
 * Main entry: Zalo login, message listener, audio/text handling, scheduler, webhooks.
 */
import express from 'express';
import { config } from './config/index';
import logger from './utils/logger';
import { login, onMessage, sendMessage } from './zalo/index';
import { downloadAudio } from './audio/audioDownloader';
import { convertToWav } from './audio/convert';
import { transcribe } from './audio/stt';
// import { parseCommand } from './parser/index';
import { parseCommandEnhanced } from './parser/enhanced';
import webhookRouter from './webhooks/index';
import { startScheduler } from './scheduler/index';
import db from './db/index';
import { syncFromGCal } from './gcal/index';
import { GoogleManager } from './google/manager';
import selectionManager, { SelectionManager } from './google/selection';
import {
    findTaskByReference,
    parseBatchReferences,
    batchDoneTasks,
    batchDeleteTasks,
    formatBatchResultMessage,
    getDeletedTasks,
    formatDeletedTasksList,
    categorizeTaskType,
    editTask,
    batchEditTasks,
    parseEditCommand,
    formatEditResultMessage
} from './utils/taskOperations.js';
import {
    startConversationalTask,
    handleConversationResponse,
    hasActiveConversation,
    clearConversation
} from './utils/conversation.js';
import {
    initializeTaskCreation,
    handleTaskCreation,
    handleMissingInfoResponse,
    handleCalendarAndTaskListSelection
} from './utils/taskCreation.js';
import reminderSystem from './utils/reminderSystem';
import optimizationManager from './optimizations/optimizationManager.js';

// Initialize Google Manager
let googleManager: GoogleManager;

async function main() {    // Initialize Google Manager
    try {
        googleManager = new GoogleManager();
        logger.info('[Google] Google Manager initialized');

        // Initialize task creation module with the Google Manager instance
        initializeTaskCreation(googleManager);
        logger.info('[TaskCreation] Task creation module initialized');

        logger.info('[TaskOps] Task Operations functions imported');
    } catch (err) {
        logger.error('[Google] Failed to initialize Google Manager:', err);
    } logger.info('[Zalo] Bắt đầu đăng nhập Zalo...');
    try {
        const result = await login();
        if (result) {
            logger.info('[Zalo] ✅ Đăng nhập thành công! API instance available.');
        } else {
            logger.warn('[Zalo] ⚠️ Login function returned null/undefined');
        }
        logger.info('[Zalo] Đã gọi xong hàm login(). Nếu có QR, hãy kiểm tra terminal để quét.');
    } catch (err) {
        logger.error('[Zalo] ❌ Lỗi khi đăng nhập:', err);
        logger.error('[Zalo] Error details:', {
            message: (err as Error).message,
            stack: (err as Error).stack?.split('\n').slice(0, 5).join('\n')
        });
        // Don't throw, keep server running
    }

    onMessage(async (msg) => {
        try {
            // Extract text and sender ID from message
            let plainText = '';
            const senderId = msg.uidFrom || msg.data?.uidFrom || msg.senderId; logger.info({ zaloMsg: msg }, '[Zalo] Nhận message');            // ENHANCED MESSAGE FILTERING
            // 1. Check sender ID
            if (!senderId || senderId !== config.bossZaloId) {
                logger.info(`[Zalo] IGNORED - Message from non-Boss user: ${senderId} vs Boss: ${config.bossZaloId}`);
                return;
            }

            // 2. Check if it's a group message (should reject group messages)
            if (msg.data?.isGroup || msg.groupId || msg.data?.groupId) {
                logger.info(`[Zalo] IGNORED - Group message from Boss (groupId: ${msg.groupId || msg.data?.groupId})`);
                return;
            }

            // 3. Enhanced thread filtering - Only process messages from dedicated Bot-Boss chat
            const threadId = msg.threadId || msg.data?.threadId;
            const isPrivateChat = !msg.data?.isGroup && !msg.groupId && !msg.data?.groupId;

            if (!isPrivateChat && threadId) {
                logger.info(`[Zalo] IGNORED - Message from thread ${threadId} that is not private Boss chat`);
                return;
            }

            // 4. Check message type validity - Accept text and voice messages
            const msgType = msg.data?.msgType || msg.type;
            if (msgType && !['chat.text', 'chat.voice', 'webchat'].includes(msgType)) {
                logger.info(`[Zalo] IGNORED - Unsupported message type: ${msgType}`);
                return;
            }

            // 5. Additional validation: Only accept messages that are actual content from Boss
            if (msg.data?.isEvent || msg.data?.isSystemMessage) {
                logger.info(`[Zalo] IGNORED - System/event message type`);
                return;
            }

            logger.info(`[Zalo] ✅ PROCESSING - Valid private message from Boss: ${senderId} (thread: ${threadId || 'direct'})`);

            // Handle different message types
            if (msg.data?.msgType === 'chat.voice' || (msg.data?.content && typeof msg.data.content === 'object' && msg.data.content.href)) {
                // Voice message
                logger.info('[Zalo] Đây là tin nhắn audio');
                try {
                    const audioUrl = msg.data.content.href || msg.data.content.params?.m4a;
                    if (audioUrl) {
                        logger.info(`[Zalo] Audio URL: ${audioUrl}`);
                        const audioBuf = await downloadAudio(audioUrl, msg.token || '');
                        const wavBuf = await convertToWav(audioBuf);
                        plainText = await transcribe(wavBuf, 'vi');
                        logger.info({ plainText }, '[Zalo] STT audio -> text');
                    } else {
                        logger.warn('[Zalo] Không tìm thấy audio URL');
                        await sendMessage(config.bossZaloId || '', 'Không thể xử lý tin nhắn audio này.');
                        return;
                    }
                } catch (audioError) {
                    logger.error('[Zalo] Lỗi xử lý audio:', {
                        error: audioError,
                        message: (audioError as Error).message,
                        stack: (audioError as Error).stack,
                        audioUrl: msg.data.content.href || msg.data.content.params?.m4a
                    });
                    await sendMessage(config.bossZaloId || '', `Lỗi khi xử lý tin nhắn audio: ${(audioError as Error).message}`);
                    return;
                }
            } else {
                // Text message
                plainText = msg.text || msg.data?.content || '';
                // CRITICAL FIX: Handle [object Object] bug
                if (typeof plainText === 'object') {
                    logger.warn('[Zalo] Received object as content, attempting to extract text:', plainText);
                    // Try to extract text from object
                    if (plainText && typeof plainText === 'object') {
                        const textObj = plainText as any;
                        plainText = textObj.text || textObj.message || textObj.content || JSON.stringify(plainText);
                    }
                }

                if (typeof plainText !== 'string') {
                    logger.warn('[Zalo] plainText không phải string:', plainText);
                    plainText = String(plainText);
                }

                // Additional safety check for [object Object] strings
                if (plainText === '[object Object]') {
                    logger.error('[Zalo] Detected [object Object] bug - skipping message');
                    await sendMessage(config.bossZaloId || '', 'Lỗi: Không thể đọc được nội dung tin nhắn.');
                    return;
                }
            } logger.info(`[Zalo] Text: "${plainText}", From: ${senderId}`);            // Check if this is a response to pending selection
            const handledSelection = await selectionManager.handleSelectionResponse(senderId, plainText);
            if (handledSelection.handled) {
                logger.info('[Selection] Handled pending selection response');

                // If selection was completed and we have task context, continue with task creation
                if (handledSelection.continueTask) {
                    const taskInfo = handledSelection.continueTask;

                    // Continue with calendar/task list selection or create task
                    await handleCalendarAndTaskListSelection(taskInfo, senderId);
                }
                return;
            }            // Check if this is a response to pending task info request
            const handledPending = await handleMissingInfoResponse(plainText, senderId);
            if (handledPending) {
                logger.info('[Task] Handled pending task info response');
                return;
            }

            // Check if this is a response to conflict decision request
            if (googleManager.hasPendingTask(senderId)) {
                const pendingTask = googleManager.getPendingTask(senderId);
                if (pendingTask && pendingTask.awaitingConflictDecision) {
                    logger.info('[Conflict] Handling conflict decision response');

                    const response = plainText.toLowerCase().trim();

                    if (response === 'có' || response === 'yes' || response === 'ok' || response === 'y') {
                        // User wants to proceed with original time despite conflicts
                        logger.info('[Conflict] User chose to proceed with original time');

                        // Remove conflict info and proceed with task creation
                        const taskInfoWithoutConflict = { ...pendingTask };
                        delete taskInfoWithoutConflict.conflictInfo;
                        delete taskInfoWithoutConflict.awaitingConflictDecision;

                        // Clear pending task first
                        googleManager.clearPendingTask(senderId);

                        // Continue with calendar/task list selection or create task
                        await handleCalendarAndTaskListSelection(taskInfoWithoutConflict, senderId);

                    } else if (response === 'không' || response === 'no' || response === 'cancel' || response === 'n') {
                        // User wants to cancel task creation
                        logger.info('[Conflict] User chose to cancel due to conflicts');
                        googleManager.clearPendingTask(senderId);
                        await sendMessage(config.bossZaloId || '', '❌ Đã hủy bỏ việc tạo task do xung đột lịch trình.');

                    } else {
                        // Invalid response, ask again
                        await sendMessage(config.bossZaloId || '', 'Vui lòng phản hồi "có" để tạo task với thời gian gốc hoặc "không" để hủy bỏ.');
                    }

                    return; // Task handled
                }
            }

            // Check if user has active conversation for task creation
            if (hasActiveConversation(senderId)) {
                const conversationResult = await handleConversationResponse(senderId, plainText);
                if (conversationResult.handled) {
                    logger.info('[Conversation] Handled conversation response');
                    return;
                }
            }            // ENHANCED PARSING: Use optimization manager instead of fallback
            logger.info(`[Optimization] Processing message: "${plainText}"`);

            // Get conversation history for context
            const conversationHistory: string[] = []; // Could be enhanced to track actual history

            // Apply optimization pipeline
            const optimizationResult = await optimizationManager.optimizeMessageProcessing(
                plainText,
                senderId,
                conversationHistory
            );

            logger.info({
                optimizations: optimizationResult.optimizations,
                performance: optimizationResult.performance,
                confidence: optimizationResult.confidence
            }, '[Optimization] Pipeline completed');

            // Handle non-task messages
            if (!optimizationResult.success ||
                (optimizationResult.result.isTask === false && optimizationResult.result.quickReply)) {
                await sendMessage(config.bossZaloId || '', optimizationResult.result.quickReply);
                return;
            }            // If this is a task, apply Smart Selection and Conversation Optimizer
            if (optimizationResult.success && optimizationResult.result.title) {                // Get available calendars and task lists - FIX: Use await for async methods
                const availableCalendars = await googleManager.getCalendars();
                const availableTaskLists = await googleManager.getTaskLists();

                // Apply task creation optimizations (Smart Selection + Conversation Optimizer)
                const taskOptimizationResult = await optimizationManager.optimizeTaskCreation(
                    optimizationResult.result,
                    senderId,
                    availableCalendars,
                    availableTaskLists
                );

                logger.info({
                    smartSelectionUsed: taskOptimizationResult.optimizations.smartSelectionUsed,
                    conversationOptimized: taskOptimizationResult.optimizations.conversationOptimized,
                    conversationStepsReduced: taskOptimizationResult.performance.conversationStepsReduced
                }, '[Optimization] Task creation optimization applied');

                // If Smart Selection was successful, use the optimized task
                if (taskOptimizationResult.success && taskOptimizationResult.result.optimizedTask) {
                    const optimizedTask = taskOptimizationResult.result.optimizedTask;

                    // Check if we have auto-selected calendar/tasklist
                    if (optimizedTask.calendarId || optimizedTask.taskListId) {
                        logger.info('[Smart Selection] Auto-selected calendar/tasklist, proceeding with task creation');

                        // Create task directly with Smart Selection result
                        await handleCalendarAndTaskListSelection(optimizedTask, senderId);
                        return;
                    }
                }
            }

            // If optimization didn't produce a clear command, try enhanced parsing
            let enhancedCmd;
            if (!optimizationResult.result.cmd) {
                enhancedCmd = parseCommandEnhanced(plainText);
                if (!enhancedCmd) {
                    // Not a command - check if it's a natural task request
                    logger.info(`[Zalo] No command detected, checking for conversational task: "${plainText}"`);

                    const handledConversation = await startConversationalTask(senderId, plainText);
                    if (handledConversation) {
                        logger.info('[Conversation] Started conversational task creation');
                        return;
                    }

                    // Truly just casual conversation
                    logger.info(`[Zalo] Casual conversation detected, not processing: "${plainText}"`);
                    return;
                }
            } else {
                // Use optimized result
                enhancedCmd = {
                    cmd: optimizationResult.result.cmd || 'add',
                    args: optimizationResult.result.title || plainText,
                    confidence: optimizationResult.confidence,
                    reasoning: 'From optimization pipeline'
                };
            }

            // Log parsing results
            logger.info({
                cmd: enhancedCmd,
                confidence: enhancedCmd.confidence,
                reasoning: enhancedCmd.reasoning
            }, '[Zalo] Enhanced parsed command');

            // Use enhanced command
            const cmd = { cmd: enhancedCmd.cmd, args: enhancedCmd.args }; logger.info({ cmd }, '[Zalo] Parsed command'); if (cmd.cmd === 'list') {
                const arg = cmd.args.trim().toLowerCase();

                if (arg === 'all' || arg === 'tất cả') {
                    // Show all tasks including completed ones
                    const rows: any[] = db.prepare('SELECT * FROM tasks ORDER BY done ASC, due_date ASC, due_time ASC').all();
                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', 'Không có task nào trong database.');
                    } else {
                        const taskList = rows.map((r: any, i: number) => {
                            const status = r.done ? '✅' : '⏳';
                            return `${i + 1}. ${status} ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`;
                        }).join('\n');
                        await sendMessage(config.bossZaloId || '', `📋 Tất cả tasks:\n${taskList}`);
                    }
                } else if (arg === 'done' || arg === 'hoàn thành') {
                    // Show completed tasks
                    const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 1 ORDER BY due_date DESC, due_time DESC').all();
                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', 'Chưa có task nào hoàn thành.');
                    } else {
                        const taskList = rows.map((r: any, i: number) =>
                            `${i + 1}. ✅ ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`
                        ).join('\n');
                        await sendMessage(config.bossZaloId || '', `✅ Tasks đã hoàn thành (${rows.length}):\n${taskList}`);
                    }
                } else if (arg === 'deleted' || arg === 'đã xóa') {
                    // Show deleted tasks
                    const deletedTasks = getDeletedTasks(15);
                    const deletedList = formatDeletedTasksList(deletedTasks);
                    await sendMessage(config.bossZaloId || '', `🗑️ Tasks đã xóa (${deletedTasks.length} gần nhất):\n\n${deletedList}`);
                } else {
                    // Default: show only pending tasks
                    const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', 'Không có task nào chưa xong.');
                    } else {
                        const today = new Date().toISOString().split('T')[0];
                        const taskList = rows.map((r: any, i: number) => {
                            let status = '';
                            if (r.due_date) {
                                if (r.due_date < today) status = ' ⚠️';
                                else if (r.due_date === today) status = ' 🔥';
                            }
                            return `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}${status}`;
                        }).join('\n');
                        await sendMessage(config.bossZaloId || '', `⏳ Tasks chưa xong (${rows.length}):\n${taskList}\n\n💡 Dùng /list all|done để xem thêm`);
                    }
                }
                return;
            } if (cmd.cmd === 'stats') {
                const total = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
                const done = (db.prepare('SELECT COUNT(*) as c FROM tasks WHERE done = 1').get() as any).c;
                const undone = total - done;
                await sendMessage(config.bossZaloId || '', `Tổng: ${total}\nHoàn thành: ${done}\nChưa xong: ${undone}`);
                return;
            }

            if (cmd.cmd === 'pending') {
                const arg = cmd.args.trim().toLowerCase();

                // Different pending views
                if (arg === 'today' || arg === 'hôm nay') {
                    const today = new Date().toISOString().split('T')[0];
                    const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date = ? ORDER BY due_time').all(today);
                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', 'Không có task nào hôm nay.');
                    } else {
                        const taskList = rows.map((r: any, i: number) =>
                            `${i + 1}. ${r.content}${r.due_time ? ' @' + r.due_time : ''}`
                        ).join('\n');
                        await sendMessage(config.bossZaloId || '', `📅 Tasks hôm nay (${today}):\n${taskList}`);
                    }
                } else if (arg === 'overdue' || arg === 'quá hạn') {
                    const today = new Date().toISOString().split('T')[0];
                    const now = new Date().toTimeString().slice(0, 5); // HH:MM
                    const rows: any[] = db.prepare(`
                        SELECT * FROM tasks 
                        WHERE done = 0 AND (
                            due_date < ? OR 
                            (due_date = ? AND due_time < ?)
                        ) 
                        ORDER BY due_date DESC, due_time DESC
                    `).all(today, today, now);

                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', '✅ Không có task nào quá hạn.');
                    } else {
                        const taskList = rows.map((r: any, i: number) =>
                            `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''} ⚠️`
                        ).join('\n');
                        await sendMessage(config.bossZaloId || '', `⚠️ Tasks quá hạn:\n${taskList}`);
                    }
                } else if (arg === 'urgent' || arg === 'gấp') {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const tomorrowStr = tomorrow.toISOString().split('T')[0];

                    const rows: any[] = db.prepare(`
                        SELECT * FROM tasks 
                        WHERE done = 0 AND due_date <= ? 
                        ORDER BY due_date ASC, due_time ASC
                    `).all(tomorrowStr);

                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', '✅ Không có task gấp nào trong 2 ngày tới.');
                    } else {
                        const taskList = rows.map((r: any, i: number) =>
                            `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''} 🔥`
                        ).join('\n');
                        await sendMessage(config.bossZaloId || '', `🔥 Tasks gấp (trong 2 ngày):\n${taskList}`);
                    }
                } else {
                    // Default: show all pending tasks with status
                    const today = new Date().toISOString().split('T')[0];
                    const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();

                    if (rows.length === 0) {
                        await sendMessage(config.bossZaloId || '', 'Không có task nào đang chờ xử lý.');
                    } else {
                        const taskList = rows.map((r: any, i: number) => {
                            let status = '';
                            if (r.due_date) {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                const tomorrowStr = tomorrow.toISOString().split('T')[0];

                                if (r.due_date < today) status = ' ⚠️ Quá hạn';
                                else if (r.due_date === today) status = ' 🔥 Hôm nay';
                                else if (r.due_date <= tomorrowStr) status = ' ⏰ Gấp';
                            }
                            return `${i + 1}. ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}${status}`;
                        }).join('\n');
                        await sendMessage(config.bossZaloId || '', `📋 Tasks đang chờ xử lý:\n${taskList}\n\n💡 Dùng /pending today|overdue|urgent để xem chi tiết`);
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
                if (selectionManager && selectionManager.hasPendingSelection(senderId)) {
                    selectionManager.clearPendingSelection(senderId);
                    cancelled = true;
                }
                // Clear conversation state
                if (hasActiveConversation(senderId)) {
                    clearConversation(senderId);
                    cancelled = true;
                }

                if (cancelled) {
                    await sendMessage(config.bossZaloId || '', '❌ Đã hủy bỏ quá trình tạo task hiện tại.');
                } else {
                    await sendMessage(config.bossZaloId || '', 'Không có quá trình tạo task nào đang diễn ra.');
                }
                return;
            }

            if (cmd.cmd === 'search') {
                const searchTerm = cmd.args.trim();
                if (!searchTerm) {
                    await sendMessage(config.bossZaloId || '', 'Vui lòng nhập từ khóa cần tìm kiếm.');
                    return;
                }

                const rows: any[] = db.prepare('SELECT * FROM tasks WHERE content LIKE ? ORDER BY done ASC, due_date ASC, due_time ASC').all(`%${searchTerm}%`);

                if (rows.length === 0) {
                    await sendMessage(config.bossZaloId || '', `Không tìm thấy task nào chứa từ khóa "${searchTerm}".`);
                } else {
                    const taskList = rows.map((r: any, i: number) => {
                        const status = r.done ? '✅' : '⏳';
                        return `${i + 1}. ${status} ${r.content}${r.due_date ? ' @' + r.due_date : ''}${r.due_time ? ' @' + r.due_time : ''}`;
                    }).join('\n');
                    await sendMessage(config.bossZaloId || '', `🔍 Kết quả tìm kiếm "${searchTerm}" (${rows.length} tasks):\n${taskList}`);
                }
                return;
            }

            // Handle /new command using Google Manager
            if (cmd.cmd === 'new') {
                await handleTaskCreation(cmd.args, senderId);
                return;
            } if (cmd.cmd === 'done') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await sendMessage(config.bossZaloId || '', 'Vui lòng nhập số thứ tự, ID, từ khóa hoặc danh sách task cần hoàn thành.\n\n💡 Ví dụ:\n- done 1\n- done 1,2,3\n- done 1-5\n- done họp');
                    return;
                }

                try {
                    // Check if it's a batch operation
                    const references = parseBatchReferences(arg);

                    if (references.length > 1) {
                        // Batch operation
                        const result = await batchDoneTasks(references, config.bossZaloId || '');
                        const message = formatBatchResultMessage('hoàn thành', result);
                        await sendMessage(config.bossZaloId || '', message);                        // Handle Google Calendar cleanup
                        if (result.success > 0) {
                            for (const detail of result.details) {
                                if (detail.success && detail.task && detail.task.gcal_event_id) {
                                    try {
                                        await import('./gcal/index.js').then(m => m.deleteEvent(detail.task.gcal_event_id));
                                    } catch (err) {
                                        logger.error('[GCal] Lỗi khi xóa event:', err);
                                    }
                                }
                            }
                        }
                    } else {
                        // Single task operation
                        const taskMatch = findTaskByReference(arg, true);

                        if (!taskMatch) {
                            const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                            if (rows.length === 0) {
                                await sendMessage(config.bossZaloId || '', 'Không có task nào chưa hoàn thành.');
                            } else {
                                const taskList = rows.map((r: any, i: number) => `${i + 1}. ${r.content} (ID: ${r.id})`).join('\n');
                                await sendMessage(config.bossZaloId || '', `Không tìm thấy task "${arg}". Danh sách task hiện tại:\n${taskList}`);
                            }
                            return;
                        }

                        const task = taskMatch.task;
                        db.prepare('UPDATE tasks SET done = 1, near_due_notified = 0 WHERE id = ?').run(task.id);

                        if (task.gcal_event_id) {
                            try {
                                await import('./gcal/index.js').then(m => m.deleteEvent(task.gcal_event_id));
                            } catch (err) {
                                logger.error('[GCal] Lỗi khi xóa event:', err);
                            }
                        }

                        await sendMessage(config.bossZaloId || '', `✅ Đã đánh dấu hoàn thành: ${task.content}`);
                    }
                } catch (error) {
                    logger.error('[Done] Error:', error);
                    await sendMessage(config.bossZaloId || '', 'Lỗi khi đánh dấu hoàn thành task.');
                }
                return;
            } if (cmd.cmd === 'delete') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await sendMessage(config.bossZaloId || '', 'Vui lòng nhập số thứ tự, ID, từ khóa hoặc danh sách task cần xóa.\n\n💡 Ví dụ:\n- delete 1\n- delete 1,2,3\n- delete 1-5\n- delete họp');
                    return;
                }

                try {
                    // Check if it's a batch operation
                    const references = parseBatchReferences(arg);

                    if (references.length > 1) {
                        // Batch operation
                        const result = await batchDeleteTasks(references, config.bossZaloId || '');
                        const message = formatBatchResultMessage('xóa', result);
                        await sendMessage(config.bossZaloId || '', message);

                        // Handle Google Calendar cleanup
                        if (result.success > 0) {
                            for (const detail of result.details) {
                                if (detail.success && detail.task && detail.task.gcal_event_id) {
                                    try {
                                        await import('./gcal/index.js').then(m => m.deleteEvent(detail.task.gcal_event_id));
                                    } catch (err) {
                                        logger.error('[GCal] Lỗi khi xóa event:', err);
                                    }
                                }
                            }
                        }
                    } else {
                        // Single task operation
                        const taskMatch = findTaskByReference(arg, true);

                        if (!taskMatch) {
                            const rows: any[] = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY due_date, due_time').all();
                            if (rows.length === 0) {
                                await sendMessage(config.bossZaloId || '', 'Không có task nào chưa hoàn thành.');
                            } else {
                                const taskList = rows.map((r: any, i: number) => `${i + 1}. ${r.content} (ID: ${r.id})`).join('\n');
                                await sendMessage(config.bossZaloId || '', `Không tìm thấy task "${arg}". Danh sách task hiện tại:\n${taskList}`);
                            }
                            return;
                        } const task = taskMatch.task;

                        // Store deleted task in deleted_tasks table before deletion
                        db.prepare(`INSERT INTO deleted_tasks 
                            (original_task_id, content, due_date, due_time, gcal_event_id, was_done, created_at) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                            task.id, task.content, task.due_date, task.due_time,
                            task.gcal_event_id, task.done, task.created_at
                        );

                        if (task.gcal_event_id) {
                            try {
                                await import('./gcal/index.js').then(m => m.deleteEvent(task.gcal_event_id));
                            } catch (err) {
                                logger.error('[GCal] Lỗi khi xóa event:', err);
                            }
                        }

                        db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
                        await sendMessage(config.bossZaloId || '', `🗑️ Đã xóa task: ${task.content}`);
                    }
                } catch (error) {
                    logger.error('[Delete] Error:', error);
                    await sendMessage(config.bossZaloId || '', 'Lỗi khi xóa task.');
                }
                return;
            }

            if (cmd.cmd === 'edit') {
                const arg = cmd.args.trim();
                if (!arg) {
                    await sendMessage(config.bossZaloId || '', 'Vui lòng nhập lệnh chỉnh sửa task.\n\n💡 Ví dụ:\n- edit 1 content:Họp với khách hàng\n- edit 2 time:15:00 date:2024-05-30\n- edit họp location:Văn phòng Hà Nội\n- edit 1,2,3 content:Task đã được cập nhật');
                    return;
                }

                try {                    // Parse edit command
                    const editCommand = parseEditCommand(arg);
                    if (!editCommand.isValidEdit) {
                        await sendMessage(config.bossZaloId || '', `❌ Lỗi: ${editCommand.error}\n\n💡 Định dạng: edit <task_ref> <field>:<value>\nVí dụ: edit 1 content:Nội dung mới`);
                        return;
                    }

                    const { references, editInfo } = editCommand;                    // Check if it's a batch operation
                    if (references.length > 1) {
                        // Batch edit operation
                        const result = await batchEditTasks(references, editInfo, config.bossZaloId || '');
                        const message = formatEditResultMessage(references, result, editInfo);
                        await sendMessage(config.bossZaloId || '', message);
                    } else {
                        // Single task edit operation
                        const result = await editTask(references[0], editInfo, config.bossZaloId || '');

                        if (result.success) {
                            const batchResult = {
                                success: 1,
                                failed: 0,
                                details: [{ success: true, task: result.task, reference: references[0] }]
                            };
                            const message = formatEditResultMessage(references, batchResult, editInfo);
                            await sendMessage(config.bossZaloId || '', message);
                        } else if (result.conflictInfo) {
                            // Handle schedule conflicts
                            let conflictMsg = `⚠️ Phát hiện xung đột lịch trình:\n\n`;
                            if (result.conflictInfo.conflicts) {
                                for (const conflict of result.conflictInfo.conflicts) {
                                    conflictMsg += `📅 ${conflict.task.content} (${conflict.task.due_date} ${conflict.task.due_time})\n`;
                                }
                            }
                            conflictMsg += `\n❌ Không thể chỉnh sửa task do xung đột thời gian.`;
                            await sendMessage(config.bossZaloId || '', conflictMsg);
                        } else {
                            await sendMessage(config.bossZaloId || '', `❌ ${result.error || 'Không thể chỉnh sửa task'}`);
                        }
                    }
                } catch (error) {
                    logger.error('[Edit] Error:', error);
                    await sendMessage(config.bossZaloId || '', 'Lỗi khi chỉnh sửa task.');
                }
                return;
            } if (cmd.cmd === 'help') {
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
                await sendMessage(config.bossZaloId || '', helpMsg);
                return;
            }
            if (cmd.cmd === 'me') {
                await sendMessage(config.bossZaloId || '', `Zalo userId của Boss là: ${config.bossZaloId}`);
                return;
            }
            // Handle unknown commands gracefully
            if (cmd.cmd === 'unknown') {
                logger.info(`[Zalo] Unknown command received: "${plainText}"`);
                await sendMessage(config.bossZaloId || '', 'Tôi không hiểu lệnh này. Gửi /help để xem hướng dẫn.');
                return;
            }

            // TODO: handle command, update DB, sync GCal, reply
            await sendMessage(config.bossZaloId || '', `Đã nhận lệnh: ${cmd.cmd}`);
        } catch (err) {
            logger.error({ err }, '[Zalo] Lỗi xử lý lệnh');
            await sendMessage(config.bossZaloId || '', 'Lỗi xử lý lệnh.');
        }
    });    // Start Express for webhooks first
    const app = express();
    app.use(express.json());

    // Health check endpoint for production
    app.get('/health', (req, res) => {
        try {
            // Basic database health check
            const dbCheck = db.prepare('SELECT 1 as test').get();

            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                database: dbCheck ? 'connected' : 'disconnected',
                environment: process.env.NODE_ENV || 'development'
            });
        } catch (error) {
            logger.error('[Health] Health check failed:', error);
            res.status(500).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: (error as Error).message,
                environment: process.env.NODE_ENV || 'development'
            });
        }
    });

    app.get('/', (req, res) => res.send('Vietnamese Task Bot is running! 🤖'));
    app.use(webhookRouter);
    app.listen(config.port, () => {
        logger.info(`Server running on :${config.port}`);
        logger.info(`QR endpoint: http://localhost:${config.port}/qr`);
    });    // Start scheduler
    startScheduler();

    // Start reminder system
    reminderSystem.startChecking();
    logger.info('[Reminder] Task reminder system started');    // Định kỳ đồng bộ 2 chiều Google Calendar - Enhanced with better error handling
    const enableAutoSync = process.env.ENABLE_AUTO_SYNC !== 'false';
    if (enableAutoSync) {
        // More frequent sync for better real-time updates
        setInterval(async () => {
            try {
                await syncFromGCal();
                logger.info('[Main] Auto-sync Google Calendar completed successfully');
            } catch (error) {
                logger.error('[Main] Auto-sync Google Calendar failed:', error);
                // Continue running even if sync fails
            }
        }, 2 * 60 * 1000); // 2 minutes instead of 5

        logger.info('[Main] Auto-sync Google Calendar enabled (2 min interval)');
    } else {
        logger.info('[Main] Auto-sync Google Calendar disabled for testing');
    }
}

main().catch((e) => logger.error(e));
