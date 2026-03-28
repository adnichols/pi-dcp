export interface ExplicitCompactionState {
    inFlight: boolean;
    lastStartedAt: number;
    lastStartedMessageCount: number;
    lastOutcome: "idle" | "started" | "completed" | "failed";
}

export declare function createExplicitCompactionState(): ExplicitCompactionState;
export declare function beginExplicitCompaction(state: ExplicitCompactionState, messageCount: number): void;
export declare function completeExplicitCompaction(state: ExplicitCompactionState, outcome: "completed" | "failed"): void;
