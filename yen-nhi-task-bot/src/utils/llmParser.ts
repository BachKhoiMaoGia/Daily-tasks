/**
 * LLM-based flexible response parser
 * Uses OpenAI to parse user responses more intelligently
 */
import { config } from '../config/index.js';
import logger from './logger.js';

interface LLMParseResult {
    intent: 'date' | 'time' | 'confirm' | 'cancel' | 'skip' | 'content' | 'unclear';
    extractedValue?: string;
    confidence: number;
    reasoning?: string;
}

class LLMParser {
    private isEnabled: boolean;

    constructor() {
        this.isEnabled = !!config.openaiApiKey && config.useLLM;
        if (!this.isEnabled) {
            logger.warn('[LLM Parser] OpenAI API key not found or LLM disabled, falling back to regex parsing');
        }
    }

    /**
     * Parse user response using LLM for better flexibility
     */
    async parseResponse(userMessage: string, expectedType: 'date' | 'time' | 'content', context?: string): Promise<LLMParseResult> {
        if (!this.isEnabled) {
            return this.fallbackParse(userMessage, expectedType);
        } try {
            const prompt = this.createPrompt(userMessage, expectedType, context);

            // Use GitHub Models API if base URL is set to GitHub, otherwise use OpenAI
            const apiUrl = config.openaiBaseUrl.includes('github')
                ? `${config.openaiBaseUrl}/chat/completions`
                : `${config.openaiBaseUrl}/chat/completions`;

            const response = await fetch(apiUrl, {
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
                            content: 'You are a helpful assistant that parses Vietnamese user responses for a task management bot. Always respond with valid JSON only.'
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

            logger.info('[LLM Parser] Successfully parsed response:', {
                userMessage,
                result,
                model: config.openaiModelId,
                apiProvider: config.openaiBaseUrl.includes('github') ? 'GitHub Models' : 'OpenAI'
            });
            return result;
        } catch (error) {
            logger.error('[LLM Parser] Error parsing with LLM API:', {
                error: error instanceof Error ? error.message : String(error),
                model: config.openaiModelId,
                apiProvider: config.openaiBaseUrl.includes('github') ? 'GitHub Models' : 'OpenAI',
                baseUrl: config.openaiBaseUrl
            });
            return this.fallbackParse(userMessage, expectedType);
        }
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
export { LLMParseResult };
