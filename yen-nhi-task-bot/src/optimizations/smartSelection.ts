/**
 * Smart Calendar / Task Selection with User Preference Learning
 * Automatically choose the right calendar / task list based on patterns and user habits
 */
import logger from '../utils/logger.js';

interface SelectionResult {
    calendarId?: string;
    taskListId?: string;
    confidence: number;
    reasoning: string;
    autoSelected: boolean;
}

interface UserPreference {
    userId: string;
    patterns: {
        [pattern: string]: {
            calendarId?: string;
            taskListId?: string;
            count: number;
            lastUsed: number;
        }
    };
    defaultCalendar?: string;
    defaultTaskList?: string;
    totalSelections: number;
}

class SmartSelectionManager {
    private userPreferences = new Map<string, UserPreference>();
    private readonly PATTERN_CONFIDENCE_THRESHOLD = 0.8;
    private readonly MIN_PATTERN_OCCURRENCES = 3;

    // Default patterns for auto-selection
    private selectionPatterns = [
        // Work-related patterns
        {
            pattern: /\b(họp|meeting|standup|review|demo|project)\b/i,
            type: 'calendar',
            reasoning: 'Work meeting pattern - prefer calendar',
            confidence: 0.85
        },
        // Personal tasks
        {
            pattern: /\b(mua|shopping|ăn|uống|personal|cá nhân)\b/i,
            type: 'task',
            reasoning: 'Personal task pattern - prefer task list',
            confidence: 0.8
        },
        // Time-sensitive events
        {
            pattern: /\b(\d{1,2}:\d{2}|\d{1,2}h\d{0,2}|appointment|cuộc hẹn)\b/i,
            type: 'calendar',
            reasoning: 'Time-specific event - prefer calendar',
            confidence: 0.9
        },
        // Deadline-based tasks
        {
            pattern: /\b(deadline|nộp|submit|hoàn thành|finish)\b/i,
            type: 'task',
            reasoning: 'Deadline-based task - prefer task list',
            confidence: 0.85
        },
        // Location-based events
        {
            pattern: /\b(tại|ở|phòng|zoom|teams|google meet)\b/i,
            type: 'calendar',
            reasoning: 'Location-specific event - prefer calendar',
            confidence: 0.8
        }
    ];

    /**
     * Smart selection based on message content and user patterns
     */
    public async selectSmartTarget(
        message: string,
        userId: string,
        availableCalendars: any[],
        availableTaskLists: any[]
    ): Promise<SelectionResult> {
        // Get user preferences
        const userPref = this.getUserPreferences(userId);

        // Try pattern-based selection
        const patternResult = this.selectByPattern(message, userPref);
        if (patternResult.confidence >= this.PATTERN_CONFIDENCE_THRESHOLD) {
            return this.applySelectionToAvailable(patternResult, availableCalendars, availableTaskLists);
        }

        // Try user habit-based selection
        const habitResult = this.selectByUserHabits(message, userPref);
        if (habitResult.confidence >= 0.7) {
            return this.applySelectionToAvailable(habitResult, availableCalendars, availableTaskLists);
        }

        // Fallback to content analysis
        const contentResult = this.selectByContentAnalysis(message);
        return this.applySelectionToAvailable(contentResult, availableCalendars, availableTaskLists);
    }

    /**
     * Learn from user selection for future improvements
     */
    public learnFromUserSelection(
        userId: string,
        message: string,
        selectedCalendarId?: string,
        selectedTaskListId?: string
    ): void {
        const userPref = this.getUserPreferences(userId);
        const messagePattern = this.extractPattern(message);

        if (messagePattern) {
            if (!userPref.patterns[messagePattern]) {
                userPref.patterns[messagePattern] = {
                    count: 0,
                    lastUsed: Date.now()
                };
            }

            const pattern = userPref.patterns[messagePattern];
            pattern.count++;
            pattern.lastUsed = Date.now();

            if (selectedCalendarId) {
                pattern.calendarId = selectedCalendarId;
            }
            if (selectedTaskListId) {
                pattern.taskListId = selectedTaskListId;
            }
        }

        // Update defaults if this is a frequent choice
        userPref.totalSelections++;
        if (selectedCalendarId && this.shouldUpdateDefault(userPref, 'calendar', selectedCalendarId)) {
            userPref.defaultCalendar = selectedCalendarId;
        }
        if (selectedTaskListId && this.shouldUpdateDefault(userPref, 'task', selectedTaskListId)) {
            userPref.defaultTaskList = selectedTaskListId;
        }

        logger.info(`[Smart Selection] Learned pattern for user ${userId}: ${messagePattern}`);
    }

    /**
     * Select based on predefined patterns
     */
    private selectByPattern(message: string, userPref: UserPreference): SelectionResult {
        for (const pattern of this.selectionPatterns) {
            if (pattern.pattern.test(message)) {
                return {
                    calendarId: pattern.type === 'calendar' ? userPref.defaultCalendar : undefined,
                    taskListId: pattern.type === 'task' ? userPref.defaultTaskList : undefined,
                    confidence: pattern.confidence,
                    reasoning: pattern.reasoning,
                    autoSelected: true
                };
            }
        }

        return {
            confidence: 0,
            reasoning: 'No pattern match found',
            autoSelected: false
        };
    }

    /**
     * Select based on user habits and learned patterns
     */
    private selectByUserHabits(message: string, userPref: UserPreference): SelectionResult {
        const messagePattern = this.extractPattern(message);

        if (messagePattern && userPref.patterns[messagePattern]) {
            const pattern = userPref.patterns[messagePattern];

            if (pattern.count >= this.MIN_PATTERN_OCCURRENCES) {
                return {
                    calendarId: pattern.calendarId,
                    taskListId: pattern.taskListId,
                    confidence: Math.min(0.95, 0.6 + (pattern.count * 0.1)),
                    reasoning: `Learned from user habit (${pattern.count} times)`,
                    autoSelected: true
                };
            }
        }

        // Check for similar patterns
        const similarPattern = this.findSimilarPattern(message, userPref);
        if (similarPattern) {
            return {
                calendarId: similarPattern.calendarId,
                taskListId: similarPattern.taskListId,
                confidence: 0.65,
                reasoning: 'Similar pattern from user history',
                autoSelected: true
            };
        }

        return {
            confidence: 0,
            reasoning: 'No user habit match found',
            autoSelected: false
        };
    }    /**
     * Select based on content analysis
     */
    private selectByContentAnalysis(message: string): SelectionResult {
        const hasTimeReference = /\b(\d{1,2}:\d{2}|\d{1,2}h\d{0,2}|sáng|chiều|tối)\b/i.test(message);
        const hasLocationReference = /\b(tại|ở|phòng|zoom|teams|google meet)\b/i.test(message);
        const hasAttendeeReference = /\b(với|cùng|họp|meeting)\b/i.test(message);

        if (hasTimeReference || hasLocationReference || hasAttendeeReference) {
            return {
                calendarId: 'primary', // Default to primary calendar for events
                confidence: 0.7,
                reasoning: 'Content suggests calendar event (time/location/attendees)',
                autoSelected: true
            };
        }

        const hasTaskReference = /\b(làm|hoàn thành|deadline|nộp|submit|task|nhiệm vụ)\b/i.test(message);
        if (hasTaskReference) {
            return {
                taskListId: '@default', // Default to default task list for tasks
                confidence: 0.65,
                reasoning: 'Content suggests task (action/deadline)',
                autoSelected: true
            };
        }

        return {
            confidence: 0.5,
            reasoning: 'Neutral content - requires user selection',
            autoSelected: false
        };
    }

    /**
     * Apply selection to available calendars/task lists
     */
    private applySelectionToAvailable(
        result: SelectionResult,
        availableCalendars: any[],
        availableTaskLists: any[]
    ): SelectionResult {
        // Find matching calendar
        if (result.calendarId) {
            const calendar = availableCalendars.find(cal => cal.id === result.calendarId);
            if (!calendar && availableCalendars.length > 0) {
                // Fallback to primary calendar
                const primary = availableCalendars.find(cal => cal.primary) || availableCalendars[0];
                result.calendarId = primary.id;
                result.reasoning += ' (fallback to primary calendar)';
                result.confidence *= 0.8;
            }
        }

        // Find matching task list
        if (result.taskListId) {
            const taskList = availableTaskLists.find(list => list.id === result.taskListId);
            if (!taskList && availableTaskLists.length > 0) {
                // Fallback to default task list
                result.taskListId = availableTaskLists[0].id;
                result.reasoning += ' (fallback to default task list)';
                result.confidence *= 0.8;
            }
        }

        return result;
    }    /**
     * Extract pattern from message for learning
     */
    private extractPattern(message: string): string {
        if (!message || typeof message !== 'string') {
            return '';
        }
        const normalized = message.toLowerCase().trim();

        // Extract key words and create pattern
        const keywords = normalized.match(/\b(họp|meeting|task|làm|gặp|call|gọi|nộp|deadline|submit)\b/g);
        if (keywords && keywords.length > 0) {
            return keywords.join('-');
        }

        // Fallback to first few words
        const words = normalized.split(' ').slice(0, 3);
        return words.join('-');
    }    /**
     * Find similar pattern from user history
     */
    private findSimilarPattern(message: string, userPref: UserPreference): any {
        if (!message || typeof message !== 'string') {
            return null;
        }
        const messageWords = message.toLowerCase().split(' ');

        for (const [pattern, data] of Object.entries(userPref.patterns)) {
            const patternWords = pattern.split('-');
            const commonWords = messageWords.filter(word => patternWords.includes(word));

            if (commonWords.length >= 2 && data.count >= this.MIN_PATTERN_OCCURRENCES) {
                return data;
            }
        }

        return null;
    }

    /**
     * Check if we should update default selection
     */
    private shouldUpdateDefault(userPref: UserPreference, type: 'calendar' | 'task', selectedId: string): boolean {
        const threshold = Math.max(5, userPref.totalSelections * 0.3);

        // Count selections for this ID
        let count = 0;
        for (const pattern of Object.values(userPref.patterns)) {
            if (type === 'calendar' && pattern.calendarId === selectedId) count++;
            if (type === 'task' && pattern.taskListId === selectedId) count++;
        }

        return count >= threshold;
    }

    /**
     * Get user preferences, create if not exists
     */
    private getUserPreferences(userId: string): UserPreference {
        if (!this.userPreferences.has(userId)) {
            this.userPreferences.set(userId, {
                userId,
                patterns: {},
                totalSelections: 0
            });
        }
        return this.userPreferences.get(userId)!;
    }

    /**
     * Get selection statistics for monitoring
     */
    public getSelectionStats(): any {
        const stats = {
            totalUsers: this.userPreferences.size,
            totalPatterns: 0,
            autoSelectionRate: 0,
            avgPatternsPerUser: 0
        };

        let totalAutoSelections = 0;
        let totalSelections = 0; for (const userPref of Array.from(this.userPreferences.values())) {
            const patternCount = Object.keys(userPref.patterns).length;
            stats.totalPatterns += patternCount;
            totalSelections += userPref.totalSelections;

            // Count auto-selections (patterns with enough occurrences)
            for (const pattern of Object.values(userPref.patterns)) {
                const patternData = pattern as any;
                if (patternData.count >= this.MIN_PATTERN_OCCURRENCES) {
                    totalAutoSelections += patternData.count;
                }
            }
        }

        if (stats.totalUsers > 0) {
            stats.avgPatternsPerUser = stats.totalPatterns / stats.totalUsers;
        }
        if (totalSelections > 0) {
            stats.autoSelectionRate = totalAutoSelections / totalSelections;
        }

        return stats;
    }

    /**
     * Export user preferences for backup
     */
    public exportPreferences(): any {
        return Array.from(this.userPreferences.entries()).map(([userId, pref]) => ({
            userId,
            patterns: pref.patterns,
            defaultCalendar: pref.defaultCalendar,
            defaultTaskList: pref.defaultTaskList,
            totalSelections: pref.totalSelections
        }));
    }

    /**
     * Import user preferences from backup
     */
    public importPreferences(data: any[]): void {
        for (const item of data) {
            this.userPreferences.set(item.userId, item);
        }
        logger.info(`[Smart Selection] Imported preferences for ${data.length} users`);
    }
}

export default new SmartSelectionManager();
