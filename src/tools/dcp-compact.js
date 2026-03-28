/**
 * Explicit compaction trigger tool.
 */
import { beginExplicitCompaction, completeExplicitCompaction, recoverExplicitCompactionIfStale } from "../compaction.js";
import { getContextPressureSnapshot } from "../context-pressure.js";

const COMPACT_PARAMETERS_SCHEMA = {
    type: "object",
    properties: {
        focus: {
            type: "string",
            description: "Optional focus instructions describing what the compaction summary should preserve.",
        },
        force: {
            type: "boolean",
            description: "Trigger compaction even if the current recommendation would normally wait.",
        },
    },
    additionalProperties: false,
};

function buildCompactInstructions(snapshot, focus) {
    const sections = [];
    if (typeof focus === "string" && focus.trim().length > 0) {
        sections.push(`Preserve this focus during compaction: ${focus.trim()}`);
    }
    sections.push(`Current pressure snapshot: ${snapshot.summary}`);
    if (snapshot.rationale.length > 0) {
        sections.push(`Why compaction was considered: ${snapshot.rationale.join("; ")}`);
    }
    return sections.join("\n");
}

function buildResultText(status, snapshot) {
    if (status === "already-in-flight") {
        return "DCP compaction already in flight; wait for it to finish before requesting another compaction.";
    }
    if (status === "skipped") {
        return `DCP compaction skipped: ${snapshot.recommendation === "wait" ? "wait" : "clean up manually first"} · ${snapshot.rationale[0] || "pressure is currently low"}`;
    }
    return `DCP compaction started asynchronously; pause heavy exploration until it finishes. Current recommendation: ${snapshot.recommendation}.`;
}

export function createDcpCompactTool(config, state) {
    return {
        name: "dcp_compact",
        label: "DCP Compact",
        description: "Trigger pi context compaction when pressure is high and pi-dcp recommends compacting now.",
        promptSnippet: "Trigger pi compaction when context pressure is high after checking whether compaction is worthwhile.",
        promptGuidelines: [
            "Use this tool after dcp_pressure recommends compaction, or when context is clearly near capacity.",
            "After calling this tool, avoid more heavy exploration in the same turn because compaction completes asynchronously.",
        ],
        parameters: COMPACT_PARAMETERS_SCHEMA,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
            const usage = ctx.getContextUsage?.() || null;
            const snapshot = getContextPressureSnapshot(entries, config, usage);
            const force = params?.force === true;
            const recoveredStaleInFlight = recoverExplicitCompactionIfStale(state);
            if (state.inFlight) {
                return {
                    content: [{ type: "text", text: buildResultText("already-in-flight", snapshot) }],
                    details: {
                        status: "already-in-flight",
                        recommendation: snapshot.recommendation,
                        recoveredStaleInFlight,
                        snapshot,
                        state: { ...state },
                    },
                };
            }
            if (!force && snapshot.recommendation !== "compact-now") {
                return {
                    content: [{ type: "text", text: buildResultText("skipped", snapshot) }],
                    details: {
                        status: "skipped",
                        recommendation: snapshot.recommendation,
                        recoveredStaleInFlight,
                        snapshot,
                        state: { ...state },
                    },
                };
            }
            const messageCount = snapshot.analysis.originalMessageCount;
            const customInstructions = buildCompactInstructions(snapshot, params?.focus);
            beginExplicitCompaction(state, messageCount);
            const notify = (message, level = "info") => {
                if (ctx.hasUI && ctx.ui?.notify) {
                    ctx.ui.notify(message, level);
                }
            };
            if (typeof ctx.compact === "function") {
                try {
                    ctx.compact({
                        customInstructions,
                        onComplete: () => {
                            completeExplicitCompaction(state, "completed");
                            notify("[pi-dcp] Explicit compaction completed.", "info");
                        },
                        onError: (error) => {
                            completeExplicitCompaction(state, "failed");
                            const message = error instanceof Error ? error.message : String(error);
                            notify(`[pi-dcp] Explicit compaction failed: ${message}`, "error");
                        },
                    });
                }
                catch (error) {
                    completeExplicitCompaction(state, "failed");
                    const message = error instanceof Error ? error.message : String(error);
                    notify(`[pi-dcp] Explicit compaction failed: ${message}`, "error");
                    return {
                        content: [{ type: "text", text: `DCP compaction failed: ${message}` }],
                        details: {
                            status: "failed",
                            recommendation: snapshot.recommendation,
                            recoveredStaleInFlight,
                            snapshot,
                            state: { ...state },
                        },
                    };
                }
            }
            else {
                completeExplicitCompaction(state, "failed");
                return {
                    content: [{ type: "text", text: "DCP compaction failed: ctx.compact() is not available in this context." }],
                    details: {
                        status: "failed",
                        recommendation: snapshot.recommendation,
                        recoveredStaleInFlight,
                        snapshot,
                        state: { ...state },
                    },
                };
            }
            return {
                content: [{ type: "text", text: buildResultText("started", snapshot) }],
                details: {
                    status: "started",
                    recommendation: snapshot.recommendation,
                    forced: force,
                    recoveredStaleInFlight,
                    customInstructions,
                    snapshot,
                    state: { ...state },
                },
            };
        },
    };
}
