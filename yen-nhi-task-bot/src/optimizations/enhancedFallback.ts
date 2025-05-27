/**
 * Enhanced Fallback System with Progressive Levels
 * Multiple fallback strategies when LLM parsing fails
 */
import logger from '../utils/logger.js';

interface FallbackResult {
    title: string;
    attendees: string[];
    emails: string[];
    location?: string;
    date?: string;
    time?: string;
    description?: string;
    meetingType?: 'google_meet' | 'zoom' | 'teams' | 'in_person';
    confidence: number;
    fallbackLevel: number;
    strategy: string;
    success: boolean;
}

class EnhancedFallbackSystem {
    private fallbackStrategies = [
        {
            level: 1,
            name: 'Enhanced Regex Patterns',
            handler: this.enhancedRegexFallback.bind(this)
        },
        {
            level: 2,
            name: 'Keyword Extraction',
            handler: this.keywordExtractionFallback.bind(this)
        },
        {
            level: 3,
            name: 'Template Matching',
            handler: this.templateMatchingFallback.bind(this)
        },
        {
            level: 4,
            name: 'Basic Structure Detection',
            handler: this.basicStructureFallback.bind(this)
        },
        {
            level: 5,
            name: 'Minimal Fallback',
            handler: this.minimalFallback.bind(this)
        }
    ];

    // Enhanced regex patterns for better extraction
    private enhancedPatterns = {
        // Meeting patterns with various formats
        meeting: [
            /^(họp|meeting|gặp|call|gọi)\s+(.+?)\s+(lúc|vào|at)\s+(\d{1,2}[:\.]?\d{0,2}\s*(?:am|pm|h|giờ)?)/i,
            /^(cuộc họp|meeting)\s+(.+?)\s+(ngày|on)\s+(.+)/i,
            /^(gặp|meet)\s+(.+?)\s+(tại|at)\s+(.+)/i
        ],

        // Task patterns
        task: [
            /^(làm|hoàn thành|complete|finish|submit|nộp)\s+(.+?)(?:\s+(trước|by|deadline)\s+(.+))?/i,
            /^(nhắc|remind|reminder)\s+(.+)/i,
            /^(cần|need to|phải)\s+(.+)/i
        ],

        // Time extraction
        time: [
            /\b(\d{1,2})[:\.](\d{2})\s*(?:am|pm|h|giờ)?\b/i,
            /\b(\d{1,2})\s*(?:h|giờ|:00|am|pm)\b/i,
            /\b(sáng|chiều|tối|morning|afternoon|evening)\b/i
        ],

        // Date extraction
        date: [
            /\b(hôm nay|today|ngày mai|tomorrow|tuần sau|next week)\b/i,
            /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/,
            /\b(thứ\s*\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
        ],

        // People extraction
        people: [
            /\b(với|cùng|and)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/g,
            /\b([A-ZÀ-Ỹ][a-zà-ỹ]+)\s+(join|tham gia)\b/g
        ],

        // Location extraction
        location: [
            /\b(tại|ở|at|in)\s+([^,\n]+)/i,
            /\b(phòng|room)\s+([A-Za-z0-9\-]+)/i,
            /\b(zoom|teams|google meet|skype)\b/i
        ],

        // Email extraction
        email: [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
        ]
    };

    /**
     * Execute progressive fallback strategies
     */
    public async executeProgressiveFallback(message: string, llmError?: Error): Promise<FallbackResult> {
        logger.warn(`[Fallback System] LLM parsing failed: ${llmError?.message || 'Unknown error'}`);

        for (const strategy of this.fallbackStrategies) {
            try {
                logger.info(`[Fallback System] Trying level ${strategy.level}: ${strategy.name}`);

                const result = await strategy.handler(message);

                if (result.success && result.confidence > 0.3) {
                    logger.info(`[Fallback System] Success with ${strategy.name} (confidence: ${result.confidence})`);
                    return result;
                }

                logger.warn(`[Fallback System] Level ${strategy.level} failed or low confidence (${result.confidence})`);
            } catch (error) {
                logger.error(`[Fallback System] Strategy ${strategy.name} failed:`, error);
                continue;
            }
        }

        // If all strategies fail, return minimal fallback
        return this.emergencyFallback(message);
    }

    /**
     * Level 1: Enhanced Regex Patterns
     */
    private async enhancedRegexFallback(message: string): Promise<FallbackResult> {
        const result: FallbackResult = {
            title: message,
            attendees: [],
            emails: [],
            confidence: 0,
            fallbackLevel: 1,
            strategy: 'Enhanced Regex Patterns',
            success: false
        };

        let confidence = 0;
        let matchCount = 0;

        // Try meeting patterns
        for (const pattern of this.enhancedPatterns.meeting) {
            const match = message.match(pattern);
            if (match) {
                result.title = `${match[1]} ${match[2]}`.trim();
                if (match[4]) result.time = this.normalizeTime(match[4]);
                confidence += 0.3;
                matchCount++;
                break;
            }
        }

        // Try task patterns
        if (matchCount === 0) {
            for (const pattern of this.enhancedPatterns.task) {
                const match = message.match(pattern);
                if (match) {
                    result.title = match[2];
                    if (match[4]) result.date = this.normalizeDate(match[4]);
                    confidence += 0.25;
                    matchCount++;
                    break;
                }
            }
        }

        // Extract additional information
        confidence += this.extractAdditionalInfo(message, result);

        result.confidence = Math.min(confidence, 0.8);
        result.success = matchCount > 0;

        return result;
    }

    /**
     * Level 2: Keyword Extraction
     */
    private async keywordExtractionFallback(message: string): Promise<FallbackResult> {
        const keywords = {
            actions: ['họp', 'meeting', 'gặp', 'call', 'gọi', 'làm', 'hoàn thành', 'submit', 'nộp'],
            times: ['sáng', 'chiều', 'tối', 'morning', 'afternoon', 'evening'],
            locations: ['phòng', 'room', 'zoom', 'teams', 'google meet', 'skype'],
            people: [] as string[]
        };

        const words = message.toLowerCase().split(/\s+/);
        let actionFound = false;
        let title = message;

        // Find action keywords
        for (const word of words) {
            if (keywords.actions.includes(word)) {
                actionFound = true;
                break;
            }
        }

        // Extract people names (capitalized words)
        const peopleMatches = message.match(/\b[A-ZÀ-Ỹ][a-zà-ỹ]+/g);
        if (peopleMatches) {
            keywords.people = peopleMatches.filter(name => name.length > 2);
        }

        const result: FallbackResult = {
            title,
            attendees: keywords.people,
            emails: [],
            confidence: actionFound ? 0.5 : 0.3,
            fallbackLevel: 2,
            strategy: 'Keyword Extraction',
            success: actionFound || keywords.people.length > 0
        };

        // Extract additional information
        this.extractAdditionalInfo(message, result);

        return result;
    }

    /**
     * Level 3: Template Matching
     */
    private async templateMatchingFallback(message: string): Promise<FallbackResult> {
        const templates = [
            {
                pattern: /^(.+?)\s+(lúc|at)\s+(.+)$/i,
                confidence: 0.6,
                extractor: (match: RegExpMatchArray) => ({
                    title: match[1],
                    time: match[3]
                })
            },
            {
                pattern: /^(.+?)\s+(với|with)\s+(.+)$/i,
                confidence: 0.55,
                extractor: (match: RegExpMatchArray) => ({
                    title: match[1],
                    attendees: [match[3]]
                })
            },
            {
                pattern: /^(.+?)\s+(tại|at)\s+(.+)$/i,
                confidence: 0.5,
                extractor: (match: RegExpMatchArray) => ({
                    title: match[1],
                    location: match[3]
                })
            }
        ];

        for (const template of templates) {
            const match = message.match(template.pattern);
            if (match) {
                const extracted = template.extractor(match) as any;
                return {
                    title: extracted.title || message,
                    attendees: extracted.attendees || [],
                    emails: [],
                    location: extracted.location || '',
                    time: extracted.time || '',
                    date: extracted.date || '',
                    description: extracted.description || '',
                    meetingType: extracted.meetingType || 'google_meet',
                    confidence: template.confidence,
                    fallbackLevel: 3,
                    strategy: 'Template Matching',
                    success: true
                };
            }
        }

        return {
            title: message,
            attendees: [],
            emails: [],
            confidence: 0.2,
            fallbackLevel: 3,
            strategy: 'Template Matching',
            success: false
        };
    }

    /**
     * Level 4: Basic Structure Detection
     */
    private async basicStructureFallback(message: string): Promise<FallbackResult> {
        const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const firstSentence = sentences[0]?.trim() || message;

        // Use first sentence as title, detect any structured info
        const result: FallbackResult = {
            title: firstSentence,
            attendees: [],
            emails: [],
            confidence: 0.4,
            fallbackLevel: 4,
            strategy: 'Basic Structure Detection',
            success: true
        };

        // Try to extract any recognizable patterns
        this.extractAdditionalInfo(message, result);

        return result;
    }

    /**
     * Level 5: Minimal Fallback
     */
    private async minimalFallback(message: string): Promise<FallbackResult> {
        return {
            title: message.length > 50 ? message.substring(0, 47) + '...' : message,
            attendees: [],
            emails: [],
            confidence: 0.2,
            fallbackLevel: 5,
            strategy: 'Minimal Fallback',
            success: true
        };
    }

    /**
     * Emergency fallback when all else fails
     */
    private emergencyFallback(message: string): FallbackResult {
        return {
            title: 'Task: ' + (message.length > 30 ? message.substring(0, 27) + '...' : message),
            attendees: [],
            emails: [],
            confidence: 0.1,
            fallbackLevel: 99,
            strategy: 'Emergency Fallback',
            success: true
        };
    }

    /**
     * Extract additional information using patterns
     */
    private extractAdditionalInfo(message: string, result: FallbackResult): number {
        let additionalConfidence = 0;

        // Extract time
        if (!result.time) {
            for (const pattern of this.enhancedPatterns.time) {
                const match = message.match(pattern);
                if (match) {
                    result.time = this.normalizeTime(match[0]);
                    additionalConfidence += 0.1;
                    break;
                }
            }
        }

        // Extract date
        if (!result.date) {
            for (const pattern of this.enhancedPatterns.date) {
                const match = message.match(pattern);
                if (match) {
                    result.date = this.normalizeDate(match[0]);
                    additionalConfidence += 0.1;
                    break;
                }
            }
        }

        // Extract location
        if (!result.location) {
            for (const pattern of this.enhancedPatterns.location) {
                const match = message.match(pattern);
                if (match) {
                    result.location = match[2] || match[0];
                    additionalConfidence += 0.1;

                    // Detect meeting type
                    if (/zoom/i.test(result.location)) result.meetingType = 'zoom';
                    else if (/teams/i.test(result.location)) result.meetingType = 'teams';
                    else if (/google meet/i.test(result.location)) result.meetingType = 'google_meet';
                    else result.meetingType = 'in_person';

                    break;
                }
            }
        }

        // Extract emails
        const emailMatches = message.match(this.enhancedPatterns.email[0]);
        if (emailMatches) {
            result.emails = emailMatches;
            additionalConfidence += 0.1;
        }

        // Extract people if not already done
        if (result.attendees.length === 0) {
            for (const pattern of this.enhancedPatterns.people) {
                const matches = Array.from(message.matchAll(pattern));
                if (matches.length > 0) {
                    result.attendees = matches.map(match => match[2] || match[1]).filter(Boolean);
                    additionalConfidence += 0.1;
                    break;
                }
            }
        }

        return additionalConfidence;
    }

    /**
     * Normalize time format
     */
    private normalizeTime(timeStr: string): string {
        const match = timeStr.match(/(\d{1,2})[:\.]?(\d{0,2})/);
        if (match) {
            const hours = match[1];
            const minutes = match[2] || '00';
            return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
        }
        return timeStr;
    }

    /**
     * Normalize date format
     */
    private normalizeDate(dateStr: string): string {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        if (/hôm nay|today/i.test(dateStr)) {
            return today.toISOString().split('T')[0];
        }
        if (/ngày mai|tomorrow/i.test(dateStr)) {
            return tomorrow.toISOString().split('T')[0];
        }

        return dateStr;
    }

    /**
     * Get fallback statistics
     */
    public getFallbackStats(): any {
        return {
            availableStrategies: this.fallbackStrategies.length,
            patternCount: {
                meeting: this.enhancedPatterns.meeting.length,
                task: this.enhancedPatterns.task.length,
                time: this.enhancedPatterns.time.length,
                date: this.enhancedPatterns.date.length,
                people: this.enhancedPatterns.people.length,
                location: this.enhancedPatterns.location.length,
                email: this.enhancedPatterns.email.length
            }
        };
    }
}

export default new EnhancedFallbackSystem();
