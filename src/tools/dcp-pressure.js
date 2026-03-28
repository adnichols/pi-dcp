/**
 * Explicit context-pressure inspection tool.
 */
import { getContextPressureSnapshot } from "../context-pressure.js";
import { getOpportunityLabel, getRecommendationLabel } from "../context-pressure-rendering.js";

const EMPTY_OBJECT_SCHEMA = {
    type: "object",
    properties: {},
    additionalProperties: false,
};

function buildResultText(snapshot) {
    const usageText = typeof snapshot.usage?.percent === "number"
        ? `${snapshot.usage.percent.toFixed(0)}% context`
        : `${snapshot.analysis.totalMessages} msgs`;
    const savingsText = `~${snapshot.predicted.estimatedTokensSaved} tok saved by DCP`;
    const rationale = snapshot.rationale[0] || "no strong pressure signal";
    return `DCP pressure: ${getRecommendationLabel(snapshot.recommendation)} · ${getOpportunityLabel(snapshot.opportunityKind)} · ${usageText} · ${savingsText} · ${rationale}`;
}

export function createDcpPressureTool(config) {
    return {
        name: "dcp_pressure",
        label: "DCP Pressure",
        description: "Inspect current context pressure, branch-shift compaction opportunities, and predicted pi-dcp savings before deciding whether to compact.",
        promptSnippet: "Inspect current context pressure, branch-shift compaction opportunities, and predicted pi-dcp savings before deciding whether to compact.",
        promptGuidelines: [
            "Use this tool when pi-dcp warns about long-session pressure or before starting another heavy investigation branch.",
            "Use this tool to decide whether older closed work should become summary-only before the next branch begins.",
            "Keep active work raw; compact stale closed work when the recommendation justifies it.",
        ],
        parameters: EMPTY_OBJECT_SCHEMA,
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
            const usage = ctx.getContextUsage?.() || null;
            const snapshot = getContextPressureSnapshot(entries, config, usage);
            return {
                content: [{ type: "text", text: buildResultText(snapshot) }],
                details: snapshot,
            };
        },
    };
}
