/**
 * Explicit compaction state helpers.
 */

export function createExplicitCompactionState() {
    return {
        inFlight: false,
        lastStartedAt: 0,
        lastStartedMessageCount: 0,
        lastOutcome: "idle",
    };
}

export function beginExplicitCompaction(state, messageCount) {
    state.inFlight = true;
    state.lastStartedAt = Date.now();
    state.lastStartedMessageCount = messageCount;
    state.lastOutcome = "started";
}

export function completeExplicitCompaction(state, outcome) {
    state.inFlight = false;
    state.lastOutcome = outcome;
}
