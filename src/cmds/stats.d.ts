/**
 * DCP Stats Command
 *
 * Show pruning statistics for the current session.
 */
import { CommandDefinition } from "../types.js";
export interface StatsTracker {
    totalPruned: number;
    totalProcessed: number;
}
export declare function createStatsCommand(statsTracker: StatsTracker, ruleCount: number): CommandDefinition;
//# sourceMappingURL=stats.d.ts.map