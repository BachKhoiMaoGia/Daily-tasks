/**
 * Task Creation Module
 * Handles task creation logic to avoid circular imports
 */

import logger from './logger';
import { sendMessage } from '../zalo/index';
import { GoogleManager } from '../google/manager';
import selectionManager, { SelectionManager } from '../google/selection';
import { categorizeTaskType, createTaskWithConflictCheck } from './taskOperations';
import reminderSystem from './reminderSystem';
import db from '../db/index';
import llmParser, { TaskExtractionResult } from './llmParser';

let googleManagerInstance: GoogleManager | null = null;

/**
 * Initialize with GoogleManager instance
 */
export function initializeTaskCreation(googleManager: GoogleManager) {
    googleManagerInstance = googleManager;
}

/**
 * Enhanced task creation using Google Manager with intelligent LLM parsing
 */
export async function handleTaskCreation(args: string, senderId: string) {
    try {
        if (!googleManagerInstance) {
            logger.error('[Task] Google Manager not initialized');
            await sendMessage(senderId, 'Lỗi: Google Manager chưa được khởi tạo.');
            return;
        }

        // First, try intelligent LLM extraction for better context understanding
        let taskInfo;
        let taskType: 'calendar' | 'task' | 'meeting' = 'task';

        try {
            const llmResult = await llmParser.extractTaskFromNaturalLanguage(args, senderId);

            if (llmResult.confidence > 0.7) {
                // Convert LLM result to taskInfo format
                taskInfo = {
                    title: llmResult.title,
                    dueDate: llmResult.date,
                    dueTime: llmResult.time,
                    attendees: [...llmResult.attendees, ...llmResult.emails],
                    location: llmResult.location,
                    description: llmResult.description
                };                // Determine task type using the updated categorization logic
                taskType = categorizeTaskType(args);

                // Override only for specific LLM-detected patterns - FIXED: More conservative
                if (llmResult.meetingType === 'google_meet' ||
                    (llmResult.title && /họp|meeting|cuộc họp|hội nghị|phỏng vấn/.test(llmResult.title.toLowerCase()))) {
                    taskType = 'meeting';
                }
                // REMOVED: Auto-upgrade to calendar - respect explicit "task" keyword
                // Only upgrade to calendar if it's NOT explicitly a task and has strong calendar indicators
                else if (taskType !== 'task' && (llmResult.date || llmResult.time) &&
                    !args.toLowerCase().includes('task') && !args.toLowerCase().includes('tạo task')) {
                    taskType = 'calendar';
                }

                // Add Google Meet request if detected
                if (llmResult.meetingType === 'google_meet') {
                    taskInfo.description = (taskInfo.description || '') + ' [Google Meet requested]';
                }

                logger.info('[Task] LLM extraction successful:', {
                    llmResult,
                    taskInfo,
                    taskType,
                    confidence: llmResult.confidence
                });
            } else {
                throw new Error('LLM confidence too low, falling back to regex');
            }
        } catch (llmError) {
            logger.warn('[Task] LLM extraction failed, falling back to Google Manager parsing:', llmError);

            // Fallback to original Google Manager parsing
            taskInfo = googleManagerInstance.parseTaskInfo(args);
            taskType = categorizeTaskType(args);
        }

        logger.info({ taskInfo, taskType }, '[Task] Final parsed task information');

        // Check for missing information based on task type
        const missingInfo = googleManagerInstance.checkMissingInfo(taskInfo, taskType);

        if (missingInfo) {
            // Ask Boss for missing information with context
            logger.info({ missingInfo }, '[Task] Missing information detected');

            // Set conversation context for better follow-up understanding
            llmParser.setConversationContext(senderId, missingInfo.message, `Creating ${taskType}: ${taskInfo.title || args}`);

            await sendMessage(senderId, missingInfo.message);

            // Store partial task info with task type for later completion
            googleManagerInstance.storePendingTask(senderId, taskInfo, taskType);
            return;
        }

        // All required info available - add task type to taskInfo
        const enhancedTaskInfo = { ...taskInfo, taskType };

        // Check calendar/task list selection
        await handleCalendarAndTaskListSelection(enhancedTaskInfo, senderId);

    } catch (error) {
        logger.error('[Task] Error in handleTaskCreation:', error);
        await sendMessage(senderId, 'Lỗi khi tạo task. Vui lòng thử lại.');
    }
}

/**
 * Handle calendar and task list selection - SMART LOGIC
 */
export async function handleCalendarAndTaskListSelection(taskInfo: any, senderId: string) {
    try {
        if (!googleManagerInstance) {
            throw new Error('Google Manager not initialized');
        }

        const taskType = taskInfo.taskType || categorizeTaskType(taskInfo.title || '');
        logger.info(`[Task] Smart selection for task type: ${taskType}`);

        // Smart logic: Only get what we need based on task type
        const needsCalendar = (taskType === 'calendar' || taskType === 'meeting');
        const needsTaskList = (taskType === 'task');

        // Get only the required lists
        let calendars = [], taskLists = [];

        if (needsCalendar) {
            calendars = await googleManagerInstance.getCalendars();
        }

        if (needsTaskList) {
            taskLists = await googleManagerInstance.getTaskLists();
        }

        // Format options only for what we need
        const calendarOptions = needsCalendar ? SelectionManager.formatCalendarOptions(calendars) : [];
        const taskListOptions = needsTaskList ? SelectionManager.formatTaskListOptions(taskLists) : [];        // Handle calendar selection only if needed
        if (needsCalendar && !taskInfo.calendarId) {
            // AUTO-SELECT PRIMARY CALENDAR - No user prompt needed
            const primaryCalendar = calendars.find(cal => cal.primary) || calendars.find(cal => cal.id === 'primary');
            if (primaryCalendar) {
                taskInfo.calendarId = primaryCalendar.id;
                logger.info(`[Calendar] Auto-selected primary calendar: ${primaryCalendar.summary || 'primary'}`);
            } else if (calendars.length > 0) {
                // Fallback to first available calendar
                taskInfo.calendarId = calendars[0].id;
                logger.info(`[Calendar] Auto-selected first available calendar: ${calendars[0].summary}`);
            } else {
                // Use 'primary' as final fallback
                taskInfo.calendarId = 'primary';
                logger.info('[Calendar] Using fallback primary calendar ID');
            }
        }        // Handle task list selection only if needed
        if (needsTaskList && !taskInfo.taskListId) {
            if (taskListOptions.length > 1) {
                // Add "Create New Task List" option
                const createNewOption = {
                    id: 'CREATE_NEW_TASKLIST',
                    name: '➕ Tạo Task List mới',
                    description: 'Tạo danh sách nhiệm vụ mới',
                    type: 'tasklist' as 'tasklist'
                };
                const enhancedOptions = [...taskListOptions, createNewOption];

                await selectionManager.promptSelection(senderId, enhancedOptions, 'tasklist', taskInfo);
                return; // Wait for user selection
            } else if (taskListOptions.length === 1) {
                taskInfo.taskListId = taskListOptions[0].id;
            } else {
                // Use default task list as fallback
                taskInfo.taskListId = '@default';
            }
        }

        // Skip unnecessary selections for the determined task type
        if (!needsCalendar) {
            logger.info('[Task] Skipping calendar selection for task type:', taskType);
        }
        if (!needsTaskList) {
            logger.info('[Task] Skipping task list selection for task type:', taskType);
        }

        // All selections made - create the task
        await createCompleteTask(taskInfo, senderId);

    } catch (error) {
        logger.error('[Task] Error in handleCalendarAndTaskListSelection:', error);
        await sendMessage(senderId, 'Lỗi khi kiểm tra calendar/task list. Vui lòng thử lại.');
    }
}

/**
 * Create complete task with all information and conflict detection
 */
async function createCompleteTask(taskInfo: any, senderId: string) {
    try {
        if (!googleManagerInstance) {
            throw new Error('Google Manager not initialized');
        }

        const { title, dueDate, dueTime } = taskInfo;

        // Use task type from taskInfo (from GoogleManager) or fall back to categorization
        const taskType = taskInfo.taskType || categorizeTaskType(title);
        logger.info(`[Task] Using task type: ${taskType}`, { title, taskType });

        // Extract additional fields for conflict detection
        const startTime = taskInfo.startTime || dueTime;
        const endTime = taskInfo.endTime;
        const location = taskInfo.location;
        const attendees = taskInfo.attendees;
        const description = taskInfo.description;

        // Check for schedule conflicts before creating the task
        if (dueDate && startTime && (taskType === 'calendar' || taskType === 'meeting')) {
            logger.info('[Task] Checking for schedule conflicts...');

            try {
                const conflictResult = await createTaskWithConflictCheck({
                    title,
                    dueDate,
                    dueTime: startTime,
                    endTime,
                    taskType,
                    location,
                    attendees,
                    description
                });

                if (!conflictResult.success && conflictResult.conflictInfo?.hasConflict) {
                    // Format conflict message
                    let conflictMsg = `⚠️ Phát hiện xung đột lịch trình:\n\n`;

                    conflictResult.conflictInfo.conflicts?.forEach((conflict: any, index: number) => {
                        const conflictTime = conflict.task.due_time ? ` lúc ${conflict.task.due_time}` : '';
                        conflictMsg += `${index + 1}. ${conflict.task.content}${conflictTime}\n`;
                    });

                    if (conflictResult.conflictInfo.suggestedTimes && conflictResult.conflictInfo.suggestedTimes.length > 0) {
                        conflictMsg += `\n💡 Đề xuất thời gian khác:\n`;
                        conflictResult.conflictInfo.suggestedTimes.forEach((time: string, index: number) => {
                            conflictMsg += `${index + 1}. ${time}\n`;
                        });
                        conflictMsg += `\nBạn có muốn tạo task với thời gian gốc không? Phản hồi "có" để tiếp tục hoặc "không" để hủy.`;
                    }

                    await sendMessage(senderId, conflictMsg);

                    // Store pending task with conflict info for user decision
                    googleManagerInstance.storePendingTask(senderId, {
                        ...taskInfo,
                        conflictInfo: conflictResult.conflictInfo,
                        awaitingConflictDecision: true
                    }, taskType);

                    return; // Wait for user decision
                }

                // No conflicts or successful creation - use the task ID from createTaskWithConflictCheck
                if (conflictResult.success && conflictResult.taskId) {
                    const taskId = conflictResult.taskId;
                    logger.info(`[Task] Created local task ID: ${taskId} (with conflict check)`);

                    // Continue with Google Calendar/Tasks creation...
                    await createGoogleIntegrations(taskInfo, taskId, taskType, senderId);
                } else {
                    throw new Error(conflictResult.error || 'Failed to create task');
                }

            } catch (conflictError) {
                logger.error('[Task] Error during conflict detection:', conflictError);
                // Fall back to normal task creation without conflict detection
                await createTaskWithoutConflictCheck(taskInfo, senderId, taskType);
            }
        } else {
            // No date/time or not a meeting/calendar event - create normally without conflict detection
            await createTaskWithoutConflictCheck(taskInfo, senderId, taskType);
        }

    } catch (error) {
        logger.error('[Task] Error in createCompleteTask:', error);
        await sendMessage(senderId, 'Lỗi khi tạo task hoàn chình. Vui lòng thử lại.');
    }
}

/**
 * Create task without conflict detection (fallback method)
 */
async function createTaskWithoutConflictCheck(taskInfo: any, senderId: string, taskType: string) {
    const { title, dueDate, dueTime } = taskInfo;

    // Insert to local DB with task type
    const stmt = db.prepare('INSERT INTO tasks (content, due_date, due_time, task_type, done, near_due_notified) VALUES (?, ?, ?, ?, 0, 0)');
    const info = stmt.run(title, dueDate, dueTime, taskType);
    const taskId = info.lastInsertRowid;

    logger.info(`[Task] Created local task ID: ${taskId} (fallback method)`);

    // Continue with Google integrations
    await createGoogleIntegrations(taskInfo, taskId, taskType, senderId);
}

/**
 * Handle Google Calendar and Google Tasks integrations
 */
async function createGoogleIntegrations(taskInfo: any, taskId: any, taskType: string, senderId: string) {
    try {
        if (!googleManagerInstance) {
            throw new Error('Google Manager not initialized');
        }

        const { title, dueDate, dueTime } = taskInfo;

        // Create Google Calendar event for calendar events and meetings
        let gcalEventId = null;
        if (taskType === 'calendar' || taskType === 'meeting') {
            try {
                logger.info('[Task] Creating Google Calendar event...', {
                    title: taskInfo.title,
                    dueDate: taskInfo.dueDate,
                    dueTime: taskInfo.dueTime,
                    calendarId: taskInfo.calendarId
                });

                const result = await googleManagerInstance.createCalendarEvent(taskInfo);

                logger.info('[Task] Google Calendar API response:', result);

                if (result.success && result.eventId) {
                    gcalEventId = result.eventId;
                    db.prepare('UPDATE tasks SET gcal_event_id = ? WHERE id = ?').run(gcalEventId, taskId);
                    logger.info(`[Task] ✅ Successfully created Google Calendar event: ${gcalEventId}`);
                } else {
                    logger.error('[Task] ❌ Failed to create Google Calendar event:', result.error);
                    // Still continue - local task created successfully
                    await sendMessage(senderId, `⚠️ Task created locally but Google Calendar sync failed: ${result.error}`);
                }
            } catch (gcalErr: any) {
                logger.error('[Task] ❌ Exception creating Google Calendar event:', {
                    error: gcalErr.message,
                    stack: gcalErr.stack,
                    taskInfo: { title: taskInfo.title, dueDate: taskInfo.dueDate, dueTime: taskInfo.dueTime }
                });
                // Still continue - local task created successfully  
                await sendMessage(senderId, `⚠️ Task created locally but Google Calendar sync error: ${gcalErr.message}`);
            }
        }

        // Create Google Task for regular tasks
        let gtaskId = null;
        if (taskType === 'task') {
            try {
                logger.info('[Task] Creating Google Task...', {
                    title: taskInfo.title,
                    dueDate: taskInfo.dueDate,
                    taskListId: taskInfo.taskListId
                });

                const result = await googleManagerInstance.createTask(taskInfo);

                logger.info('[Task] Google Tasks API response:', result);

                if (result.success && result.taskId) {
                    gtaskId = result.taskId;
                    // Note: We'd need to add a gtask_id column to store this
                    logger.info(`[Task] ✅ Successfully created Google Task: ${gtaskId}`);
                } else {
                    logger.error('[Task] ❌ Failed to create Google Task:', result.error);
                    // Still continue - local task created successfully
                    await sendMessage(senderId, `⚠️ Task created locally but Google Tasks sync failed: ${result.error}`);
                }
            } catch (gtaskErr: any) {
                logger.error('[Task] ❌ Exception creating Google Task:', {
                    error: gtaskErr.message,
                    stack: gtaskErr.stack,
                    taskInfo: { title: taskInfo.title, dueDate: taskInfo.dueDate }
                });
                // Still continue - local task created successfully
                await sendMessage(senderId, `⚠️ Task created locally but Google Tasks sync error: ${gtaskErr.message}`);
            }
        }

        // Send confirmation message with appropriate emoji and text
        const taskTypeEmojis: Record<string, string> = {
            'calendar': '📅',
            'meeting': '🤝',
            'task': '📝'
        };

        const taskTypeTexts: Record<string, string> = {
            'calendar': 'Sự kiện lịch',
            'meeting': 'Cuộc họp',
            'task': 'Task'
        };

        const emoji = taskTypeEmojis[taskType] || '📝';
        const typeText = taskTypeTexts[taskType] || 'Task';

        let reply = `✅ Đã tạo ${typeText.toLowerCase()} thành công:\n${emoji} ${title}`;
        if (dueDate) reply += `\n📅 Ngày: ${dueDate}`;
        if (dueTime) reply += `\n⏰ Giờ: ${dueTime}`;

        // Add additional info for meetings/calendar events
        if (taskInfo.location) reply += `\n📍 Địa điểm: ${taskInfo.location}`;
        if (taskInfo.attendees && taskInfo.attendees.length > 0) {
            reply += `\n👥 Người tham gia: ${taskInfo.attendees.join(', ')}`;
        }
        if (taskInfo.description && taskInfo.description.includes('[Google Meet requested]')) {
            reply += `\n💻 Google Meet link sẽ được tạo tự động`;
        }

        // Add categorization info
        reply += `\n🏷️ Loại: ${typeText}`;

        const synced = [];
        if (gcalEventId) synced.push('Google Calendar');
        if (gtaskId) synced.push('Google Tasks');
        if (synced.length > 0) {
            reply += `\n🔄 Đã đồng bộ: ${synced.join(', ')}`;
        }

        // Schedule reminder if task has due date/time
        if (dueDate) {
            try {
                reminderSystem.addReminder({
                    title,
                    dueDate,
                    dueTime,
                    description: taskInfo.description,
                    location: taskInfo.location
                }, senderId, taskId.toString(), taskType === 'calendar' || taskType === 'meeting' ? 'calendar' : 'task');
                reply += `\n⏰ Reminder đã được thiết lập`;
                logger.info(`[Task] Reminder scheduled for task ${taskId}`);
            } catch (reminderErr) {
                logger.error('[Task] Error scheduling reminder:', reminderErr);
                // Don't fail the task creation for reminder errors
            }
        }

        await sendMessage(senderId, reply);

    } catch (error) {
        logger.error('[Task] Error in createGoogleIntegrations:', error);
        await sendMessage(senderId, 'Lỗi khi tạo task hoàn chình. Vui lòng thử lại.');
    }
}

/**
 * Enhanced response handler for missing information with LLM context awareness
 */
export async function handleMissingInfoResponse(text: string, senderId: string) {
    try {
        if (!googleManagerInstance) return false;

        const pendingTask = googleManagerInstance.getPendingTask(senderId);
        if (!pendingTask) return false;

        // CRITICAL FIX: Check for cancel commands first
        const normalizedText = text.toLowerCase().trim();
        const cancelPatterns = [
            'không',
            'hủy',
            'huy',
            'cancel',
            '/cancel',
            'no',
            'n',
            'stop',
            'quit',
            'exit',
            'bỏ',
            'thôi'
        ];

        if (cancelPatterns.includes(normalizedText)) {
            logger.info(`[Task] Cancel command detected: "${text}"`);
            googleManagerInstance.clearPendingTask(senderId);
            llmParser.clearConversationContext(senderId);
            await sendMessage(senderId, '❌ Đã hủy bỏ việc tạo task.');
            return true;
        }

        // Use enhanced LLM parsing with conversation context
        let parsedResponse;
        try {
            // Check if this is a Google Meet confirmation response
            const contextText = llmParser.getConversationContext(senderId);
            if (contextText && contextText.toLowerCase().includes('google meet')) {
                // Handle Google Meet confirmation
                if (text.toLowerCase().includes('có') ||
                    text.toLowerCase().includes('yes') ||
                    text.toLowerCase().includes('đồng ý')) {

                    // Update description to include Google Meet request
                    const updatedInfo = googleManagerInstance.updatePendingTask(senderId,
                        `description: ${(pendingTask.description || '')} [Google Meet requested]`
                    );

                    // Complete task creation
                    await createCompleteTask(updatedInfo, senderId);
                    googleManagerInstance.clearPendingTask(senderId);
                    llmParser.clearConversationContext(senderId);
                    return true;
                } else {
                    // No Google Meet needed, just complete the task
                    await createCompleteTask(pendingTask, senderId);
                    googleManagerInstance.clearPendingTask(senderId);
                    llmParser.clearConversationContext(senderId);
                    return true;
                }
            }

            // Parse response using LLM for better understanding
            const llmResult = await llmParser.extractTaskFromNaturalLanguage(text, senderId);

            // Convert LLM result to update string format for GoogleManager
            let updateParts: string[] = [];

            if (llmResult.title && !pendingTask.title) {
                updateParts.push(`title: ${llmResult.title}`);
            }
            if (llmResult.date && !pendingTask.dueDate) {
                updateParts.push(`dueDate: ${llmResult.date}`);
            }
            if (llmResult.time && !pendingTask.dueTime) {
                updateParts.push(`dueTime: ${llmResult.time}`);
            }
            if (llmResult.description && !pendingTask.description) {
                updateParts.push(`description: ${llmResult.description}`);
            }
            if (llmResult.location && !pendingTask.location) {
                updateParts.push(`location: ${llmResult.location}`);
            }
            if ((llmResult.attendees.length > 0 || llmResult.emails.length > 0) && !pendingTask.attendees) {
                const allAttendees = [...llmResult.attendees, ...llmResult.emails];
                updateParts.push(`attendees: ${allAttendees.join(', ')}`);
            }

            // If no specific fields were extracted, treat as general content
            if (updateParts.length === 0) {
                // Determine what field is most likely missing and update it
                if (!pendingTask.title) {
                    updateParts.push(`title: ${text.trim()}`);
                } else if (!pendingTask.description) {
                    updateParts.push(`description: ${text.trim()}`);
                } else {
                    updateParts.push(`description: ${(pendingTask.description || '')} ${text.trim()}`);
                }
            }

            const updateString = updateParts.join(', ');
            logger.info('[Task] Updating pending task with:', updateString);

        } catch (llmError) {
            logger.warn('[Task] LLM parsing failed, using simple update:', llmError);
            // Fallback to simple text append
        }

        // Update the pending task with user response
        const updatedInfo = googleManagerInstance.updatePendingTask(senderId, text);

        // Check if we now have all required information
        const missingInfo = googleManagerInstance.checkMissingInfo(updatedInfo, updatedInfo.taskType);

        if (missingInfo) {
            // Still missing info, ask again with context
            llmParser.setConversationContext(senderId, missingInfo.message,
                `Creating ${updatedInfo.taskType}: ${updatedInfo.title || 'task'}`);
            await sendMessage(senderId, missingInfo.message);
            return true;
        }

        // All info complete - create the task
        await createCompleteTask(updatedInfo, senderId);
        googleManagerInstance.clearPendingTask(senderId);
        llmParser.clearConversationContext(senderId);
        return true;

    } catch (error) {
        logger.error('[Task] Error handling missing info response:', error);
        return false;
    }
}
