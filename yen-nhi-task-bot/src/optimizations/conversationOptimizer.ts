/**
 * Conversational Flow Optimizer
 * Reduces conversation steps through smart defaults and field inference
 */
import logger from '../utils/logger.js';

interface ConversationState {
    userId: string;
    currentTask: Partial<TaskData>;
    missingFields: string[];
    conversationHistory: string[];
    inferenceAttempts: number;
    smartDefaults: SmartDefaults;
    timestamp: number;
}

interface TaskData {
    title: string;
    date: string;
    time: string;
    attendees: string[];
    location: string;
    description: string;
    type: 'calendar' | 'task';
}

interface SmartDefaults {
    defaultTime?: string;
    defaultDuration?: number;
    preferredMeetingType?: string;
    workingHours?: { start: string; end: string };
    timeZone?: string;
}

interface InferenceResult {
    field: string;
    value: string;
    confidence: number;
    reasoning: string;
    success: boolean;
}

class ConversationalFlowOptimizer {
    private conversationStates = new Map<string, ConversationState>();
    private readonly MAX_INFERENCE_ATTEMPTS = 3;
    private readonly MIN_CONFIDENCE_THRESHOLD = 0.7;

    // Smart default patterns based on context
    private defaultInferenceRules = [
        {
            field: 'time',
            rules: [
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('standup'),
                    value: '09:00',
                    confidence: 0.8,
                    reasoning: 'Standup meetings typically at 9 AM'
                },
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('lunch'),
                    value: '12:00',
                    confidence: 0.9,
                    reasoning: 'Lunch meetings typically at noon'
                },
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('review'),
                    value: '14:00',
                    confidence: 0.7,
                    reasoning: 'Review meetings typically in afternoon'
                }
            ]
        },
        {
            field: 'location',
            rules: [
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('remote'),
                    value: 'Google Meet',
                    confidence: 0.85,
                    reasoning: 'Remote indicates online meeting'
                },
                {
                    condition: (task: Partial<TaskData>) => task.attendees && task.attendees.length > 5,
                    value: 'Conference Room',
                    confidence: 0.7,
                    reasoning: 'Large meetings need conference room'
                }
            ]
        },
        {
            field: 'date',
            rules: [
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('urgent'),
                    value: new Date().toISOString().split('T')[0], // Today
                    confidence: 0.8,
                    reasoning: 'Urgent tasks scheduled for today'
                },
                {
                    condition: (task: Partial<TaskData>) => task.title?.toLowerCase().includes('weekly'),
                    value: this.getNextWeekday(1), // Next Monday
                    confidence: 0.75,
                    reasoning: 'Weekly meetings typically on Monday'
                }
            ]
        }
    ];

    // Context patterns for field inference
    private contextInferencePatterns = [
        {
            field: 'time',
            patterns: [
                { regex: /sáng/i, value: '09:00', confidence: 0.6 },
                { regex: /chiều/i, value: '14:00', confidence: 0.6 },
                { regex: /tối/i, value: '19:00', confidence: 0.6 },
                { regex: /morning/i, value: '09:00', confidence: 0.6 },
                { regex: /afternoon/i, value: '14:00', confidence: 0.6 },
                { regex: /evening/i, value: '18:00', confidence: 0.6 }
            ]
        },
        {
            field: 'date',
            patterns: [
                { regex: /hôm nay|today/i, value: () => new Date().toISOString().split('T')[0], confidence: 0.9 },
                { regex: /ngày mai|tomorrow/i, value: () => this.getTomorrow(), confidence: 0.9 },
                { regex: /tuần sau|next week/i, value: () => this.getNextWeek(), confidence: 0.8 }
            ]
        },
        {
            field: 'location',
            patterns: [
                { regex: /zoom/i, value: 'Zoom Meeting', confidence: 0.9 },
                { regex: /teams/i, value: 'Microsoft Teams', confidence: 0.9 },
                { regex: /google meet/i, value: 'Google Meet', confidence: 0.9 },
                { regex: /phòng (\w+)/i, value: (match: RegExpMatchArray) => `Phòng ${match[1]}`, confidence: 0.8 }
            ]
        }
    ];

    /**
     * Optimize conversation flow by reducing required questions
     */
    public optimizeConversationFlow(
        userId: string,
        initialMessage: string,
        parsedTask: Partial<TaskData>
    ): { optimizedTask: Partial<TaskData>; questionsToAsk: string[]; confidence: number } {

        // Get or create conversation state
        let state = this.conversationStates.get(userId);
        if (!state) {
            state = this.createNewConversationState(userId, parsedTask);
            this.conversationStates.set(userId, state);
        }

        // Update current task with new information
        state.currentTask = { ...state.currentTask, ...parsedTask };
        state.conversationHistory.push(initialMessage);

        // Apply smart defaults and inference
        const inferenceResults = this.applySmartInference(state);

        // Calculate missing fields after inference
        const missingFields = this.calculateMissingFields(state.currentTask);

        // Generate optimized questions
        const questionsToAsk = this.generateOptimizedQuestions(missingFields, state);

        // Calculate overall confidence
        const confidence = this.calculateOptimizationConfidence(inferenceResults, missingFields);

        logger.info(`[Flow Optimizer] Reduced questions from ${this.getAllRequiredFields().length} to ${questionsToAsk.length}`);

        return {
            optimizedTask: state.currentTask,
            questionsToAsk,
            confidence
        };
    }

    /**
     * Apply smart inference to fill missing fields
     */
    private applySmartInference(state: ConversationState): InferenceResult[] {
        const results: InferenceResult[] = [];

        if (state.inferenceAttempts >= this.MAX_INFERENCE_ATTEMPTS) {
            return results;
        }

        state.inferenceAttempts++;

        // Try rule-based inference
        for (const ruleSet of this.defaultInferenceRules) {
            if (state.currentTask[ruleSet.field as keyof TaskData]) continue; // Field already has value

            for (const rule of ruleSet.rules) {
                if (rule.condition(state.currentTask)) {
                    const result: InferenceResult = {
                        field: ruleSet.field,
                        value: typeof rule.value === 'function' ? (rule.value as Function)() : rule.value,
                        confidence: rule.confidence,
                        reasoning: rule.reasoning,
                        success: rule.confidence >= this.MIN_CONFIDENCE_THRESHOLD
                    };

                    if (result.success) {
                        (state.currentTask as any)[ruleSet.field] = result.value;
                        logger.info(`[Flow Optimizer] Inferred ${ruleSet.field}: ${result.value} (${result.reasoning})`);
                    }

                    results.push(result);
                    break;
                }
            }
        }

        // Try context-based inference from conversation history
        const contextResults = this.applyContextInference(state);
        results.push(...contextResults);

        return results;
    }

    /**
     * Apply context-based inference from conversation history
     */
    private applyContextInference(state: ConversationState): InferenceResult[] {
        const results: InferenceResult[] = [];
        const fullContext = state.conversationHistory.join(' ');

        for (const patternSet of this.contextInferencePatterns) {
            if (state.currentTask[patternSet.field as keyof TaskData]) continue;

            for (const pattern of patternSet.patterns) {
                const match = fullContext.match(pattern.regex);
                if (match) {
                    const value = typeof pattern.value === 'function' ? pattern.value(match) : pattern.value;

                    const result: InferenceResult = {
                        field: patternSet.field,
                        value,
                        confidence: pattern.confidence,
                        reasoning: `Inferred from conversation context: "${match[0]}"`,
                        success: pattern.confidence >= this.MIN_CONFIDENCE_THRESHOLD
                    };

                    if (result.success) {
                        (state.currentTask as any)[patternSet.field] = result.value;
                        logger.info(`[Flow Optimizer] Context inferred ${patternSet.field}: ${result.value}`);
                    }

                    results.push(result);
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Generate optimized questions that reduce conversation steps
     */
    private generateOptimizedQuestions(missingFields: string[], state: ConversationState): string[] {
        const questions: string[] = [];

        // Group related fields into single questions
        const fieldGroups = this.groupRelatedFields(missingFields);

        for (const group of fieldGroups) {
            if (group.fields.length === 1) {
                questions.push(this.generateSingleFieldQuestion(group.fields[0], state));
            } else {
                questions.push(this.generateMultiFieldQuestion(group.fields, state));
            }
        }

        return questions;
    }

    /**
     * Group related fields to ask in single question
     */
    private groupRelatedFields(fields: string[]): { fields: string[]; priority: number }[] {
        const groups = [];

        // Time and date often go together
        const timeFields = fields.filter(f => ['date', 'time'].includes(f));
        if (timeFields.length > 1) {
            groups.push({ fields: timeFields, priority: 1 });
            fields = fields.filter(f => !timeFields.includes(f));
        }

        // Attendees and location can be grouped
        const peopleFields = fields.filter(f => ['attendees', 'location'].includes(f));
        if (peopleFields.length > 1) {
            groups.push({ fields: peopleFields, priority: 2 });
            fields = fields.filter(f => !peopleFields.includes(f));
        }

        // Remaining fields individually
        for (const field of fields) {
            groups.push({ fields: [field], priority: 3 });
        }

        return groups.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Generate question for single field
     */
    private generateSingleFieldQuestion(field: string, state: ConversationState): string {
        const questionTemplates = {
            date: 'Khi nào bạn muốn lên lịch? (ví dụ: hôm nay, ngày mai, 15/6)',
            time: 'Mấy giờ? (ví dụ: 9:00, 14:30)',
            attendees: 'Ai sẽ tham gia? (tên hoặc email)',
            location: 'Ở đâu? (địa điểm hoặc Zoom/Teams)',
            description: 'Có ghi chú gì thêm không?'
        };

        return questionTemplates[field as keyof typeof questionTemplates] || `Vui lòng cung cấp ${field}`;
    }

    /**
     * Generate question for multiple fields
     */
    private generateMultiFieldQuestion(fields: string[], state: ConversationState): string {
        if (fields.includes('date') && fields.includes('time')) {
            return 'Khi nào? (ví dụ: hôm nay 14:00, ngày mai 9:30)';
        }

        if (fields.includes('attendees') && fields.includes('location')) {
            return 'Ai tham gia và ở đâu? (ví dụ: John, Mary tại phòng họp A1)';
        }

        return `Vui lòng cung cấp: ${fields.join(', ')}`;
    }

    /**
     * Calculate missing fields for a task
     */
    private calculateMissingFields(task: Partial<TaskData>): string[] {
        const requiredFields = ['title']; // Only title is truly required
        const optionalFields = ['date', 'time', 'attendees', 'location'];

        const missing: string[] = [];

        // Check required fields
        for (const field of requiredFields) {
            if (!task[field as keyof TaskData] || (task[field as keyof TaskData] as any) === '') {
                missing.push(field);
            }
        }

        // For calendar events, we typically want date and time
        if (task.type === 'calendar') {
            if (!task.date) missing.push('date');
            if (!task.time) missing.push('time');
        }

        return missing;
    }

    /**
     * Get all required fields for comparison
     */
    private getAllRequiredFields(): string[] {
        return ['title', 'date', 'time', 'attendees', 'location', 'description'];
    }

    /**
     * Calculate optimization confidence
     */
    private calculateOptimizationConfidence(
        inferenceResults: InferenceResult[],
        remainingMissingFields: string[]
    ): number {
        const totalPossibleFields = this.getAllRequiredFields().length;
        const inferredFields = inferenceResults.filter(r => r.success).length;
        const avgInferenceConfidence = inferenceResults.length > 0
            ? inferenceResults.reduce((sum, r) => sum + r.confidence, 0) / inferenceResults.length
            : 0;

        const reductionRate = 1 - (remainingMissingFields.length / totalPossibleFields);

        return Math.min(0.95, (reductionRate * 0.7) + (avgInferenceConfidence * 0.3));
    }

    /**
     * Create new conversation state
     */
    private createNewConversationState(userId: string, initialTask: Partial<TaskData>): ConversationState {
        return {
            userId,
            currentTask: { ...initialTask },
            missingFields: [],
            conversationHistory: [],
            inferenceAttempts: 0,
            smartDefaults: this.getUserSmartDefaults(userId),
            timestamp: Date.now()
        };
    }

    /**
     * Get user's smart defaults
     */
    private getUserSmartDefaults(userId: string): SmartDefaults {
        // This would typically come from user preferences storage
        return {
            defaultTime: '09:00',
            defaultDuration: 60,
            preferredMeetingType: 'google_meet',
            workingHours: { start: '08:00', end: '18:00' },
            timeZone: 'Asia/Ho_Chi_Minh'
        };
    }

    /**
     * Utility functions for date calculations
     */
    private getTomorrow(): string {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }

    private getNextWeek(): string {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
    }

    private getNextWeekday(dayOfWeek: number): string {
        const date = new Date();
        const days = (dayOfWeek + 7 - date.getDay()) % 7;
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }

    /**
     * Clean up old conversation states
     */
    public cleanupOldStates(): void {
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

        for (const [userId, state] of this.conversationStates.entries()) {
            if (state.timestamp < cutoffTime) {
                this.conversationStates.delete(userId);
            }
        }
    }

    /**
     * Get conversation statistics
     */
    public getConversationStats(): any {
        const states = Array.from(this.conversationStates.values());

        return {
            activeConversations: states.length,
            avgInferenceAttempts: states.length > 0
                ? states.reduce((sum, s) => sum + s.inferenceAttempts, 0) / states.length
                : 0,
            avgConversationLength: states.length > 0
                ? states.reduce((sum, s) => sum + s.conversationHistory.length, 0) / states.length
                : 0
        };
    }

    /**
     * Update user response and continue optimization
     */
    public processUserResponse(
        userId: string,
        response: string,
        askedField: string
    ): { updatedTask: Partial<TaskData>; nextQuestions: string[]; isComplete: boolean } {

        const state = this.conversationStates.get(userId);
        if (!state) {
            throw new Error('No active conversation state found');
        }

        // Parse the response and update task
        const parsedValue = this.parseFieldResponse(response, askedField);
        if (parsedValue) {
            (state.currentTask as any)[askedField] = parsedValue;
        }

        state.conversationHistory.push(response);

        // Apply additional inference with new context
        this.applySmartInference(state);

        // Check if conversation is complete
        const missingFields = this.calculateMissingFields(state.currentTask);
        const isComplete = missingFields.length === 0;

        const nextQuestions = isComplete ? [] : this.generateOptimizedQuestions(missingFields, state);

        return {
            updatedTask: state.currentTask,
            nextQuestions,
            isComplete
        };
    }

    /**
     * Parse user response for specific field
     */
    private parseFieldResponse(response: string, field: string): string | null {
        const cleanResponse = response.trim();

        switch (field) {
            case 'date':
                return this.parseDateResponse(cleanResponse);
            case 'time':
                return this.parseTimeResponse(cleanResponse);
            case 'attendees':
                return cleanResponse; // Keep as is, will be processed later
            case 'location':
                return cleanResponse;
            case 'description':
                return cleanResponse;
            default:
                return cleanResponse;
        }
    }

    private parseDateResponse(response: string): string {
        if (/hôm nay|today/i.test(response)) {
            return new Date().toISOString().split('T')[0];
        }
        if (/ngày mai|tomorrow/i.test(response)) {
            return this.getTomorrow();
        }
        // Add more date parsing logic as needed
        return response;
    }

    private parseTimeResponse(response: string): string {
        const timeMatch = response.match(/(\d{1,2})[:\.]?(\d{0,2})/);
        if (timeMatch) {
            const hours = timeMatch[1];
            const minutes = timeMatch[2] || '00';
            return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
        }
        return response;
    }
}

export default new ConversationalFlowOptimizer();
