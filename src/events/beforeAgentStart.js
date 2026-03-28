/**
 * DCP before_agent_start handler.
 *
 * Injects a lightweight long-session nudge into the system prompt when the
 * session shows clear signs of repeated context churn.
 */
import { getContextPressureSnapshot } from "../context-pressure.js";
import { getRecommendationSentence, getRecommendationSeverity } from "../context-pressure-rendering.js";

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

function shouldNudge(snapshot, nudgeConfig) {
    if (!nudgeConfig.enabled)
        return false;
    if (snapshot.recommendation !== "wait") {
        return true;
    }
    if (snapshot.analysis.totalMessages < nudgeConfig.minMessages)
        return false;
    const repeatedReadPressure = snapshot.analysis.repeatedReads.some((entry) => entry.count >= nudgeConfig.minRepeatCount);
    const repeatedBashPressure = snapshot.analysis.repeatedBashCommands.some((entry) => entry.count >= nudgeConfig.minRepeatCount);
    const toolPressure = snapshot.analysis.roleCounts.toolResult >= nudgeConfig.minToolResults;
    const contextPressure = typeof snapshot.usage?.percent === "number" && snapshot.usage.percent >= nudgeConfig.minContextPercent;
    return repeatedReadPressure || repeatedBashPressure || toolPressure || contextPressure;
}

function buildNudgeSystemPrompt(event, snapshot, nudgeConfig) {
    const contextLine = typeof snapshot.usage?.percent === "number"
        ? `Current context usage is about ${snapshot.usage.percent.toFixed(0)}% of the model window.`
        : `This session already has ${snapshot.analysis.totalMessages} messages and ${snapshot.analysis.roleCounts.toolResult} tool results.`;
    const repeatedReads = snapshot.analysis.repeatedReads
        .slice(0, nudgeConfig.maxSummaryItems)
        .map((entry) => `${entry.shortPath} x${entry.count}`)
        .join(", ");
    const repeatedCommands = snapshot.analysis.repeatedBashCommands
        .slice(0, nudgeConfig.maxSummaryItems)
        .map((entry) => `${entry.shortCommand} x${entry.count}`)
        .join(", ");
    const severity = getRecommendationSeverity(snapshot);
    const severityGuidance = severity === "critical-context"
        ? [
            "Critical context pressure is active.",
            "Compact now before normal exploration continues unless you are finishing a truly atomic step.",
        ]
        : severity === "branch-shift"
            ? [
                "A substantial prior turn looks closed and the next branch has just started.",
                "Inspect with dcp_pressure if needed, then compact before starting another heavy branch.",
            ]
            : [
                "Minimize context churn and inspect pressure before adding more exploratory context.",
            ];
    const guidance = [
        "[pi-dcp long-session nudge]",
        contextLine,
        repeatedReads ? `Repeated reads already in history: ${repeatedReads}.` : undefined,
        repeatedCommands ? `Repeated bash commands already in history: ${repeatedCommands}.` : undefined,
        snapshot.predicted.estimatedTokensSaved > 0 ? `Predicted ordinary pi-dcp savings right now: ~${snapshot.predicted.estimatedTokensSaved} tokens.` : undefined,
        getRecommendationSentence(snapshot.recommendation),
        ...severityGuidance,
        "Actionable path: call dcp_pressure to inspect current pressure and call dcp_compact to trigger compaction when it is recommended.",
        "Context stance:",
        "- Keep active work raw.",
        "- Compact stale closed work when it is summary-safe.",
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
            const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
            const messages = entries
                .filter((entry) => entry?.type === "message")
                .map((entry) => entry.message);
            const usage = ctx.getContextUsage?.();
            const nudgeConfig = getNudgeConfig(config);
            const snapshot = getContextPressureSnapshot(messages, config, usage, {
                maxItems: nudgeConfig.maxSummaryItems,
            });
            if (!shouldNudge(snapshot, nudgeConfig)) {
                return;
            }
            const summary = snapshot.summary;
            const fingerprint = JSON.stringify({
                totalMessages: snapshot.analysis.totalMessages,
                recommendation: snapshot.recommendation,
                topRead: snapshot.analysis.repeatedReads[0]?.path,
                topReadCount: snapshot.analysis.repeatedReads[0]?.count,
                topBash: snapshot.analysis.repeatedBashCommands[0]?.command,
                topBashCount: snapshot.analysis.repeatedBashCommands[0]?.count,
                percent: typeof usage?.percent === "number" ? Math.floor(usage.percent / 10) * 10 : null,
            });
            statsTracker.lastNudge = {
                at: new Date().toISOString(),
                summary,
                totalMessages: snapshot.analysis.totalMessages,
            };
            if (lastNotifiedFingerprint !== fingerprint || snapshot.analysis.totalMessages - lastNotifiedAtMessages >= 25) {
                lastNotifiedFingerprint = fingerprint;
                lastNotifiedAtMessages = snapshot.analysis.totalMessages;
                statsTracker.totalNudges = (statsTracker.totalNudges || 0) + 1;
                if (ctx.hasUI && nudgeConfig.notify) {
                    ctx.ui.notify(`[pi-dcp] Long-session nudge active: ${summary}`, "info");
                }
            }
            return {
                systemPrompt: buildNudgeSystemPrompt(event, snapshot, nudgeConfig),
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
