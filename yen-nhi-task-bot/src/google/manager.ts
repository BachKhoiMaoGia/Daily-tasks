/**
 * Google Manager - Quản lý tích hợp với Google Calendar và Tasks
 * Bao gồm tính năng hỏi thông tin thiếu từ Boss
 */
import { google } from 'googleapis';
import { config } from '../config/index';
import logger from '../utils/logger';
import { categorizeTaskType, ConflictResult } from '../utils/taskOperations';

export interface TaskInfo {
    title: string;
    description?: string;
    dueDate?: string; // YYYY-MM-DD
    dueTime?: string; // HH:mm
    startTime?: string; // HH:mm for ranges
    endTime?: string; // HH:mm for ranges
    priority?: 'low' | 'medium' | 'high';
    calendarId?: string;
    taskListId?: string;
    location?: string;
    attendees?: string[];
    taskType?: 'calendar' | 'task' | 'meeting';
}

export interface MissingInfo {
    fields: string[];
    message: string;
}

interface PendingTaskInfo extends Partial<TaskInfo> {
    taskType: 'calendar' | 'task' | 'meeting';
    awaitingConflictDecision?: boolean;
    conflictInfo?: ConflictResult;
    awaitingTaskInfoDecision?: boolean;
    awaitingCalendarSelection?: boolean;
    awaitingTaskListSelection?: boolean;
}

// Required fields for different types
const REQUIRED_FIELDS = {
    calendar: ['title', 'dueDate', 'dueTime'],
    task: ['title', 'dueDate'],
    meeting: ['title', 'dueDate', 'dueTime', 'attendees']
};

class GoogleManager {
    private oAuth2Client: any;
    private calendar: any;
    private tasks: any;
    private pendingTasks: Map<string, PendingTaskInfo> = new Map(); constructor() {
        const { clientId, clientSecret, redirectUri, refreshToken } = config.google;

        if (!clientId || !clientSecret || !refreshToken) {
            logger.error('[GoogleManager] Missing Google OAuth credentials in config');
            throw new Error('Google OAuth credentials not configured');
        }

        this.oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        this.oAuth2Client.setCredentials({ refresh_token: refreshToken });

        this.calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
        this.tasks = google.tasks({ version: 'v1', auth: this.oAuth2Client });

        logger.info('[GoogleManager] Google Manager initialized successfully');
    }    /**
     * Parse text và extract thông tin task/event - FIXED: Preserve original prefixes
     */
    parseTaskInfo(text: string): Partial<TaskInfo> {
        const info: Partial<TaskInfo> = {};
        const originalText = text.trim(); // Keep original for prefix preservation

        // Extract title (everything before date/time info)
        let title = text.trim();// Extract date patterns - improved Vietnamese support
        const datePatterns = [
            /(?:ngày\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/g, // DD/MM hoặc DD/MM/YYYY
            /(?:ngày\s+)?(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g, // YYYY/MM/DD
            /(?:hôm nay|today)/gi,
            /(?:ngày mai|mai|tomorrow)/gi,
            /(?:ngày kia|kia|day after tomorrow)/gi,
            /(?:tuần tới|tuần sau|next week)/gi,
            /(?:tháng tới|tháng sau|next month)/gi,
            /(?:thứ\s+(hai|ba|tư|năm|sáu|bảy|2|3|4|5|6|7))/gi, // thứ 2, thứ 3, etc.
            /(?:chủ\s*nhật|sunday)/gi
        ];        // Extract time patterns - ENHANCED: Support time ranges and better Vietnamese  
        const timePatterns = [
            // Time ranges: "9 giờ - 11 giờ sáng", "2pm - 4pm"
            /(\d{1,2})\s*(?:giờ|h)\s*-\s*(\d{1,2})\s*(?:giờ|h)\s*(sáng|chiều|tối|đêm|morning|afternoon|evening|night)?/gi,
            /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g, // HH:mm - HH:mm
            // Single times
            /(?:lúc\s+)?(\d{1,2}):(\d{2})/g, // HH:mm
            /(?:lúc\s+)?(\d{1,2})\s*(?:giờ|h)(?:\s*(\d{2})\s*(?:phút|m))?(?:\s+(chiều|pm))?/g, // X giờ Y phút (chiều)
            /(?:lúc\s+)?(\d{1,2})\s*(?:h|giờ)(?:\s+(chiều|pm))?/g, // 15h, 3giờ chiều
            /(\d{1,2})\s*(pm|am)/gi, // 3pm, 2am
            /(?:buổi\s+)?(?:sáng|morning)/gi,
            /(?:buổi\s+)?(?:chiều|afternoon)/gi,
            /(?:buổi\s+)?(?:tối|evening)/gi,
            /(?:buổi\s+)?(?:đêm|night)/gi,
            /(?:trưa|noon)/gi
        ];// Process date extraction
        let foundDate = false;
        for (const pattern of datePatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const match = matches[0];
                foundDate = true;

                if (pattern.source.includes('hôm nay|today')) {
                    info.dueDate = new Date().toISOString().slice(0, 10);
                } else if (pattern.source.includes('ngày mai|mai|tomorrow')) {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    info.dueDate = tomorrow.toISOString().slice(0, 10);
                } else if (pattern.source.includes('ngày kia|kia')) {
                    const dayAfter = new Date();
                    dayAfter.setDate(dayAfter.getDate() + 2);
                    info.dueDate = dayAfter.toISOString().slice(0, 10);
                } else if (pattern.source.includes('tuần tới|tuần sau|next week')) {
                    const nextWeek = new Date();
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    info.dueDate = nextWeek.toISOString().slice(0, 10);
                } else if (pattern.source.includes('tháng tới|tháng sau|next month')) {
                    const nextMonth = new Date();
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    info.dueDate = nextMonth.toISOString().slice(0, 10);
                } else if (pattern.source.includes('thứ')) {
                    // Handle Vietnamese weekdays
                    const weekdayText = match[1]?.toLowerCase();
                    let targetDay = 0;

                    if (weekdayText === 'hai' || weekdayText === '2') targetDay = 1; // Monday
                    else if (weekdayText === 'ba' || weekdayText === '3') targetDay = 2; // Tuesday
                    else if (weekdayText === 'tư' || weekdayText === '4') targetDay = 3; // Wednesday
                    else if (weekdayText === 'năm' || weekdayText === '5') targetDay = 4; // Thursday
                    else if (weekdayText === 'sáu' || weekdayText === '6') targetDay = 5; // Friday
                    else if (weekdayText === 'bảy' || weekdayText === '7') targetDay = 6; // Saturday

                    if (targetDay > 0) {
                        const today = new Date();
                        const currentDay = today.getDay();
                        const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7; // Next occurrence
                        const targetDate = new Date();
                        targetDate.setDate(today.getDate() + daysUntilTarget);
                        info.dueDate = targetDate.toISOString().slice(0, 10);
                    }
                } else if (pattern.source.includes('chủ\\s*nhật|sunday')) {
                    // Handle Sunday
                    const today = new Date();
                    const currentDay = today.getDay();
                    const daysUntilSunday = (7 - currentDay) % 7 || 7; // Next Sunday
                    const targetDate = new Date();
                    targetDate.setDate(today.getDate() + daysUntilSunday);
                    info.dueDate = targetDate.toISOString().slice(0, 10);
                } else if (match[1] && match[2]) {
                    // DD/MM or MM/DD format
                    const day = parseInt(match[1]);
                    const month = parseInt(match[2]);
                    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();

                    // Assume DD/MM format for Vietnamese context
                    if (day <= 31 && month <= 12) {
                        info.dueDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                    }
                }

                // Remove date from title
                title = title.replace(match[0], '').trim();
                break;
            }
        }        // Process time extraction - ENHANCED: Support time ranges and better Vietnamese
        let timeExtracted = false;
        for (const pattern of timePatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const match = matches[0];

                // Handle time ranges first - Enhanced logic
                if (pattern.source.includes('-') && match[1] && match[2]) {
                    if (pattern.source.includes('giờ|h')) {
                        // "9 giờ - 11 giờ sáng" format
                        const startHour = parseInt(match[1]);
                        const endHour = parseInt(match[2]);
                        const timeOfDay = match[3] ? match[3].toLowerCase() : '';

                        let finalStartHour = startHour;
                        let finalEndHour = endHour;

                        // Apply time of day modifier to both start and end
                        if (timeOfDay.includes('chiều') || timeOfDay.includes('afternoon')) {
                            // For afternoon times, convert if <= 12
                            if (startHour <= 12 && startHour !== 12) finalStartHour = startHour + 12;
                            if (startHour === 12) finalStartHour = 12; // 12 giờ chiều = 12:00 PM
                            if (endHour <= 12 && endHour !== 12) finalEndHour = endHour + 12;
                            if (endHour === 12) finalEndHour = 12;
                        } else if (timeOfDay.includes('tối') || timeOfDay.includes('evening')) {
                            // Evening: convert if <= 12
                            if (startHour <= 12) finalStartHour = startHour === 12 ? 12 : startHour + 12;
                            if (endHour <= 12) finalEndHour = endHour === 12 ? 12 : endHour + 12;
                        } else if (timeOfDay.includes('sáng') || timeOfDay.includes('morning')) {
                            // Morning: keep as is, but handle 12 AM case
                            if (startHour === 12) finalStartHour = 0; // 12 giờ sáng = 00:00
                            if (endHour === 12) finalEndHour = 0;
                        }

                        // Validate hours
                        if (finalStartHour >= 0 && finalStartHour <= 23 && finalEndHour >= 0 && finalEndHour <= 23) {
                            info.startTime = `${finalStartHour.toString().padStart(2, '0')}:00`;
                            info.endTime = `${finalEndHour.toString().padStart(2, '0')}:00`;
                            info.dueTime = info.startTime; // Use start time as main time
                            timeExtracted = true;
                        }
                    } else if (pattern.source.includes(':')) {
                        // "09:00 - 11:00" format
                        const startHour = parseInt(match[1]);
                        const startMin = parseInt(match[2]);
                        const endHour = parseInt(match[3]);
                        const endMin = parseInt(match[4]);

                        if (startHour <= 23 && startMin <= 59 && endHour <= 23 && endMin <= 59) {
                            info.startTime = `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
                            info.endTime = `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;
                            info.dueTime = info.startTime;
                            timeExtracted = true;
                        }
                    }
                }
                // Handle single times
                else if (match[1] && match[2] && pattern.source.includes(':')) {
                    // HH:mm format
                    const hour = parseInt(match[1]);
                    const minute = parseInt(match[2]);
                    if (hour <= 23 && minute <= 59) {
                        info.dueTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                        timeExtracted = true;
                    }
                } else if (match[1] && (pattern.source.includes('pm|am'))) {
                    // X pm/am format
                    let hour = parseInt(match[1]);
                    const isPM = match[2]?.toLowerCase() === 'pm';

                    if (isPM && hour !== 12) hour += 12;
                    else if (!isPM && hour === 12) hour = 0;

                    if (hour >= 0 && hour <= 23) {
                        info.dueTime = `${hour.toString().padStart(2, '0')}:00`;
                        timeExtracted = true;
                    }
                } else if (match[1] && (pattern.source.includes('giờ|h'))) {
                    // X giờ Y phút format with optional chiều/pm - Enhanced
                    const hour = parseInt(match[1]);
                    const minute = match[2] ? parseInt(match[2]) : 0;

                    // Look for time of day modifiers in multiple capture groups
                    let timeOfDay = '';
                    for (let i = 2; i < match.length; i++) {
                        if (match[i] && /chiều|sáng|tối|đêm|pm|am|morning|afternoon|evening|night/i.test(match[i])) {
                            timeOfDay = match[i].toLowerCase();
                            break;
                        }
                    }

                    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                        let finalHour = hour;

                        // Handle time of day modifiers more accurately
                        if (timeOfDay.includes('chiều') || timeOfDay.includes('pm')) {
                            if (hour <= 12 && hour !== 12) finalHour = hour + 12;
                            else if (hour === 12) finalHour = 12; // 12 giờ chiều = 12:00 PM
                        } else if (timeOfDay.includes('tối') || timeOfDay.includes('evening')) {
                            if (hour <= 12) finalHour = hour === 12 ? 12 : hour + 12;
                        } else if (timeOfDay.includes('sáng') || timeOfDay.includes('morning')) {
                            if (hour === 12) finalHour = 0; // 12 giờ sáng = 00:00
                        } else if (timeOfDay.includes('đêm') || timeOfDay.includes('night')) {
                            if (hour <= 12) finalHour = hour === 12 ? 0 : hour + 12;
                        }

                        if (finalHour >= 0 && finalHour <= 23) {
                            info.dueTime = `${finalHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                            timeExtracted = true;
                        }
                    }
                } else if (pattern.source.includes('sáng|morning')) {
                    info.dueTime = '09:00';
                    timeExtracted = true;
                } else if (pattern.source.includes('chiều|afternoon')) {
                    info.dueTime = '14:00';
                    timeExtracted = true;
                } else if (pattern.source.includes('tối|evening')) {
                    info.dueTime = '19:00';
                    timeExtracted = true;
                } else if (pattern.source.includes('đêm|night')) {
                    info.dueTime = '21:00';
                    timeExtracted = true;
                } else if (pattern.source.includes('trưa|noon')) {
                    info.dueTime = '12:00';
                    timeExtracted = true;
                }

                // Only remove time from title if we successfully extracted a time
                if (timeExtracted) {
                    title = title.replace(match[0], '').trim();
                    break;
                }
            }
        }// Extract meeting attendees - ENHANCED: Better Vietnamese name handling with multiple patterns
        const attendeePatterns = [
            // Pattern 1: "với Ms./Mr./Vietnamese titles + Name"
            /(?:với|with)\s+((?:Ms\.|Mr\.|Mrs\.|Dr\.|Bà|Ông|Anh|Chị|Em)\s+[^\s,@\d\n]+(?:\s+[^\s,@\d\n]+)*)/gi,
            // Pattern 2: "với" + name before time/location indicators
            /(?:với|with)\s+([^\s,@\d\n]+(?:\s+[^\s,@\d\n]+)*?)(?:\s+(?:lúc|vào|tại|@|\d|chiều|sáng|tối|giờ))/gi,
            // Pattern 3: "team/nhóm" + team name
            /(?:team|nhóm)\s+([^,\n@\d]+?)(?:\s+(?:email|lúc|vào|tại|@|\d))?/gi,
            // Pattern 4: Email addresses
            /(?:email:|@|gửi\s+cho)\s*([^\s,\n]+@[^\s,\n]+)/gi,
            // Pattern 5: Multiple people separated by "và"/"and" 
            /(?:cho|với|and)\s+([^@\d\n]+?)\s+và\s+([^@\d\n]+?)(?:\s+(?:email|lúc|@))/gi,
            // Pattern 6: Just email format
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
            // Pattern 7: Vietnamese names with conjunctions
            /(?:gửi\s+cho|với)\s+([^@\d\n,]+?)(?:\s+(?:và|,)\s+([^@\d\n,]+?))*(?:\s+email)/gi
        ];

        const attendees: string[] = [];

        // Handle special patterns first
        // Handle "cho Chị Lan và Ông Minh email: ..." format
        const multipleAttendeeMatch = text.match(/(?:cho|với)\s+([^@\d\n]+?)\s+email:/gi);
        if (multipleAttendeeMatch) {
            const beforeEmail = multipleAttendeeMatch[0].replace(/(?:cho|với)\s+/gi, '').replace(/\s+email:/gi, '');
            const names = beforeEmail.split(/\s+và\s+|\s*,\s*/);
            names.forEach(name => {
                const cleanName = name.trim();
                if (cleanName && cleanName.length > 1) {
                    attendees.push(cleanName);
                }
            });
        }

        // Process all other patterns
        for (const pattern of attendeePatterns) {
            const matches = [...text.matchAll(pattern)];
            for (const match of matches) {
                // Handle multiple captures for "và" pattern
                if (pattern.source.includes('và')) {
                    if (match[1]) attendees.push(match[1].trim());
                    if (match[2]) attendees.push(match[2].trim());
                } else if (match[1]) {
                    const attendeeName = match[1].trim();
                    // Validate attendee name
                    if (attendeeName &&
                        attendeeName.length > 1 &&
                        !/\d{1,2}[\/\-]\d{1,2}|ngày|giờ|lúc|chiều|sáng|tối|tomorrow|today|mai|hôm|phút/i.test(attendeeName) &&
                        !attendees.includes(attendeeName)) {
                        attendees.push(attendeeName);
                    }
                }
            }
        }        // Process attendee names but keep them in title for full context
        if (attendees.length > 0) {
            const cleanedAttendees = attendees
                .map(name => name.trim())
                .filter(name => name.length > 1)
                .filter((name, index, arr) => arr.indexOf(name) === index); // Remove duplicates

            info.attendees = cleanedAttendees;

            // Keep attendees in title for complete context as requested
            // Only remove email addresses from title to avoid clutter
            title = title.replace(/\s*email:\s*[^\s,]+@[^\s,]+(?:\s*,\s*[^\s,]+@[^\s,]+)*/gi, '');
            title = title.replace(/[^\s]+@[^\s,]+(?:\s*,\s*[^\s,]+@[^\s,]+)*/gi, ''); // Remove standalone emails
        }

        // Remove email patterns from title - more comprehensive cleaning
        title = title.replace(/\s*email:\s*[^\s,]+@[^\s,]+(?:\s*,\s*[^\s,]+@[^\s,]+)*/gi, '');
        title = title.replace(/\s*@\s*[^\s,]+@[^\s,]+/gi, '');
        title = title.replace(/\s+el:\s*/gi, ' '); // Clean up broken "email:" patterns
        title = title.replace(/[^\s]+@[^\s,]+(?:\s*,\s*[^\s,]+@[^\s,]+)*/gi, ''); // Remove standalone emails
        title = title.replace(/\s+/g, ' ').trim(); // Clean up multiple spaces// Extract location - ENHANCED: Better pattern matching and Google Maps support
        const locationPatterns = [
            /(?:tại|at|ở)\s+(.+?)(?=\s*$|\s+(?:lúc|vào|ngày|hôm|tomorrow|today|mai))/gi, // Everything until time/date
            /(?:phòng|room)\s+(.+?)(?=\s*$|\s+(?:lúc|vào|ngày|hôm|tomorrow|today|mai))/gi, // Room + everything after
            /(?:địa\s*chỉ|address):\s*(.+?)(?=\s*$|\s+(?:lúc|vào|ngày|hôm|tomorrow|today|mai))/gi, // Explicit address
            /(?:văn\s*phòng|office)\s+(.+?)(?=\s*$|\s+(?:lúc|vào|ngày|hôm|tomorrow|today|mai))/gi // Office location
        ];

        for (const pattern of locationPatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const match = matches[0];
                if (match[1] && match[1].trim()) {
                    info.location = match[1].trim();

                    // Check if it looks like a full address for Google Maps
                    if (info.location.includes('Tầng') || info.location.includes('Tòa') ||
                        info.location.includes('Phố') || info.location.includes('Quận') ||
                        info.location.includes('Street') || info.location.includes('District')) {
                        // Could add Google Maps link in description
                        const mapsUrl = `https://maps.google.com/maps?q=${encodeURIComponent(info.location)}`;
                        info.description = (info.description || '') + ` [Bản đồ: ${mapsUrl}]`;
                    }

                    title = title.replace(match[0], '').trim();
                    break;
                }
            }
        }

        // Extract description
        const descriptionPatterns = [
            /(?:mô tả|note|ghi chú|description):?\s*([^,\n]+)/gi,
            /(?:chi tiết|details?):?\s*([^,\n]+)/gi
        ];

        for (const pattern of descriptionPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                info.description = match[1].trim();
                title = title.replace(match[0], '').trim();
                break;
            }
        }        // Check for Google Meet request - ENHANCED: Multiple detection patterns
        const meetPatterns = [
            /google\s*meet/gi,
            /meet\s*link/gi,
            /video\s*call/gi,
            /họp\s*online/gi,
            /online\s*meeting/gi,
            /zoom\s*meeting/gi, // Also handle Zoom requests
            /teams\s*meeting/gi, // Handle Teams requests
            /cuộc\s*họp\s*trực\s*tuyến/gi
        ];

        let meetingType = '';
        for (const pattern of meetPatterns) {
            if (pattern.test(text)) {
                if (pattern.source.includes('google|meet')) {
                    meetingType = 'Google Meet';
                } else if (pattern.source.includes('zoom')) {
                    meetingType = 'Zoom';
                } else if (pattern.source.includes('teams')) {
                    meetingType = 'Microsoft Teams';
                } else {
                    meetingType = 'Google Meet'; // Default to Google Meet
                }
                break;
            }
        }

        if (meetingType) {
            const meetNote = meetingType === 'Google Meet' ?
                '[Google Meet will be auto-generated]' :
                `[${meetingType} requested - manual setup needed]`;
            info.description = (info.description || '') + ` ${meetNote}`;
        }        // Clean up title and preserve important prefixes
        // Extract prefixes like [Meeting], [Task], etc. from original text only
        const prefixMatch = originalText.match(/^(\[[\w\s]+\]\s*)/);
        const preservedPrefix = prefixMatch ? prefixMatch[1] : '';

        // Start with the title that has been processed by all the extraction logic
        let finalTitle = title;

        // Remove any duplicate prefixes that might have been added during processing
        if (preservedPrefix) {
            const prefixRegex = new RegExp(preservedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            finalTitle = finalTitle.replace(prefixRegex, '').trim();
        }

        // Clean up the title
        finalTitle = finalTitle.replace(/\s+/g, ' ').trim();

        // If we have a meaningful title, combine with prefix
        if (finalTitle && finalTitle.length > 0) {
            info.title = preservedPrefix + finalTitle;
        } else {
            // Fallback: extract title from original text, excluding prefix and known patterns
            let fallbackTitle = originalText;
            if (prefixMatch) {
                fallbackTitle = fallbackTitle.replace(prefixMatch[0], '');
            }

            // Remove time patterns but preserve attendee information like "With Ms. Hoàng Dung"
            fallbackTitle = fallbackTitle.replace(/\d{1,2}\s*giờ\s*-\s*\d{1,2}\s*giờ.*$/gi, ''); // Remove time ranges
            fallbackTitle = fallbackTitle.replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}.*$/gi, ''); // Remove time ranges
            fallbackTitle = fallbackTitle.replace(/\s*lúc\s+\d{1,2}\s*giờ.*$/gi, ''); // Remove "lúc X giờ" patterns
            fallbackTitle = fallbackTitle.replace(/\s*vào\s+\d{1,2}:\d{2}.*$/gi, ''); // Remove "vào X:XX" patterns
            fallbackTitle = fallbackTitle.replace(/\s*ngày\s+mai$/gi, ''); // Remove "ngày mai"
            fallbackTitle = fallbackTitle.replace(/\s*hôm\s+nay$/gi, ''); // Remove "hôm nay"
            fallbackTitle = fallbackTitle.replace(/email:\s*[^,\s]+@[^,\s]+.*$/gi, ''); // Remove email patterns
            fallbackTitle = fallbackTitle.trim();

            info.title = preservedPrefix + (fallbackTitle || 'Untitled');
        }

        // Categorize task type based on original text - this was missing!
        info.taskType = categorizeTaskType(originalText);

        logger.info(`[GoogleManager] Title extraction - Original: "${originalText}", Final: "${info.title}"`);

        return info;
    }    /**
     * Kiểm tra thông tin thiếu dựa trên loại task
     */
    checkMissingInfo(taskInfo: Partial<TaskInfo>, type: 'calendar' | 'task' | 'meeting' = 'task'): MissingInfo | null {
        const required = REQUIRED_FIELDS[type];
        const missing: string[] = [];

        for (const field of required) {
            if (!taskInfo[field as keyof TaskInfo] ||
                (Array.isArray(taskInfo[field as keyof TaskInfo]) &&
                    (taskInfo[field as keyof TaskInfo] as any[]).length === 0)) {
                missing.push(field);
            }
        }

        if (missing.length === 0) return null;

        // Tạo câu hỏi theo tiếng Việt
        const fieldNames: { [key: string]: string } = {
            title: 'tiêu đề/nội dung',
            dueDate: 'ngày thực hiện',
            dueTime: 'giờ thực hiện',
            attendees: 'người tham gia',
            location: 'địa điểm',
            description: 'mô tả chi tiết'
        };

        const missingNames = missing.map(field => fieldNames[field] || field);
        let message = '';

        // Customize message based on task type
        if (type === 'meeting') {
            message = `🤖 Để tạo cuộc họp, Boss cần bổ sung thông tin: ${missingNames.join(', ')}.\n\n`;
        } else if (type === 'calendar') {
            message = `🤖 Để tạo sự kiện lịch, Boss cần bổ sung thông tin: ${missingNames.join(', ')}.\n\n`;
        } else {
            message = `🤖 Để tạo task, Boss cần bổ sung thông tin: ${missingNames.join(', ')}.\n\n`;
        }

        if (missing.includes('dueDate')) {
            message += '📅 Ngày: Nhập theo định dạng DD/MM/YYYY hoặc "hôm nay", "ngày mai"\n';
        }
        if (missing.includes('dueTime')) {
            if (type === 'meeting' || type === 'calendar') {
                message += '⏰ Giờ bắt đầu: Nhập theo định dạng HH:mm hoặc "9 giờ sáng", "2 giờ chiều"\n';
            } else {
                message += '⏰ Giờ deadline: Nhập theo định dạng HH:mm hoặc "9 giờ sáng", "2 giờ chiều"\n';
            }
        }
        if (missing.includes('attendees')) {
            message += '👥 Người tham gia: Nhập tên hoặc email (ví dụ: "john@gmail.com" hoặc "Anh Nam, chị Lan")\n';
        }
        if (missing.includes('location')) {
            message += '📍 Địa điểm: Nhập địa chỉ hoặc tên phòng (ví dụ: "Phòng họp A1" hoặc "123 Nguyễn Du")\n';
        }        // Add additional suggestions based on task type
        if (type === 'meeting') {
            // Check if Google Meet is mentioned in the task description
            const hasMeetLink = taskInfo.description?.includes('[Google Meet') || false;
            if (!hasMeetLink) {
                message += '\n🎥 Boss có muốn tạo Google Meet link cho cuộc họp này không?\n';
                message += '💡 Trả lời "có" hoặc thêm "google meet" vào tin nhắn tiếp theo để tự động tạo link.';
            } else {
                message += '\n💡 Gợi ý: Google Meet link sẽ được tự động tạo cho cuộc họp này.';
            }
        }

        return { fields: missing, message };
    }/**
     * Lưu task tạm thời và chờ thông tin bổ sung
     */
    storePendingTask(userId: string, taskInfo: Partial<TaskInfo>, taskType: 'calendar' | 'task' | 'meeting' = 'task'): void {
        const pendingInfo: PendingTaskInfo = {
            ...taskInfo,
            taskType
        };
        this.pendingTasks.set(userId, pendingInfo);
        logger.info(`[GoogleManager] Stored pending task for user ${userId}:`, pendingInfo);
    }    /**
     * Get pending task for user
     */
    getPendingTask(userId: string): PendingTaskInfo | undefined {
        return this.pendingTasks.get(userId);
    }

    /**
     * Check if user has pending task
     */
    hasPendingTask(userId: string): boolean {
        return this.pendingTasks.has(userId);
    }    /**
     * Cập nhật thông tin task đang pending
     */
    updatePendingTask(userId: string, additionalInfo: string): PendingTaskInfo {
        const existing = this.pendingTasks.get(userId);
        if (!existing) {
            throw new Error(`No pending task found for user ${userId}`);
        }

        const newInfo = this.parseTaskInfo(additionalInfo);
        const merged: PendingTaskInfo = {
            ...existing,
            ...newInfo,
            taskType: existing.taskType // Preserve original task type
        };

        this.pendingTasks.set(userId, merged);
        logger.info(`[GoogleManager] Updated pending task for user ${userId}:`, merged);
        return merged;
    }    /**
     * Xóa pending task
     */
    clearPendingTask(userId: string): void {
        this.pendingTasks.delete(userId);
        logger.info(`[GoogleManager] Cleared pending task for user ${userId}`);
    }

    /**
     * Set pending task (similar to storePendingTask but more generic)
     */
    setPendingTask(userId: string, taskInfo: Partial<TaskInfo>): void {
        const pendingInfo: PendingTaskInfo = {
            ...taskInfo,
            taskType: (taskInfo.taskType as 'calendar' | 'task' | 'meeting') || 'task'
        };
        this.pendingTasks.set(userId, pendingInfo);
        logger.info(`[GoogleManager] Set pending task for user ${userId}:`, pendingInfo);
    }

    /**
     * Lấy danh sách calendars
     */
    async getCalendars(): Promise<any[]> {
        try {
            const response = await this.calendar.calendarList.list();
            return response.data.items || [];
        } catch (error) {
            logger.error('Error fetching calendars:', error);
            return [];
        }
    }

    /**
     * Lấy danh sách task lists
     */
    async getTaskLists(): Promise<any[]> {
        try {
            const response = await this.tasks.tasklists.list();
            return response.data.items || [];
        } catch (error) {
            logger.error('Error fetching task lists:', error);
            return [];
        }
    }    /**
     * Tạo event trong Google Calendar với hỗ trợ Google Meet và time ranges
     */
    async createCalendarEvent(taskInfo: TaskInfo): Promise<{ success: boolean; eventId?: string; error?: string }> {
        try {
            // Validate required fields
            if (!taskInfo.title) {
                return { success: false, error: 'Missing title' };
            }
            if (!taskInfo.dueDate) {
                return { success: false, error: 'Missing due date' };
            }
            if (!taskInfo.dueTime) {
                return { success: false, error: 'Missing due time' };
            }

            const isGoogleMeetRequested = taskInfo.description?.includes('[Google Meet will be auto-generated]');

            // Calculate start and end times - Enhanced for time ranges
            let startTime = taskInfo.dueTime;
            let endTime = taskInfo.endTime;

            // If no end time specified, default to 1 hour later
            if (!endTime) {
                endTime = this.addHour(startTime);
            }

            // Use startTime if available, otherwise use dueTime
            if (taskInfo.startTime) {
                startTime = taskInfo.startTime;
            }

            const event: any = {
                summary: taskInfo.title,
                description: taskInfo.description?.replace(' [Google Meet will be auto-generated]', '').replace(' [Google Meet requested]', '') || '',
                start: {
                    dateTime: `${taskInfo.dueDate}T${startTime}:00`,
                    timeZone: 'Asia/Ho_Chi_Minh',
                },
                end: {
                    dateTime: `${taskInfo.dueDate}T${endTime}:00`,
                    timeZone: 'Asia/Ho_Chi_Minh',
                }, location: taskInfo.location, attendees: taskInfo.attendees?.filter(attendee => {
                    // Only include valid email addresses
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return emailRegex.test(attendee.trim());
                }).map(attendee => ({
                    email: attendee.trim()
                })),
            };

            // Add Google Meet if requested
            if (isGoogleMeetRequested) {
                event.conferenceData = {
                    createRequest: {
                        requestId: `meet-${Date.now()}`,
                        conferenceSolutionKey: {
                            type: 'hangoutsMeet'
                        }
                    }
                };
            }

            logger.info('[GoogleManager] Creating calendar event with data:', {
                summary: event.summary,
                start: event.start,
                end: event.end,
                calendarId: taskInfo.calendarId || 'primary',
                hasGoogleMeet: isGoogleMeetRequested,
                location: event.location,
                attendeesCount: event.attendees?.length || 0
            });

            const response = await this.calendar.events.insert({
                calendarId: taskInfo.calendarId || 'primary',
                requestBody: event,
                conferenceDataVersion: isGoogleMeetRequested ? 1 : 0, // Required for Meet link
            });

            logger.info('[GoogleManager] Calendar event created successfully:', {
                eventId: response.data.id,
                htmlLink: response.data.htmlLink,
                meetLink: response.data.conferenceData?.entryPoints?.[0]?.uri
            });

            return { success: true, eventId: response.data.id };

        } catch (error: any) {
            logger.error('[GoogleManager] Error creating calendar event:', {
                error: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                taskInfo: {
                    title: taskInfo.title,
                    dueDate: taskInfo.dueDate,
                    dueTime: taskInfo.dueTime,
                    startTime: taskInfo.startTime,
                    endTime: taskInfo.endTime,
                    calendarId: taskInfo.calendarId
                }
            });

            // Handle specific error cases
            if (error.code === 401) {
                return { success: false, error: 'Authentication failed - refresh token may be expired' };
            } else if (error.code === 403) {
                return { success: false, error: 'Permission denied - check Google Calendar API scopes' };
            } else if (error.code === 400) {
                return { success: false, error: `Invalid request: ${error.message}` };
            } else if (error.code === 404) {
                return { success: false, error: 'Calendar not found - check calendarId' };
            } else {
                return { success: false, error: `Google Calendar API error: ${error.message}` };
            }
        }
    }/**
     * Tạo task trong Google Tasks
     */
    async createTask(taskInfo: TaskInfo): Promise<{ success: boolean; taskId?: string; error?: string }> {
        try {
            // Validate required fields
            if (!taskInfo.title) {
                return { success: false, error: 'Missing title' };
            }

            const task = {
                title: taskInfo.title,
                notes: taskInfo.description,
                due: taskInfo.dueDate ? `${taskInfo.dueDate}T00:00:00.000Z` : undefined,
            };

            logger.info('[GoogleManager] Creating task with data:', {
                title: task.title,
                due: task.due,
                taskListId: taskInfo.taskListId || '@default'
            });

            const response = await this.tasks.tasks.insert({
                tasklist: taskInfo.taskListId || '@default',
                requestBody: task,
            });

            logger.info('[GoogleManager] Task created successfully:', {
                taskId: response.data.id,
                title: response.data.title,
                status: response.data.status
            });

            return { success: true, taskId: response.data.id };

        } catch (error: any) {
            logger.error('[GoogleManager] Error creating task:', {
                error: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                taskInfo: {
                    title: taskInfo.title,
                    dueDate: taskInfo.dueDate,
                    taskListId: taskInfo.taskListId
                }
            });

            // Handle specific error cases
            if (error.code === 401) {
                return { success: false, error: 'Authentication failed - refresh token may be expired' };
            } else if (error.code === 403) {
                return { success: false, error: 'Permission denied - check Google Tasks API scopes' };
            } else if (error.code === 400) {
                return { success: false, error: `Invalid request: ${error.message}` };
            } else if (error.code === 404) {
                return { success: false, error: 'Task list not found - check taskListId' };
            } else {
                return { success: false, error: `Google Tasks API error: ${error.message}` };
            }
        }
    }/**
     * Lấy danh sách tasks từ Google Tasks
     */
    async getTasks(taskListId: string = '@default'): Promise<any[]> {
        try {
            const response = await this.tasks.tasks.list({
                tasklist: taskListId,
                showCompleted: false,
                showHidden: false
            });
            return response.data.items || [];
        } catch (error) {
            logger.error('Error fetching Google Tasks:', error);
            return [];
        }
    }/**
     * Helper: Thêm 1 giờ vào thời gian
     */
    private addHour(time: string): string {
        const [hours, minutes] = time.split(':').map(Number);
        const newHours = (hours + 1) % 24;
        return `${newHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
}

export { GoogleManager };
export default new GoogleManager();