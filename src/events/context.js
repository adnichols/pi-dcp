/**
 * DCP Context Event Handler
 *
 * Handles the 'context' event which fires before each LLM call.
 * Applies pruning workflow to reduce token usage while preserving coherence.
 */
import { analyzeConversationPressure, formatPressureSummary } from "../analysis.js";
import { applyPruningWorkflowDetailed } from "../workflow.js";

/**
 * Creates a context event handler that applies pruning to messages.
 *
 * @param options - Configuration and stats tracker
 * @returns Event handler function
 */
export function createContextEventHandler(options) {
    const { config, statsTracker } = options;
    return async (event, ctx) => {
        try {
            const originalCount = event.messages.length;
            const analysis = analyzeConversationPressure(event.messages);
            const pressureSummary = formatPressureSummary(analysis, { maxItems: 1 });
            // Apply pruning workflow
            const workflowResult = applyPruningWorkflowDetailed(event.messages, config);
            const prunedMessages = workflowResult.messages;
            const prunedCount = workflowResult.stats.prunedCount;
            const redactedCount = workflowResult.stats.redactedCount;
            const estimatedTokensSaved = workflowResult.stats.estimatedTokensSaved;
            statsTracker.totalPruned += prunedCount;
            statsTracker.totalRedacted = (statsTracker.totalRedacted || 0) + redactedCount;
            statsTracker.totalProcessed += originalCount;
            statsTracker.estimatedTokensPruned = (statsTracker.estimatedTokensPruned || 0) + workflowResult.stats.estimatedTokensPruned;
            statsTracker.estimatedTokensRedacted = (statsTracker.estimatedTokensRedacted || 0) + workflowResult.stats.estimatedTokensRedacted;
            statsTracker.lastEstimatedTokensSaved = estimatedTokensSaved;
            statsTracker.lastProcessed = originalCount;
            statsTracker.lastPruned = prunedCount;
            statsTracker.lastRedacted = redactedCount;
            statsTracker.lastPressureSummary = pressureSummary;
            statsTracker.maxMessagesSeen = Math.max(statsTracker.maxMessagesSeen || 0, originalCount);
            statsTracker.lastContextSummary = workflowResult.finalContextSummary;
            if (ctx.hasUI && ctx.ui.setStatus) {
                const status = prunedCount > 0 || redactedCount > 0
                    ? `DCP ${prunedCount} pruned, ${redactedCount} redacted · ~${estimatedTokensSaved} tok saved · ${pressureSummary}`
                    : `DCP active · ${pressureSummary}`;
                ctx.ui.setStatus("pi-dcp", status);
            }
            if (config.debug) {
                ctx.ui.notify(`[pi-dcp] Pruned ${prunedCount} / ${originalCount} messages, redacted ${redactedCount}, saved ~${estimatedTokensSaved} tokens`);
            }
            return { messages: prunedMessages };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`[pi-dcp] Error in pruning workflow: ${errorMessage}`, "error");
            // Fail-safe: return original messages on error
            return { messages: event.messages };
        }
    };
}
