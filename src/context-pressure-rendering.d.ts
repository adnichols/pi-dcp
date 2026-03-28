export declare function getRecommendationLabel(recommendation: "compact-before-next-branch" | "compact-now" | "wait"): string;
export declare function getRecommendationSentence(recommendation: "compact-before-next-branch" | "compact-now" | "wait"): string;
export declare function getOpportunityLabel(opportunityKind: "none" | "closed-workstream" | "hard-pressure"): string;
export declare function getRecommendationSeverity(snapshot: {
    opportunityKind: "none" | "closed-workstream" | "hard-pressure";
    recommendation: "compact-before-next-branch" | "compact-now" | "wait";
}): "branch-shift" | "critical-context" | "generic";
