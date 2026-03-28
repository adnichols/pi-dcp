/**
 * Shared wording helpers for context-pressure recommendations.
 */

export function getRecommendationLabel(recommendation) {
    if (recommendation === "compact-now") {
        return "compact now";
    }
    if (recommendation === "compact-before-next-branch") {
        return "compact before next branch";
    }
    return "wait";
}

export function getRecommendationSentence(recommendation) {
    return `Current recommendation: ${getRecommendationLabel(recommendation)}.`;
}

export function getOpportunityLabel(opportunityKind) {
    if (opportunityKind === "hard-pressure") {
        return "urgent context-limit pressure";
    }
    if (opportunityKind === "closed-workstream") {
        return "closed-workstream compaction opportunity";
    }
    return "no compaction-specific opportunity";
}

export function getRecommendationSeverity(snapshot) {
    if (snapshot.opportunityKind === "hard-pressure" && snapshot.recommendation === "compact-now") {
        return "critical-context";
    }
    if (snapshot.opportunityKind === "closed-workstream" && snapshot.recommendation === "compact-before-next-branch") {
        return "branch-shift";
    }
    return "generic";
}
