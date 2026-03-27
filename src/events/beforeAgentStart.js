/**
 * DCP before_agent_start handler.
 *
 * Injects a lightweight long-session nudge into the system prompt when the
 * session shows clear signs of repeated context churn.
 */
import { analyzeConversationPressure, formatPressureSummary } from "../analysis.js";

function getNudgeConfig(config) {
    const defaults = {
        enabled: true,
        minMessages: 60,
        minToolResults: 30,
        minRepeatCount: 3,
        minContextPercent: 70,
        notify: true,
        maxSummaryItems: 2,
    };
    return {
        ...defaults,
        ...(config.nudge && typeof config.nudge === "object" ? config.nudge : {}),
    };
}

function shouldNudge(analysis, usage, nudgeConfig) {
    if (!nudgeConfig.enabled)
        return false;
    if (analysis.totalMessages < nudgeConfig.minMessages)
        return false;
    const repeatedReadPressure = analysis.repeatedReads.some((entry) => entry.count >= nudgeConfig.minRepeatCount);
    const repeatedBashPressure = analysis.repeatedBashCommands.some((entry) => entry.count >= nudgeConfig.minRepeatCount);
    const toolPressure = analysis.roleCounts.toolResult >= nudgeConfig.minToolResults;
    const contextPressure = typeof usage?.percent === "number" && usage.percent >= nudgeConfig.minContextPercent;
    return repeatedReadPressure || repeatedBashPressure || toolPressure || contextPressure;
}

function buildNudgeSystemPrompt(event, analysis, usage, nudgeConfig) {
    const contextLine = typeof usage?.percent === "number"
        ? `Current context usage is about ${usage.percent.toFixed(0)}% of the model window.`
        : `This session already has ${analysis.totalMessages} messages and ${analysis.roleCounts.toolResult} tool results.`;
    const repeatedReads = analysis.repeatedReads
        .slice(0, nudgeConfig.maxSummaryItems)
        .map((entry) => `${entry.shortPath} x${entry.count}`)
        .join(", ");
    const repeatedCommands = analysis.repeatedBashCommands
        .slice(0, nudgeConfig.maxSummaryItems)
        .map((entry) => `${entry.shortCommand} x${entry.count}`)
        .join(", ");
    const guidance = [
        "[pi-dcp long-session nudge]",
        contextLine,
        repeatedReads ? `Repeated reads already in history: ${repeatedReads}.` : undefined,
        repeatedCommands ? `Repeated bash commands already in history: ${repeatedCommands}.` : undefined,
        "Minimize context churn:",
        "- Be terse and avoid restating unchanged plans or status.",
        "- Do not reread unchanged files or rerun identical commands unless something changed or you need a different slice.",
        "- Prefer targeted reads (offset/limit) and diff-oriented inspection over full-file rereads.",
        "- Reuse established facts from earlier tool results unless they are now stale.",
    ].filter(Boolean).join("\n");
    return `${event.systemPrompt}\n\n${guidance}`;
}

export function createBeforeAgentStartEventHandler(options) {
    const { config, statsTracker } = options;
    let lastNotifiedFingerprint = undefined;
    let lastNotifiedAtMessages = 0;
    return async (event, ctx) => {
        try {
            const entries = ctx.sessionManager.getEntries();
            const messages = entries
                .filter((entry) => entry?.type === "message")
                .map((entry) => entry.message);
            const analysis = analyzeConversationPressure(messages);
            const usage = ctx.getContextUsage?.();
            const nudgeConfig = getNudgeConfig(config);
            if (!shouldNudge(analysis, usage, nudgeConfig)) {
                return;
            }
            const summary = formatPressureSummary(analysis, { maxItems: nudgeConfig.maxSummaryItems });
            const fingerprint = JSON.stringify({
                totalMessages: analysis.totalMessages,
                topRead: analysis.repeatedReads[0]?.path,
                topReadCount: analysis.repeatedReads[0]?.count,
                topBash: analysis.repeatedBashCommands[0]?.command,
                topBashCount: analysis.repeatedBashCommands[0]?.count,
                percent: typeof usage?.percent === "number" ? Math.floor(usage.percent / 10) * 10 : null,
            });
            statsTracker.lastNudge = {
                at: new Date().toISOString(),
                summary,
                totalMessages: analysis.totalMessages,
            };
            if (lastNotifiedFingerprint !== fingerprint || analysis.totalMessages - lastNotifiedAtMessages >= 25) {
                lastNotifiedFingerprint = fingerprint;
                lastNotifiedAtMessages = analysis.totalMessages;
                statsTracker.totalNudges = (statsTracker.totalNudges || 0) + 1;
                if (ctx.hasUI && nudgeConfig.notify) {
                    ctx.ui.notify(`[pi-dcp] Long-session nudge active: ${summary}`, "info");
                }
            }
            return {
                systemPrompt: buildNudgeSystemPrompt(event, analysis, usage, nudgeConfig),
            };
        }
        catch (error) {
            if (config.debug && ctx.hasUI) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`[pi-dcp] Nudge analysis failed: ${message}`, "warning");
            }
            return;
        }
    };
}
