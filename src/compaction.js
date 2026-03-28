/**
 * Explicit compaction state helpers.
 */

export const DEFAULT_EXPLICIT_COMPACTION_STALE_MS = 2 * 60 * 1000;

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

export function isExplicitCompactionStale(state, now = Date.now(), staleMs = DEFAULT_EXPLICIT_COMPACTION_STALE_MS) {
    if (!state.inFlight || !state.lastStartedAt || staleMs <= 0) {
        return false;
    }
    return now - state.lastStartedAt >= staleMs;
}

export function recoverExplicitCompactionIfStale(state, now = Date.now(), staleMs = DEFAULT_EXPLICIT_COMPACTION_STALE_MS) {
    if (!isExplicitCompactionStale(state, now, staleMs)) {
        return false;
    }
    state.inFlight = false;
    state.lastOutcome = "failed";
    return true;
}
