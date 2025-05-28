/**
 * Confidence-Based Parser with Smart Caching
 * Bypass LLM calls for high-confidence simple patterns
 * and cache results for repeated patterns
 */
import logger from '../utils/logger.js';

interface ParsedResult {
    title: string;
    attendees: string[];
    emails: string[];
    location?: string;
    date?: string;
    time?: string;
    description?: string;
    meetingType?: 'google_meet' | 'zoom' | 'teams' | 'in_person';
    cmd?: string;
    args?: string;
    isTask?: boolean;
    confidence: number;
    source: 'regex' | 'llm' | 'cache';
    reasoning: string;
}

interface CacheEntry {
    result: ParsedResult;
    timestamp: number;
    usageCount: number;
}

class ConfidenceBasedParser {
    private parseCache = new Map<string, CacheEntry>();
    private readonly CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
    private readonly MAX_CACHE_SIZE = 1000;    // High-confidence regex patterns for common task formats
    private highConfidencePatterns = [
        // Simple commands with very high confidence
        {
            pattern: /^\/?(list|lisy|danh sách|ds)(\s+.*)?$/i,
            confidence: 0.99,
            extractor: (match: RegExpMatchArray) => ({
                cmd: 'list',
                args: (match[2] || '').trim(),
                isTask: false,
                reasoning: 'High-confidence list command'
            })
        },
        {
            pattern: /^\/?(stats|thống kê|tk)$/i,
            confidence: 0.99,
            extractor: (match: RegExpMatchArray) => ({
                cmd: 'stats',
                args: '',
                isTask: false,
                reasoning: 'High-confidence stats command'
            })
        },
        {
            pattern: /^\/?(help|giúp|hướng dẫn)$/i,
            confidence: 0.99,
            extractor: (match: RegExpMatchArray) => ({
                cmd: 'help',
                args: '',
                isTask: false,
                reasoning: 'High-confidence help command'
            })
        },
        // Meeting patterns
        {
            pattern: /^(họp|meeting|gặp)\s+(.+?)\s+(lúc|vào)\s+(\d{1,2}:\d{2}|\d{1,2}h\d{0,2})/i,
            confidence: 0.9,
            extractor: (match: RegExpMatchArray) => ({
                title: `Họp ${match[2]}`,
                time: this.normalizeTime(match[4]),
                meetingType: 'google_meet' as const,
                reasoning: 'High-confidence meeting pattern'
            })
        },
        // Task with deadline
        {
            pattern: /^(làm|hoàn thành|submit|nộp)\s+(.+?)\s+(trước|deadline|vào)\s+(.+)/i,
            confidence: 0.85,
            extractor: (match: RegExpMatchArray) => ({
                title: match[2],
                date: this.normalizeDate(match[4]),
                reasoning: 'High-confidence deadline pattern'
            })
        },
        // Call patterns
        {
            pattern: /^(gọi|call)\s+(.+?)\s+(lúc|vào)\s+(\d{1,2}:\d{2}|\d{1,2}h\d{0,2})/i,
            confidence: 0.88,
            extractor: (match: RegExpMatchArray) => ({
                title: `Gọi ${match[2]}`,
                time: this.normalizeTime(match[4]),
                attendees: [match[2]],
                reasoning: 'High-confidence call pattern'
            })
        },
        // Simple reminder
        {
            pattern: /^(nhắc|remind|reminder)\s+(.+)/i,
            confidence: 0.8,
            extractor: (match: RegExpMatchArray) => ({
                title: `Nhắc: ${match[2]}`,
                reasoning: 'High-confidence reminder pattern'
            })
        }
    ];

    // Medium-confidence patterns that might need LLM verification
    private mediumConfidencePatterns = [
        {
            pattern: /\b(với|cùng)\s+([a-zA-ZÀ-ỹ\s]+)/i,
            confidence: 0.6,
            extractor: (match: RegExpMatchArray) => ({
                attendees: [match[2].trim()],
                reasoning: 'Medium-confidence attendee pattern'
            })
        },
        {
            pattern: /\b(tại|ở)\s+([a-zA-ZÀ-ỹ\s]+)/i,
            confidence: 0.65,
            extractor: (match: RegExpMatchArray) => ({
                location: match[2].trim(),
                reasoning: 'Medium-confidence location pattern'
            })
        }
    ];

    /**
     * Parse message with confidence-based approach
     */
    public async parseWithConfidence(message: string, userId?: string): Promise<ParsedResult> {
        const normalizedMessage = message.trim();

        // Check cache first
        const cacheKey = this.generateCacheKey(normalizedMessage);
        const cached = this.getCachedResult(cacheKey);
        if (cached) {
            logger.info(`[Confidence Parser] Cache hit for message: ${normalizedMessage.substring(0, 50)}...`);
            return cached;
        }

        // Try high-confidence patterns first
        const highConfidenceResult = this.tryHighConfidencePatterns(normalizedMessage);
        if (highConfidenceResult && highConfidenceResult.confidence >= 0.8) {
            logger.info(`[Confidence Parser] High confidence match (${highConfidenceResult.confidence}): ${highConfidenceResult.reasoning}`);
            this.cacheResult(cacheKey, highConfidenceResult);
            return highConfidenceResult;
        }

        // Try medium-confidence patterns
        const mediumConfidenceResult = this.tryMediumConfidencePatterns(normalizedMessage);

        // If we have enough confidence, return without LLM
        if (mediumConfidenceResult && mediumConfidenceResult.confidence >= 0.7) {
            logger.info(`[Confidence Parser] Medium confidence match (${mediumConfidenceResult.confidence}): ${mediumConfidenceResult.reasoning}`);
            this.cacheResult(cacheKey, mediumConfidenceResult);
            return mediumConfidenceResult;
        }

        // Fallback to LLM for complex cases
        return this.createLLMFallbackResult(normalizedMessage);
    }    /**
     * Try high-confidence regex patterns
     */
    private tryHighConfidencePatterns(message: string): ParsedResult | null {
        for (const pattern of this.highConfidencePatterns) {
            const match = message.match(pattern.pattern);
            if (match) {
                const extracted = pattern.extractor(match) as any; return {
                    title: extracted.title || 'Task',
                    attendees: extracted.attendees || [],
                    emails: [],
                    location: extracted.location || '',
                    date: extracted.date || '',
                    time: extracted.time || '',
                    description: extracted.description || '',
                    meetingType: extracted.meetingType || 'google_meet',
                    cmd: extracted.cmd, // FIXED: Don't default to 'add' - let natural language flow through
                    args: extracted.args || '',
                    isTask: extracted.isTask !== false, // Default to true unless explicitly false
                    confidence: pattern.confidence,
                    source: 'regex',
                    reasoning: extracted.reasoning || 'High-confidence pattern match'
                };
            }
        }
        return null;
    }    /**
     * Try medium-confidence patterns and combine results
     */
    private tryMediumConfidencePatterns(message: string): ParsedResult | null {
        let combinedResult: Partial<ParsedResult> = {
            title: message,
            attendees: [],
            emails: [],
            isTask: true,
            confidence: 0,
            source: 'regex',
            reasoning: 'Combined medium-confidence patterns'
        };

        let totalConfidence = 0;
        let patternCount = 0;

        for (const pattern of this.mediumConfidencePatterns) {
            const match = message.match(pattern.pattern);
            if (match) {
                const extracted = pattern.extractor(match);
                combinedResult = { ...combinedResult, ...extracted };
                totalConfidence += pattern.confidence;
                patternCount++;
            }
        }

        if (patternCount > 0) {
            combinedResult.confidence = totalConfidence / patternCount;
            return combinedResult as ParsedResult;
        }

        return null;
    }    /**
     * Create fallback result that indicates LLM processing needed
     */
    private createLLMFallbackResult(message: string): ParsedResult {
        return {
            title: message,
            attendees: [],
            emails: [],
            isTask: true,
            confidence: 0.3,
            source: 'llm',
            reasoning: 'Complex message requires LLM analysis'
        };
    }

    /**
     * Normalize time format
     */
    private normalizeTime(timeStr: string): string {
        const match = timeStr.match(/(\d{1,2}):?(\d{0,2})/);
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
     * Generate cache key for message
     */
    private generateCacheKey(message: string): string {
        return message.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * Get cached result if valid
     */
    private getCachedResult(cacheKey: string): ParsedResult | null {
        const entry = this.parseCache.get(cacheKey);
        if (!entry) return null;

        // Check if cache entry is expired
        if (Date.now() - entry.timestamp > this.CACHE_EXPIRY_MS) {
            this.parseCache.delete(cacheKey);
            return null;
        }

        // Update usage count
        entry.usageCount++;
        return { ...entry.result, source: 'cache' };
    }

    /**
     * Cache parsing result
     */
    private cacheResult(cacheKey: string, result: ParsedResult): void {
        // Only cache high-confidence results
        if (result.confidence < 0.7) return;

        // Clean old entries if cache is too large
        if (this.parseCache.size >= this.MAX_CACHE_SIZE) {
            this.cleanCache();
        }

        this.parseCache.set(cacheKey, {
            result: { ...result },
            timestamp: Date.now(),
            usageCount: 1
        });
    }

    /**
     * Clean old cache entries
     */
    private cleanCache(): void {
        const entries = Array.from(this.parseCache.entries());

        // Sort by usage count and timestamp (least used and oldest first)
        entries.sort((a, b) => {
            if (a[1].usageCount !== b[1].usageCount) {
                return a[1].usageCount - b[1].usageCount;
            }
            return a[1].timestamp - b[1].timestamp;
        });

        // Remove 20% of least used entries
        const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.parseCache.delete(entries[i][0]);
        }

        logger.info(`[Confidence Parser] Cleaned ${toRemove} cache entries`);
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): any {
        const entries = Array.from(this.parseCache.values());
        const totalUsage = entries.reduce((sum, entry) => sum + entry.usageCount, 0);

        return {
            size: this.parseCache.size,
            totalUsage,
            averageUsage: entries.length > 0 ? totalUsage / entries.length : 0,
            oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : null
        };
    }

    /**
     * Clear cache manually
     */
    public clearCache(): void {
        this.parseCache.clear();
        logger.info('[Confidence Parser] Cache cleared manually');
    }
}

export default new ConfidenceBasedParser();