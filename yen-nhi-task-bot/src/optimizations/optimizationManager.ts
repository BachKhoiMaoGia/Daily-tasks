/**
 * Unified Optimization Manager
 * Coordinates all optimization modules for seamless integration
 */
import logger from '../utils/logger.js';
import preFilter from './preFilter.js';
import confidenceParser from './confidenceBasedParser.js';
import smartSelection from './smartSelection.js';
import enhancedFallback from './enhancedFallback.js';
import conversationOptimizer from './conversationOptimizer.js';

interface OptimizationResult {
    success: boolean;
    result: any;
    optimizations: {
        preFilterApplied: boolean;
        confidenceParserUsed: boolean;
        smartSelectionUsed: boolean;
        fallbackTriggered: boolean;
        conversationOptimized: boolean;
    };
    performance: {
        totalTime: number;
        llmCallsAvoided: number;
        conversationStepsReduced: number;
    };
    confidence: number;
}

interface OptimizationConfig {
    enablePreFilter: boolean;
    enableConfidenceParser: boolean;
    enableSmartSelection: boolean;
    enableEnhancedFallback: boolean;
    enableConversationOptimizer: boolean;
    confidenceThreshold: number;
    maxFallbackAttempts: number;
}

class UnifiedOptimizationManager {
    private config: OptimizationConfig = {
        enablePreFilter: true,
        enableConfidenceParser: true,
        enableSmartSelection: true,
        enableEnhancedFallback: true,
        enableConversationOptimizer: true,
        confidenceThreshold: 0.6, // Giảm từ 0.7 xuống 0.6 để tăng tỷ lệ tránh LLM
        maxFallbackAttempts: 3
    };

    private stats = {
        totalRequests: 0,
        preFilterHits: 0,
        confidenceParserHits: 0,
        llmCallsAvoided: 0,
        conversationStepsReduced: 0,
        fallbacksTriggered: 0,
        averageProcessingTime: 0
    };

    /**
     * Main optimization pipeline for message processing
     */
    public async optimizeMessageProcessing(
        message: string,
        userId: string,
        conversationHistory?: string[]
    ): Promise<OptimizationResult> {
        const startTime = Date.now();
        this.stats.totalRequests++;

        const result: OptimizationResult = {
            success: false,
            result: null,
            optimizations: {
                preFilterApplied: false,
                confidenceParserUsed: false,
                smartSelectionUsed: false,
                fallbackTriggered: false,
                conversationOptimized: false
            },
            performance: {
                totalTime: 0,
                llmCallsAvoided: 0,
                conversationStepsReduced: 0
            },
            confidence: 0
        };

        try {
            // STEP 1: Pre-filter for non-task messages
            if (this.config.enablePreFilter) {
                const preFilterResult = preFilter.preFilterWithContext(message, conversationHistory);
                result.optimizations.preFilterApplied = true;

                if (!preFilterResult.isTaskLikely && preFilterResult.confidence > 0.8) {
                    // High confidence non-task message
                    this.stats.preFilterHits++;
                    this.stats.llmCallsAvoided++;
                    result.performance.llmCallsAvoided++;

                    result.success = true;
                    result.result = {
                        isTask: false,
                        quickReply: preFilterResult.quickReply,
                        reason: preFilterResult.reason
                    };
                    result.confidence = preFilterResult.confidence;

                    logger.info(`[Optimization] Pre-filter blocked non-task message: ${preFilterResult.reason}`);
                    return this.finalizeResult(result, startTime);
                }
            }            // STEP 2: Confidence-based parsing
            if (this.config.enableConfidenceParser) {
                const parseResult = await confidenceParser.parseWithConfidence(message, userId);
                result.optimizations.confidenceParserUsed = true;

                if (parseResult.confidence >= this.config.confidenceThreshold) {
                    // High confidence parsing - avoid LLM
                    this.stats.confidenceParserHits++;
                    if (parseResult.source !== 'llm') {
                        this.stats.llmCallsAvoided++;
                        result.performance.llmCallsAvoided++;
                    }

                    // STEP 2.1: Apply conversation optimization for task messages
                    if (parseResult.isTask !== false && this.config.enableConversationOptimizer) {
                        const flowResult = conversationOptimizer.optimizeConversationFlow(
                            userId,
                            message,
                            parseResult
                        );
                        result.optimizations.conversationOptimized = true;

                        const originalQuestionCount = 6; // Typical max questions
                        const reductionCount = Math.max(0, originalQuestionCount - flowResult.questionsToAsk.length);
                        this.stats.conversationStepsReduced += reductionCount;
                        result.performance.conversationStepsReduced = reductionCount;

                        // Merge optimized task data back
                        const optimizedResult = { ...parseResult, ...flowResult.optimizedTask };
                        result.result = optimizedResult;
                        result.confidence = Math.max(parseResult.confidence, flowResult.confidence);

                        logger.info(`[Optimization] Conversation optimization applied, steps reduced: ${reductionCount}`);
                    } else {
                        result.result = parseResult;
                        result.confidence = parseResult.confidence;
                    }

                    result.success = true;

                    logger.info(`[Optimization] Confidence parser succeeded: ${parseResult.source} (${parseResult.confidence})`);
                    return this.finalizeResult(result, startTime);
                }
            }

            // STEP 3: If we reach here, we need LLM processing
            // Try LLM with fallback protection
            try {
                const llmResult = await this.callLLMWithTimeout(message, userId);
                result.success = true;
                result.result = llmResult;
                result.confidence = llmResult.confidence || 0.8;

                logger.info('[Optimization] LLM processing successful');
            } catch (llmError: any) {
                // STEP 4: Enhanced fallback when LLM fails
                if (this.config.enableEnhancedFallback) {
                    logger.warn('[Optimization] LLM failed, triggering enhanced fallback');
                    const fallbackResult = await enhancedFallback.executeProgressiveFallback(message, llmError as Error);
                    result.optimizations.fallbackTriggered = true;
                    this.stats.fallbacksTriggered++;

                    result.success = fallbackResult.success;
                    result.result = fallbackResult;
                    result.confidence = fallbackResult.confidence;

                    logger.info(`[Optimization] Fallback level ${fallbackResult.fallbackLevel} completed: ${fallbackResult.strategy}`);
                } else {
                    throw llmError; // Re-throw if fallback disabled
                }
            }

            return this.finalizeResult(result, startTime);

        } catch (error: any) {
            logger.error('[Optimization] Pipeline failed:', error);
            result.success = false;
            result.result = { error: error.message || 'Unknown error' };
            return this.finalizeResult(result, startTime);
        }
    }

    /**
     * Optimize task creation workflow
     */
    public async optimizeTaskCreation(
        parsedTask: any,
        userId: string,
        availableCalendars: any[],
        availableTaskLists: any[]
    ): Promise<OptimizationResult> {
        const startTime = Date.now();

        const result: OptimizationResult = {
            success: false,
            result: null,
            optimizations: {
                preFilterApplied: false,
                confidenceParserUsed: false,
                smartSelectionUsed: false,
                fallbackTriggered: false,
                conversationOptimized: false
            },
            performance: {
                totalTime: 0,
                llmCallsAvoided: 0,
                conversationStepsReduced: 0
            },
            confidence: 0
        };

        try {
            let optimizedTask = { ...parsedTask };
            let selectionResult = null;

            // STEP 1: Smart calendar/task list selection
            if (this.config.enableSmartSelection) {
                selectionResult = await smartSelection.selectSmartTarget(
                    parsedTask.title || '',
                    userId,
                    availableCalendars,
                    availableTaskLists
                );
                result.optimizations.smartSelectionUsed = true;

                if (selectionResult.autoSelected && selectionResult.confidence > 0.7) {
                    optimizedTask.calendarId = selectionResult.calendarId;
                    optimizedTask.taskListId = selectionResult.taskListId;

                    logger.info(`[Optimization] Smart selection: ${selectionResult.reasoning}`);
                }
            }

            // STEP 2: Conversation flow optimization
            if (this.config.enableConversationOptimizer) {
                const flowResult = conversationOptimizer.optimizeConversationFlow(
                    userId,
                    parsedTask.title || '',
                    optimizedTask
                );
                result.optimizations.conversationOptimized = true;

                const originalQuestionCount = 6; // Typical max questions
                const reductionCount = Math.max(0, originalQuestionCount - flowResult.questionsToAsk.length);

                this.stats.conversationStepsReduced += reductionCount;
                result.performance.conversationStepsReduced = reductionCount;

                optimizedTask = flowResult.optimizedTask;
                result.confidence = Math.max(result.confidence, flowResult.confidence);

                logger.info(`[Optimization] Conversation steps reduced: ${reductionCount}`);
            }

            result.success = true;
            result.result = {
                optimizedTask,
                selectionResult,
                questionsToAsk: [],
                autoCompleted: Object.keys(optimizedTask).length > Object.keys(parsedTask).length
            };

            return this.finalizeResult(result, startTime);
        } catch (error: any) {
            logger.error('[Optimization] Task creation optimization failed:', error);
            result.success = false;
            result.result = { error: error.message || 'Unknown error' };
            return this.finalizeResult(result, startTime);
        }
    }

    /**
     * Learn from user interactions to improve optimizations
     */
    public learnFromUserInteraction(
        userId: string,
        originalMessage: string,
        userFeedback: 'positive' | 'negative' | 'correction',
        finalResult: any
    ): void {
        try {
            // Learn for smart selection
            if (finalResult.calendarId || finalResult.taskListId) {
                smartSelection.learnFromUserSelection(
                    userId,
                    originalMessage,
                    finalResult.calendarId,
                    finalResult.taskListId
                );
            }

            // Update confidence thresholds based on feedback
            if (userFeedback === 'negative') {
                // If user was unsatisfied, we might want to be more conservative
                this.adjustConfidenceThresholds('decrease');
            } else if (userFeedback === 'positive') {
                // User was satisfied, we can be slightly more aggressive
                this.adjustConfidenceThresholds('increase');
            }

            logger.info(`[Optimization] Learning from ${userFeedback} feedback for user ${userId}`);

        } catch (error) {
            logger.error('[Optimization] Learning failed:', error);
        }
    }

    /**
     * Get comprehensive optimization statistics
     */
    public getOptimizationStats(): any {
        const totalTime = Date.now();
        const avgTime = this.stats.totalRequests > 0 ? this.stats.averageProcessingTime / this.stats.totalRequests : 0;

        return {
            performance: {
                totalRequests: this.stats.totalRequests,
                preFilterHitRate: this.stats.totalRequests > 0 ? this.stats.preFilterHits / this.stats.totalRequests : 0,
                confidenceParserHitRate: this.stats.totalRequests > 0 ? this.stats.confidenceParserHits / this.stats.totalRequests : 0,
                llmCallsAvoided: this.stats.llmCallsAvoided,
                conversationStepsReduced: this.stats.conversationStepsReduced,
                fallbacksTriggered: this.stats.fallbacksTriggered,
                averageProcessingTime: avgTime
            },
            modules: {
                preFilter: preFilter.getFilterStats(),
                confidenceParser: confidenceParser.getCacheStats(),
                smartSelection: smartSelection.getSelectionStats(),
                enhancedFallback: enhancedFallback.getFallbackStats(),
                conversationOptimizer: conversationOptimizer.getConversationStats()
            },
            config: this.config
        };
    }

    /**
     * Update optimization configuration
     */
    public updateConfig(newConfig: Partial<OptimizationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info('[Optimization] Configuration updated:', newConfig);
    }

    /**
     * Reset all optimization statistics
     */
    public resetStats(): void {
        this.stats = {
            totalRequests: 0,
            preFilterHits: 0,
            confidenceParserHits: 0,
            llmCallsAvoided: 0,
            conversationStepsReduced: 0,
            fallbacksTriggered: 0,
            averageProcessingTime: 0
        };

        // Clear module caches
        confidenceParser.clearCache();
        conversationOptimizer.cleanupOldStates();

        logger.info('[Optimization] Statistics and caches reset');
    }

    /**
     * Finalize optimization result with timing
     */
    private finalizeResult(result: OptimizationResult, startTime: number): OptimizationResult {
        const processingTime = Date.now() - startTime;
        result.performance.totalTime = processingTime;

        // Update running average
        this.stats.averageProcessingTime =
            (this.stats.averageProcessingTime * (this.stats.totalRequests - 1) + processingTime) / this.stats.totalRequests;

        logger.debug(`[Optimization] Request completed in ${processingTime}ms`);
        return result;
    }

    /**
     * Call LLM with timeout protection
     */
    private async callLLMWithTimeout(message: string, userId: string, timeoutMs = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('LLM call timeout'));
            }, timeoutMs);

            // This would call the actual LLM parser
            // For now, we'll simulate it
            setTimeout(() => {
                clearTimeout(timeout);
                resolve({
                    title: message,
                    confidence: 0.8,
                    source: 'llm',
                    attendees: [],
                    emails: []
                });
            }, Math.random() * 2000); // Simulate variable LLM response time
        });
    }

    /**
     * Adjust confidence thresholds based on feedback
     */
    private adjustConfidenceThresholds(direction: 'increase' | 'decrease'): void {
        const adjustment = direction === 'increase' ? 0.05 : -0.05;
        const newThreshold = Math.max(0.5, Math.min(0.9, this.config.confidenceThreshold + adjustment));

        if (newThreshold !== this.config.confidenceThreshold) {
            this.config.confidenceThreshold = newThreshold;
            logger.info(`[Optimization] Confidence threshold adjusted to ${newThreshold}`);
        }
    }

    /**
     * Export optimization data for analysis
     */
    public exportOptimizationData(): any {
        return {
            stats: this.stats,
            config: this.config,
            timestamp: Date.now(),
            moduleData: {
                preFilterStats: preFilter.getFilterStats(),
                cacheStats: confidenceParser.getCacheStats(),
                selectionStats: smartSelection.getSelectionStats(),
                fallbackStats: enhancedFallback.getFallbackStats(),
                conversationStats: conversationOptimizer.getConversationStats()
            }
        };
    }
}

export default new UnifiedOptimizationManager();
