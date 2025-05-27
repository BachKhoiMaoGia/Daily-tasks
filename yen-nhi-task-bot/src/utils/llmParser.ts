/**
 * Enhanced LLM-based flexible response parser
 * Uses OpenAI/GitHub Models to parse user responses more intelligently
 * with context awareness and better natural language understanding
 */
import { config } from '../config/index.js';
import logger from './logger.js';

interface LLMParseResult {
    intent: 'date' | 'time' | 'confirm' | 'cancel' | 'skip' | 'content' | 'unclear';
    extractedValue?: string;
    confidence: number;
    reasoning?: string;
}

interface TaskExtractionResult {
    title: string;
    attendees: string[];
    emails: string[];
    location?: string;
    date?: string;
    time?: string;
    description?: string;
    meetingType?: 'google_meet' | 'zoom' | 'teams' | 'in_person';
    confidence: number;
    reasoning: string;
}

class LLMParser {
    private isEnabled: boolean;
    private conversationContext: Map<string, { lastQuestion?: string; context?: string; timestamp: number }> = new Map();

    constructor() {
        this.isEnabled = !!config.openaiApiKey && config.useLLM;
        if (!this.isEnabled) {
            logger.warn('[LLM Parser] OpenAI API key not found or LLM disabled, falling back to regex parsing');
        }
    }

    /**
     * Enhanced natural language task extraction with context awareness
     */
    async extractTaskFromNaturalLanguage(userMessage: string, userId?: string): Promise<TaskExtractionResult> {
        if (!this.isEnabled) {
            return this.fallbackTaskExtraction(userMessage);
        }

        try {
            const prompt = this.createTaskExtractionPrompt(userMessage, userId);

            const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: config.openaiModelId,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an expert Vietnamese task management assistant. Extract task information intelligently, preserving all context and understanding natural language nuances. Always respond with valid JSON only.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                throw new Error(`LLM API error: ${response.status} - ${await response.text()}`);
            }

            const data = await response.json();
            const result = JSON.parse(data.choices[0].message.content);

            logger.info('[LLM Parser] Successfully extracted task from natural language:', {
                userMessage,
                result,
                model: config.openaiModelId,
                apiProvider: config.openaiBaseUrl.includes('github') ? 'GitHub Models' : 'OpenAI'
            });

            return result;
        } catch (error) {
            logger.error('[LLM Parser] Error extracting task with LLM API:', {
                error: error instanceof Error ? error.message : String(error),
                model: config.openaiModelId,
                apiProvider: config.openaiBaseUrl.includes('github') ? 'GitHub Models' : 'OpenAI'
            });
            return this.fallbackTaskExtraction(userMessage);
        }
    }

    /**
     * Set conversation context for better follow-up understanding
     */
    setConversationContext(userId: string, question: string, context?: string): void {
        this.conversationContext.set(userId, {
            lastQuestion: question,
            context,
            timestamp: Date.now()
        });
    }    /**
     * Clear conversation context
     */
    clearConversationContext(userId: string): void {
        this.conversationContext.delete(userId);
    }

    /**
     * Get conversation context
     */
    getConversationContext(userId: string): string | undefined {
        const ctx = this.conversationContext.get(userId);
        return ctx ? ctx.context || ctx.lastQuestion : undefined;
    }

    /**
     * Enhanced response parsing with conversation context
     */
    async parseResponseWithContext(userMessage: string, expectedType: 'date' | 'time' | 'content', userId?: string, context?: string): Promise<LLMParseResult> {
        if (!this.isEnabled) {
            return this.fallbackParse(userMessage, expectedType);
        }

        // Get conversation context
        let conversationCtx = '';
        if (userId) {
            const ctx = this.conversationContext.get(userId);
            if (ctx && (Date.now() - ctx.timestamp) < 300000) { // 5 minutes
                conversationCtx = `Previous question: "${ctx.lastQuestion}"\nContext: ${ctx.context || 'Task creation in progress'}`;
            }
        }

        try {
            const prompt = this.createContextualPrompt(userMessage, expectedType, context, conversationCtx);

            const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: config.openaiModelId,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful Vietnamese assistant that understands conversation context and can parse user responses intelligently. Always respond with valid JSON only.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 200
                })
            });

            if (!response.ok) {
                throw new Error(`LLM API error: ${response.status} - ${await response.text()}`);
            }

            const data = await response.json();
            const result = JSON.parse(data.choices[0].message.content);

            logger.info('[LLM Parser] Successfully parsed contextual response:', {
                userMessage,
                expectedType,
                conversationCtx,
                result,
                model: config.openaiModelId,
                apiProvider: config.openaiBaseUrl.includes('github') ? 'GitHub Models' : 'OpenAI'
            });

            return result;
        } catch (error) {
            logger.error('[LLM Parser] Error parsing contextual response with LLM API:', {
                error: error instanceof Error ? error.message : String(error),
                userMessage,
                expectedType,
                conversationCtx
            });
            return this.fallbackParse(userMessage, expectedType);
        }
    }    /**
     * Create task extraction prompt for natural language processing
     */
    private createTaskExtractionPrompt(userMessage: string, userId?: string): string {
        return `Extract task information from this Vietnamese natural language message.

User message: "${userMessage}"

Instructions:
- Extract task title preserving all important context (e.g., "Họp meeting" should remain in title)
- Identify attendees from Vietnamese names, titles (Anh, Chị, Ông, Bà, Ms., Mr.)
- Extract email addresses as separate attendees automatically
- Detect meeting types: google_meet, zoom, teams, in_person
- Parse Vietnamese dates/times: "hôm nay", "ngày mai", "21 giờ tối nay", "thứ 2"
- Preserve location information
- Understand context like "Họp meeting cùng Dung hntd99@gmail.com lúc 21 giờ tối nay"

Examples:
Input: "Họp meeting cùng Dung hntd99@gmail.com lúc 21 giờ tối nay"
→ {
  "title": "Họp meeting cùng Dung",
  "attendees": ["Dung"],
  "emails": ["hntd99@gmail.com"],
  "time": "21:00",
  "date": "today",
  "meetingType": "google_meet",
  "confidence": 0.9,
  "reasoning": "Meeting with attendee and email detected"
}

Input: "Nhắc tôi báo cáo tiến độ project vào thứ 6"
→ {
  "title": "Báo cáo tiến độ project",
  "attendees": [],
  "emails": [],
  "date": "next_friday",
  "confidence": 0.9,
  "reasoning": "Task reminder with specific date"
}

Respond with JSON only:
{
  "title": "extracted title with full context",
  "attendees": ["name1", "name2"],
  "emails": ["email1@domain.com"],
  "location": "extracted location if any",
  "date": "extracted date or relative date",
  "time": "HH:MM format if found",
  "description": "additional details if any",
  "meetingType": "google_meet|zoom|teams|in_person or null",
  "confidence": 0.8,
  "reasoning": "explanation of extraction"
}`;
    }

    /**
     * Create contextual prompt for follow-up responses
     */
    private createContextualPrompt(userMessage: string, expectedType: string, context?: string, conversationCtx?: string): string {
        return `Parse this Vietnamese user response considering conversation context.

Expected type: ${expectedType}
${context ? `Context: ${context}` : ''}
${conversationCtx ? `Conversation: ${conversationCtx}` : ''}
User response: "${userMessage}"

Instructions:
- Consider conversation context when parsing responses
- Understand follow-up responses like "có" (yes), "không" (no), "được" (okay)
- Handle Vietnamese confirmations in context
- For simple responses, use conversation context to determine intent

Examples with context:
Previous question: "Bạn có muốn tạo Google Meet link không?"
User response: "có" → {"intent": "confirm", "confidence": 0.9}

Previous question: "Nhập giờ họp (VD: 15:00):"
User response: "21 giờ tối" → {"intent": "time", "extractedValue": "21:00", "confidence": 0.9}

Previous question: "Nhập ngày họp:"
User response: "mai" → {"intent": "date", "extractedValue": "tomorrow", "confidence": 0.9}

Respond with JSON only:
{
  "intent": "date|time|confirm|cancel|skip|content|unclear",
  "extractedValue": "extracted value if any",
  "confidence": 0.8,
  "reasoning": "brief explanation considering context"
}`;
    }

    /**
     * Fallback task extraction using regex patterns
     */
    private fallbackTaskExtraction(userMessage: string): TaskExtractionResult {
        const result: TaskExtractionResult = {
            title: userMessage.trim(),
            attendees: [],
            emails: [],
            confidence: 0.5,
            reasoning: 'Fallback regex extraction'
        };

        // Extract emails
        const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        const emailMatches = userMessage.match(emailPattern);
        if (emailMatches) {
            result.emails = emailMatches;
            result.title = result.title.replace(emailPattern, '').trim();
        }

        // Extract basic Vietnamese names with titles
        const namePattern = /(?:với|cùng)\s+((?:Anh|Chị|Ông|Bà|Ms\.|Mr\.|Dr\.)\s+[A-Za-zÀ-ỹ\s]+?)(?:\s|$|@)/gi;
        const nameMatches = userMessage.match(namePattern);
        if (nameMatches) {
            result.attendees = nameMatches.map(match =>
                match.replace(/(?:với|cùng)\s+/gi, '').trim()
            );
        }

        // Basic time extraction
        const timePattern = /(\d{1,2})\s*giờ\s*(tối|chiều|sáng)?/i;
        const timeMatch = userMessage.match(timePattern);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const period = timeMatch[2]?.toLowerCase();

            if (period === 'tối' && hour < 12) hour += 12;
            else if (period === 'chiều' && hour < 12 && hour !== 12) hour += 12;

            result.time = `${hour.toString().padStart(2, '0')}:00`;
        }

        // Basic date extraction
        if (/hôm nay|today/i.test(userMessage)) {
            result.date = new Date().toISOString().split('T')[0];
        } else if (/ngày mai|mai|tomorrow/i.test(userMessage)) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            result.date = tomorrow.toISOString().split('T')[0];
        }

        return result;
    }    /**
     * Parse user response using LLM for better flexibility (backward compatibility)
     */
    async parseResponse(userMessage: string, expectedType: 'date' | 'time' | 'content', context?: string): Promise<LLMParseResult> {
        return this.parseResponseWithContext(userMessage, expectedType, undefined, context);
    }

    /**
     * Create structured prompt for LLM parsing
     */
    private createPrompt(userMessage: string, expectedType: string, context?: string): string {
        const examples = this.getExamples(expectedType);

        return `Parse this Vietnamese user response for a task management bot.

Expected type: ${expectedType}
${context ? `Context: ${context}` : ''}
User message: "${userMessage}"

Instructions:
- Determine the user's intent and extract relevant information
- Handle Vietnamese language nuances and informal expressions
- Recognize variations like "không", "chưa biết", "skip", "hủy", "cancel"
- For dates: Convert to YYYY-MM-DD format, handle relative dates like "hôm nay", "ngày mai", "thứ 2"
- For times: Convert to HH:MM 24-hour format, handle "sáng", "chiều", "tối"
- For content: Extract the main task description

Examples:
${examples}

Respond with JSON only:
{
  "intent": "date|time|confirm|cancel|skip|content|unclear",
  "extractedValue": "extracted value if any",
  "confidence": 0.8,
  "reasoning": "brief explanation"
}`;
    }

    /**
     * Get examples for different types
     */
    private getExamples(expectedType: string): string {
        const examples = {
            date: `
Input: "ngày mai" → {"intent": "date", "extractedValue": "tomorrow", "confidence": 0.9}
Input: "thứ 2" → {"intent": "date", "extractedValue": "next_monday", "confidence": 0.9}
Input: "15/6" → {"intent": "date", "extractedValue": "2025-06-15", "confidence": 0.9}
Input: "chưa biết" → {"intent": "skip", "confidence": 0.9}`,

            time: `
Input: "3 giờ chiều" → {"intent": "time", "extractedValue": "15:00", "confidence": 0.9}
Input: "9h30" → {"intent": "time", "extractedValue": "09:30", "confidence": 0.9}
Input: "sáng" → {"intent": "time", "extractedValue": "09:00", "confidence": 0.7}
Input: "không cụ thể" → {"intent": "skip", "confidence": 0.9}`,

            content: `
Input: "Họp với khách hàng" → {"intent": "content", "extractedValue": "Họp với khách hàng", "confidence": 0.9}
Input: "ok" → {"intent": "confirm", "confidence": 0.8}
Input: "hủy" → {"intent": "cancel", "confidence": 0.9}`
        };

        return examples[expectedType as keyof typeof examples] || '';
    }

    /**
     * Fallback parsing using regex (original logic)
     */
    private fallbackParse(userMessage: string, expectedType: string): LLMParseResult {
        const message = userMessage.toLowerCase().trim();

        // Check for cancel/skip intents first
        if (/không|chưa|sau|skip|no|cancel|hủy|bỏ/i.test(message)) {
            return {
                intent: message.includes('hủy') || message.includes('cancel') ? 'cancel' : 'skip',
                confidence: 0.8,
                reasoning: 'Detected skip/cancel keywords'
            };
        }

        // Check for confirmation
        if (/ok|được|đồng ý|yes|xác nhận|đúng/i.test(message)) {
            return {
                intent: 'confirm',
                confidence: 0.8,
                reasoning: 'Detected confirmation keywords'
            };
        }

        switch (expectedType) {
            case 'date':
                return this.parseDate(message);
            case 'time':
                return this.parseTime(message);
            case 'content':
                return {
                    intent: 'content',
                    extractedValue: userMessage.trim(),
                    confidence: 0.7,
                    reasoning: 'Fallback content parsing'
                };
            default:
                return {
                    intent: 'unclear',
                    confidence: 0.3,
                    reasoning: 'No clear intent detected'
                };
        }
    }

    /**
     * Parse date using regex fallback
     */
    private parseDate(message: string): LLMParseResult {
        if (/hôm nay|today/i.test(message)) {
            return {
                intent: 'date',
                extractedValue: new Date().toISOString().split('T')[0],
                confidence: 0.9,
                reasoning: 'Detected "today"'
            };
        }

        if (/ngày mai|tomorrow/i.test(message)) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return {
                intent: 'date',
                extractedValue: tomorrow.toISOString().split('T')[0],
                confidence: 0.9,
                reasoning: 'Detected "tomorrow"'
            };
        }

        // Check for DD/MM format
        const dateMatch = message.match(/(\d{1,2})\/(\d{1,2})/);
        if (dateMatch) {
            const [, day, month] = dateMatch;
            const year = new Date().getFullYear();
            return {
                intent: 'date',
                extractedValue: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
                confidence: 0.8,
                reasoning: 'Detected DD/MM format'
            };
        }

        return {
            intent: 'unclear',
            confidence: 0.3,
            reasoning: 'Could not parse date'
        };
    }

    /**
     * Parse time using regex fallback
     */
    private parseTime(message: string): LLMParseResult {
        // Check for HH:MM format
        const timeMatch = message.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            const [, hours, minutes] = timeMatch;
            return {
                intent: 'time',
                extractedValue: `${hours.padStart(2, '0')}:${minutes}`,
                confidence: 0.9,
                reasoning: 'Detected HH:MM format'
            };
        }

        // Check for Vietnamese time expressions
        if (/sáng/i.test(message)) {
            return {
                intent: 'time',
                extractedValue: '09:00',
                confidence: 0.7,
                reasoning: 'Detected morning'
            };
        }

        if (/chiều/i.test(message)) {
            return {
                intent: 'time',
                extractedValue: '15:00',
                confidence: 0.7,
                reasoning: 'Detected afternoon'
            };
        }

        if (/tối/i.test(message)) {
            return {
                intent: 'time',
                extractedValue: '19:00',
                confidence: 0.7,
                reasoning: 'Detected evening'
            };
        }

        return {
            intent: 'unclear',
            confidence: 0.3,
            reasoning: 'Could not parse time'
        };
    }
}

export default new LLMParser();
export { LLMParseResult, TaskExtractionResult };
