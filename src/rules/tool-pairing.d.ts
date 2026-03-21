/**
 * Tool Pairing Rule
 *
 * Ensures that tool calls and tool results are never separated.
 * This supports both Claude-style nested `tool_use` / `tool_result` content blocks
 * and pi-mono's assistant `toolCall` plus top-level `role: "toolResult"` messages.
 *
 * Algorithm:
 * 1. Prepare: Extract tool IDs and type flags from each message
 * 2. Process: Two passes:
 *    - First pass (forward): If a tool call message is pruned, cascade prune to matching tool results
 *    - Second pass (backward): If a tool result is kept, protect its matching tool call message
 *    - Fallback: If no matching tool call exists anywhere in history, prune the orphaned tool result
 *
 * This rule MUST run AFTER all other pruning rules to protect tool pairs.
 */
import type { PruneRule } from "../types.js";
export declare const toolPairingRule: PruneRule;
//# sourceMappingURL=tool-pairing.d.ts.map