/// <reference path="./test-shims.d.ts" />

import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getContextPressureSnapshot } from "../src/context-pressure";
import { registerRule } from "../src/registry";
import { deduplicationRule } from "../src/rules/deduplication";
import { errorPurgingRule } from "../src/rules/error-purging";
import { recencyRule } from "../src/rules/recency";
import { staleFileReadsRule } from "../src/rules/stale-file-reads";
import { supersededToolResultsRule } from "../src/rules/superseded-tool-results";
import { supersededWritesRule } from "../src/rules/superseded-writes";
import { toolPairingRule } from "../src/rules/tool-pairing";
import type { DcpConfigWithPruneRuleObjects } from "../src/types";
import { assistantToolCall, toolResult } from "./pruning-test-helpers";

describe("Context pressure recommendation", () => {
	beforeAll(() => {
		registerRule(deduplicationRule);
		registerRule(supersededWritesRule);
		registerRule(errorPurgingRule);
		registerRule(supersededToolResultsRule);
		registerRule(staleFileReadsRule);
		registerRule(toolPairingRule);
		registerRule(recencyRule);
	});

	const config: DcpConfigWithPruneRuleObjects = {
		enabled: true,
		debug: false,
		rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, supersededToolResultsRule, staleFileReadsRule, toolPairingRule, recencyRule],
		keepRecentCount: 0,
		protectedTools: [],
		protectedFilePatterns: [],
		ageGates: {
			supersededToolResults: 0,
			errorPurging: 0,
			supersededWrites: 0,
			staleFileReads: 0,
		},
		redaction: {
			supersededToolResults: false,
			resolvedErrors: false,
			staleFileReads: false,
		},
	};

	function buildLargePreviousTurn(latestUserContent = "Start a new branch"): AgentMessage[] {
		return [
			{ role: "user", content: "Investigate the issue deeply" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "src/a.ts", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "A".repeat(900)),
			assistantToolCall("read_2", "read", { path: "src/b.ts", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "B".repeat(900)),
			assistantToolCall("read_3", "read", { path: "src/c.ts", offset: 0, limit: 20 }),
			toolResult("read_3", "read", "C".repeat(900)),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src/a.ts", timeout: 30 }),
			toolResult("bash_1", "bash", "D".repeat(900)),
			assistantToolCall("bash_2", "bash", { command: "rg -n TODO src/b.ts", timeout: 30 }),
			toolResult("bash_2", "bash", "E".repeat(900)),
			{ role: "assistant", content: "Investigation complete." } as AgentMessage,
			{ role: "user", content: latestUserContent } as AgentMessage,
		];
	}

	test("recommends wait when pressure and predicted savings are low", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "single read result"),
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 32,
			tokens: 8000,
		});

		expect(snapshot.recommendation).toBe("wait");
		expect(snapshot.opportunityKind).toBe("none");
		expect(snapshot.predicted.prunedCount).toBe(0);
		expect(snapshot.predicted.estimatedTokensSaved).toBe(0);
		expect(snapshot.rationale.length).toBeGreaterThan(0);
	});

	test("recommends compaction when context usage is high even if predicted savings are small", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Inspect the file" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "single read result"),
			{ role: "assistant", content: "Done." } as AgentMessage,
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 86,
			tokens: 118000,
		});

		expect(snapshot.recommendation).toBe("compact-now");
		expect(snapshot.opportunityKind).toBe("hard-pressure");
		expect(snapshot.rationale.some((reason) => reason.includes("context usage"))).toBe(true);
	});

	test("recommends compaction when tool-result pressure is high and predicted savings are meaningful", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Deep inspection" } as AgentMessage,
			assistantToolCall("read_1", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_1", "read", "old read ".repeat(100)),
			assistantToolCall("read_2", "read", { path: "README.md", offset: 0, limit: 20 }),
			toolResult("read_2", "read", "new read"),
			assistantToolCall("bash_1", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_1", "bash", "old grep ".repeat(100)),
			assistantToolCall("bash_2", "bash", { command: "rg -n TODO src", timeout: 30 }),
			toolResult("bash_2", "bash", "new grep"),
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 64,
			tokens: 54000,
		});

		expect(snapshot.recommendation).toBe("compact-now");
		expect(snapshot.opportunityKind).toBe("hard-pressure");
		expect(snapshot.predicted.prunedCount).toBe(2);
		expect(snapshot.predicted.estimatedTokensSaved).toBeGreaterThan(400);
		expect(snapshot.analysis.repeatedReads[0]?.count).toBe(2);
		expect(snapshot.analysis.repeatedBashCommands[0]?.count).toBe(2);
	});

	test("recommends compact-before-next-branch for a substantial previous turn and fresh user branch", () => {
		const messages = buildLargePreviousTurn("Now implement the fix");
		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 72,
			tokens: 64000,
		});

		expect(snapshot.recommendation).toBe("compact-before-next-branch");
		expect(snapshot.opportunityKind).toBe("closed-workstream");
		expect(snapshot.analysis.hasClosedWorkstreamBoundary).toBe(true);
		expect(snapshot.analysis.previousTurnMessageCount).toBeGreaterThanOrEqual(12);
		expect(snapshot.analysis.previousTurnToolResultCount).toBeGreaterThanOrEqual(5);
		expect(snapshot.analysis.previousTurnEstimatedTokens).toBeGreaterThanOrEqual(1200);
		expect(snapshot.analysis.previousTurnUnresolvedErrorCount).toBe(0);
	});

	test("small prior turns do not produce a closed-workstream recommendation", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Quick question" } as AgentMessage,
			{ role: "assistant", content: "Quick answer." } as AgentMessage,
			{ role: "user", content: "Now implement something larger" } as AgentMessage,
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 72,
			tokens: 22000,
		});

		expect(snapshot.recommendation).toBe("wait");
		expect(snapshot.opportunityKind).toBe("none");
		expect(snapshot.analysis.hasClosedWorkstreamBoundary).toBe(false);
	});

	test("boundary signal persists through shallow probing but disappears after meaningful new-branch work begins", () => {
		const shallowProbeMessages: AgentMessage[] = [
			...buildLargePreviousTurn("Start coding now"),
			assistantToolCall("read_new_1", "read", { path: "src/new.ts", offset: 0, limit: 20 }),
			toolResult("read_new_1", "read", "fresh read"),
		];
		const shallowSnapshot = getContextPressureSnapshot(shallowProbeMessages, config, {
			percent: 72,
			tokens: 70000,
		});
		expect(shallowSnapshot.recommendation).toBe("compact-before-next-branch");
		expect(shallowSnapshot.analysis.boundaryWindowActive).toBe(true);
		expect(shallowSnapshot.analysis.successfulNonDcpToolResultsSinceLatestUser).toBe(1);

		const expiredMessages: AgentMessage[] = [
			...shallowProbeMessages,
			assistantToolCall("read_new_2", "read", { path: "src/newer.ts", offset: 0, limit: 20 }),
			toolResult("read_new_2", "read", "second fresh read"),
		];
		const expiredSnapshot = getContextPressureSnapshot(expiredMessages, config, {
			percent: 72,
			tokens: 72000,
		});
		expect(expiredSnapshot.analysis.boundaryWindowActive).toBe(false);
		expect(expiredSnapshot.analysis.successfulNonDcpToolResultsSinceLatestUser).toBe(2);
		expect(expiredSnapshot.recommendation).toBe("wait");
	});

	test("same-workstream continuation messages stay suppressed", () => {
		for (const latestUserContent of [
			"continue",
			"finish the refactor above",
			"fix the failing test from that change",
			"continue in the same file",
		]) {
			const snapshot = getContextPressureSnapshot(buildLargePreviousTurn(latestUserContent), config, {
				percent: 72,
				tokens: 64000,
			});
			expect(snapshot.recommendation).toBe("wait");
			expect(snapshot.analysis.continuationSuppressed).toBe(true);
		}
	});

	test("hard-pressure wins precedence when closed-workstream and hard-pressure signals coexist", () => {
		const snapshot = getContextPressureSnapshot(buildLargePreviousTurn("Now implement the fix"), config, {
			percent: 86,
			tokens: 125000,
		});

		expect(snapshot.analysis.hasClosedWorkstreamBoundary).toBe(true);
		expect(snapshot.opportunityKind).toBe("hard-pressure");
		expect(snapshot.recommendation).toBe("compact-now");
	});

	test("ignores dcp inspection and compaction tool traffic in recommendation calculations", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Check whether we should compact" } as AgentMessage,
			assistantToolCall("dcp_1", "dcp_pressure", {}),
			toolResult("dcp_1", "dcp_pressure", "pressure snapshot"),
			assistantToolCall("dcp_2", "dcp_compact", { focus: "keep active task" }),
			toolResult("dcp_2", "dcp_compact", "compaction started"),
			assistantToolCall("dcp_3", "dcp_pressure", {}),
			toolResult("dcp_3", "dcp_pressure", "pressure snapshot again"),
		];

		const snapshot = getContextPressureSnapshot(messages, config, {
			percent: 38,
			tokens: 12000,
		});

		expect(snapshot.recommendation).toBe("wait");
		expect(snapshot.opportunityKind).toBe("none");
		expect(snapshot.analysis.totalMessages).toBe(1);
		expect(snapshot.analysis.roleCounts.toolResult).toBe(0);
		expect(snapshot.predicted.prunedCount).toBe(0);
		expect(snapshot.predicted.estimatedTokensSaved).toBe(0);
	});

	test("threshold boundaries remain stable at the locked cutoffs", () => {
		const baseMessages: AgentMessage[] = [
			{ role: "user", content: "Earlier branch" } as AgentMessage,
			{ role: "assistant", content: "A".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "B".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "C".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "D".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "E".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "F".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "G".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "H".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "I".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "J".repeat(100) } as AgentMessage,
			{ role: "assistant", content: "K".repeat(100) } as AgentMessage,
			{ role: "user", content: "Start something new" } as AgentMessage,
		];
		const belowThresholdSnapshot = getContextPressureSnapshot(baseMessages, config, {
			percent: 69,
			tokens: 35000,
		}, {
			thresholds: {
				compactContextPercent: 80,
				meaningfulSavingsTokens: 400,
				repeatedOperationCount: 2,
				previousTurnMessageCount: 12,
				previousTurnToolResultCount: 6,
				previousTurnEstimatedTokens: 5000,
				totalMessages: 40,
				totalToolResults: 20,
				branchShiftContextPercent: 70,
				branchShiftGraceToolResults: 2,
				branchShiftGraceMessages: 6,
			},
		});
		expect(belowThresholdSnapshot.recommendation).toBe("wait");

		const atThresholdSnapshot = getContextPressureSnapshot(baseMessages, config, {
			percent: 70,
			tokens: 35000,
		}, {
			thresholds: {
				compactContextPercent: 80,
				meaningfulSavingsTokens: 400,
				repeatedOperationCount: 2,
				previousTurnMessageCount: 12,
				previousTurnToolResultCount: 6,
				previousTurnEstimatedTokens: 5000,
				totalMessages: 40,
				totalToolResults: 20,
				branchShiftContextPercent: 70,
				branchShiftGraceToolResults: 2,
				branchShiftGraceMessages: 6,
			},
		});
		expect(atThresholdSnapshot.recommendation).toBe("compact-before-next-branch");
	});
});
