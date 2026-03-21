/**
 * Rule registry system
 */
import type { PruneRule } from "./types.js";
/**
 * Register a pruning rule
 */
export declare function registerRule(rule: PruneRule): void;
/**
 * Get rule by name
 */
export declare function getRule(name: string): PruneRule | undefined;
/**
 * Resolve rule reference (string name or inline object)
 */
export declare function resolveRule(ruleRef: string | PruneRule): PruneRule;
/**
 * Get all registered rules
 */
export declare function getAllRules(): PruneRule[];
/**
 * Get all registered rule names
 */
export declare function getRuleNames(): string[];
//# sourceMappingURL=registry.d.ts.map