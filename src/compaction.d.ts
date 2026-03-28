export interface ExplicitCompactionState {
    inFlight: boolean;
    lastStartedAt: number;
    lastStartedMessageCount: number;
    lastOutcome: "idle" | "started" | "completed" | "failed";
}

export declare const DEFAULT_EXPLICIT_COMPACTION_STALE_MS: number;
export declare function createExplicitCompactionState(): ExplicitCompactionState;
export declare function beginExplicitCompaction(state: ExplicitCompactionState, messageCount: number): void;
export declare function completeExplicitCompaction(state: ExplicitCompactionState, outcome: "completed" | "failed"): void;
export declare function isExplicitCompactionStale(state: ExplicitCompactionState, now?: number, staleMs?: number): boolean;
export declare function recoverExplicitCompactionIfStale(state: ExplicitCompactionState, now?: number, staleMs?: number): boolean;
