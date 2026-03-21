/**
 * Standalone E2E Validation Test for pi-dcp with pi-mono/GPT-5.x message format
 *
 * This test generates realistic long-horizon conversation data and validates
 * that pi-dcp correctly prunes context without creating orphaned tool results.
 */

import { applyPruningWorkflow } from "./src/workflow.js";
import { deduplicationRule } from "./src/rules/deduplication.js";
import { supersededWritesRule } from "./src/rules/superseded-writes.js";
import { errorPurgingRule } from "./src/rules/error-purging.js";
import { toolPairingRule } from "./src/rules/tool-pairing.js";
import { recencyRule } from "./src/rules/recency.js";
import { DcpConfigWithPruneRuleObjects } from "./src/types.js";

// Types matching pi-mono/pi-agent-core AgentMessage
interface TextContent {
	type: "text";
	text: string;
}

interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

interface UserMessage {
	role: "user";
	content: (TextContent | ToolCallContent)[];
	timestamp?: number;
}

interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ToolCallContent)[];
	api?: string;
	provider?: string;
	model?: string;
	usage?: {
		input: number;
		output: number;
		totalTokens: number;
	};
	stopReason?: string;
	timestamp?: number;
}

interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: TextContent[];
	isError?: boolean;
	details?: Record<string, unknown>;
	timestamp?: number;
}

type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

// Test configuration matching production
const productionConfig: DcpConfigWithPruneRuleObjects = {
	enabled: true,
	debug: true,
	rules: [deduplicationRule, supersededWritesRule, errorPurgingRule, toolPairingRule, recencyRule],
	keepRecentCount: 10,
};

// Helper functions
function userMessage(text: string): UserMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function assistantWithToolCall(
	text: string,
	toolCalls: { id: string; name: string; args: Record<string, unknown> }[]
): AssistantMessage {
	const content: (TextContent | ToolCallContent)[] = [{ type: "text", text }];
	for (const tc of toolCalls) {
		content.push({
			type: "toolCall",
			id: tc.id,
			name: tc.name,
			arguments: tc.args,
		});
	}
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.3-codex",
		usage: { input: 1000, output: 150, totalTokens: 1150 },
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function toolResult(
	id: string,
	toolName: string,
	text: string,
	isError = false,
	details?: Record<string, unknown>
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName,
		content: text ? [{ type: "text", text }] : [],
		isError,
		details,
		timestamp: Date.now(),
	};
}

// Verification functions
function verifyNoOrphanedToolResults(messages: AgentMessage[], label: string): boolean {
	const toolCallIds = new Set<string>();
	for (const msg of messages) {
		if (msg.role === "assistant" && "content" in msg) {
			for (const part of msg.content) {
				if (part.type === "toolCall" && "id" in part) {
					toolCallIds.add(part.id);
				}
			}
		}
	}

	let orphanedCount = 0;
	for (const msg of messages) {
		if (msg.role === "toolResult") {
			if (!toolCallIds.has(msg.toolCallId)) {
				console.error(`❌ ${label}: Orphaned toolResult found - callId: ${msg.toolCallId}`);
				orphanedCount++;
			}
		}
	}

	if (orphanedCount === 0) {
		console.log(`✅ ${label}: No orphaned tool results`);
	}
	return orphanedCount === 0;
}

function verifyAllToolCallsHaveResults(messages: AgentMessage[], label: string): boolean {
	const toolResultIds = new Set<string>();
	for (const msg of messages) {
		if (msg.role === "toolResult") {
			toolResultIds.add(msg.toolCallId);
		}
	}

	let missingResults = 0;
	for (const msg of messages) {
		if (msg.role === "assistant" && "content" in msg) {
			for (const part of msg.content) {
				if (part.type === "toolCall" && "id" in part) {
					if (!toolResultIds.has(part.id)) {
						console.warn(`⚠️  ${label}: toolCall without result - id: ${part.id}`);
						missingResults++;
					}
				}
			}
		}
	}

	if (missingResults === 0) {
		console.log(`✅ ${label}: All tool calls have results (or are in-progress)`);
	}
	return true; // Not a failure - could be in-progress
}

// Generate realistic long-horizon conversation
function generateLongHorizonConversation(): AgentMessage[] {
	const messages: AgentMessage[] = [];
	let callCounter = 0;

	// Initial request
	messages.push(userMessage("Please analyze this codebase for refactoring opportunities. Focus on main.ts and tui-renderer.ts"));

	// Turn 1: Read files
	const call1 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("I'll read both files to analyze them.", [
		{ id: call1, name: "read", args: { path: "/workspace/project/src/main.ts" } },
	]));
	messages.push(toolResult(call1, "read", "// Main entry point\nimport { App } from './app';\nconst app = new App();\napp.start();"));

	// Turn 2: Read second file
	const call2 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("Now let me read the tui-renderer file.", [
		{ id: call2, name: "read", args: { path: "/workspace/project/src/tui/tui-renderer.ts" } },
	]));
	messages.push(toolResult(call2, "read", "// TUI Renderer\nclass TUIRenderer { /* ... 500 lines ... */ }"));

	// Turn 3: Grep for patterns (first attempt fails)
	const call3 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("Let me search for code duplication patterns.", [
		{ id: call3, name: "grep", args: { pattern: "function handleEvent", path: "/workspace/project/src" } },
	]));
	messages.push(toolResult(call3, "grep", "", true, { error: "No matches found" }));

	// Turn 4: Grep retry with different pattern (success)
	const call4 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("Let me try a broader search.", [
		{ id: call4, name: "grep", args: { pattern: "handleEvent", path: "/workspace/project/src" } },
	]));
	messages.push(toolResult(call4, "grep", "main.ts:10:handleEvent()\ntui-renderer.ts:20:handleEvent()"));

	// Turn 5: Write analysis file (first version)
	const call5 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("I'll create an analysis document with my findings.", [
		{ id: call5, name: "write", args: { path: "/workspace/project/ANALYSIS.md", content: "# Initial Analysis\n\nFound 2 files with handleEvent..." } },
	]));
	messages.push(toolResult(call5, "write", "File written successfully", false, { path: "/workspace/project/ANALYSIS.md" }));

	// Turn 6: Update analysis (supersedes previous)
	const call6 = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("Let me update the analysis with more findings.", [
		{ id: call6, name: "write", args: { path: "/workspace/project/ANALYSIS.md", content: "# Detailed Analysis\n\nFound 3 duplication patterns...\n\n## Recommendations\n1. Extract shared event handling..." } },
	]));
	messages.push(toolResult(call6, "write", "File updated", false, { path: "/workspace/project/ANALYSIS.md" }));

	// Turns 7-15: Multiple tool calls exploring codebase
	for (let i = 0; i < 9; i++) {
		const callId = `call_${++callCounter}`;
		const toolName = i % 3 === 0 ? "read" : i % 3 === 1 ? "grep" : "bash";
		const args = toolName === "read" 
			? { path: `/workspace/project/src/file${i}.ts` }
			: toolName === "grep"
			? { pattern: `pattern${i}`, path: "/workspace/project/src" }
			: { command: `echo "Analysis step ${i}"` };

		messages.push(assistantWithToolCall(`Exploring codebase - step ${i + 7}.`, [
			{ id: callId, name: toolName, args },
		]));
		messages.push(toolResult(callId, toolName, `Result for step ${i + 7}`));
	}

	// Turn 16: Complex multi-tool call (read + grep + write)
	const call17a = `call_${++callCounter}`;
	const call17b = `call_${++callCounter}`;
	const call17c = `call_${++callCounter}`;
	messages.push(assistantWithToolCall("Final analysis phase - reading, searching, and documenting.", [
		{ id: call17a, name: "read", args: { path: "/workspace/project/src/utils.ts" } },
		{ id: call17b, name: "grep", args: { pattern: "export", path: "/workspace/project/src", output: "count" } },
		{ id: call17c, name: "write", args: { path: "/workspace/project/REFACTOR_PLAN.md", content: "# Refactoring Plan\n\nBased on analysis..." } },
	]));
	messages.push(toolResult(call17a, "read", "// Utils\nexport const helper = () => {};"));
	messages.push(toolResult(call17b, "grep", "15"));
	messages.push(toolResult(call17c, "write", "Plan documented", false, { path: "/workspace/project/REFACTOR_PLAN.md" }));

	// Turns 17-25: More exploration creating long history
	for (let i = 0; i < 9; i++) {
		const callId = `call_${++callCounter}`;
		messages.push(assistantWithToolCall(`Additional exploration ${i + 17}.`, [
			{ id: callId, name: "bash", args: { command: `find /workspace/project -name "*.ts" | head -${i + 1}` } },
		]));
		messages.push(toolResult(callId, "bash", `/workspace/project/src/file${i}.ts`));
	}

	// Final user message
	messages.push(userMessage("Thanks for the analysis. Please summarize the key refactoring priorities."));

	return messages;
}

// Run validation test
console.log("=".repeat(70));
console.log("pi-dcp E2E Validation Test");
console.log("Testing with realistic pi-mono/GPT-5.x conversation format");
console.log("=".repeat(70));

const conversation = generateLongHorizonConversation();
console.log(`\n📊 Generated conversation: ${conversation.length} messages`);

// Count message types
const userCount = conversation.filter((m) => m.role === "user").length;
const assistantCount = conversation.filter((m) => m.role === "assistant").length;
const toolResultCount = conversation.filter((m) => m.role === "toolResult").length;
console.log(`   - User messages: ${userCount}`);
console.log(`   - Assistant messages: ${assistantCount}`);
console.log(`   - Tool results: ${toolResultCount}`);

console.log("\n🔍 Before pruning:");
const beforeValid = verifyNoOrphanedToolResults(conversation, "Before");

console.log("\n🧹 Running pi-dcp pruning workflow...");
const pruned = applyPruningWorkflow(conversation, productionConfig);

console.log(`\n📊 After pruning: ${pruned.length} messages`);
console.log(`   - Pruned ${conversation.length - pruned.length} messages (${(((conversation.length - pruned.length) / conversation.length) * 100).toFixed(1)}%)`);

const afterValid = verifyNoOrphanedToolResults(pruned, "After");
verifyAllToolCallsHaveResults(pruned, "After");

// Additional edge case tests
console.log("\n" + "=".repeat(70));
console.log("Edge Case Tests");
console.log("=".repeat(70));

// Test 1: Orphaned toolResult input (should be removed)
console.log("\n🧪 Test 1: Already-orphaned toolResult input");
const orphanedTest = [
	userMessage("Test"),
	toolResult("missing_call", "read", "orphaned data"),
];
const orphanedResult = applyPruningWorkflow(orphanedTest, { ...productionConfig, keepRecentCount: 10 });
const orphanedCheck = !orphanedResult.some((m) => m.role === "toolResult");
console.log(orphanedCheck ? "✅ Orphaned toolResult correctly removed" : "❌ Orphaned toolResult still present");

// Test 2: Failed write retry (failed should not supersede success)
console.log("\n🧪 Test 2: Failed write retry");
const callA = "write_success";
const callB = "write_failed";
const retryTest = [
	userMessage("Write file"),
	assistantWithToolCall("Writing first version.", [{ id: callA, name: "write", args: { path: "out.txt", content: "v1" } }]),
	toolResult(callA, "write", "Success", false, { path: "out.txt" }),
	assistantWithToolCall("Retrying with changes.", [{ id: callB, name: "write", args: { path: "out.txt", content: "v2" } }]),
	toolResult(callB, "write", "Permission denied", true, { path: "out.txt" }),
];
const retryResult = applyPruningWorkflow(retryTest, { ...productionConfig, keepRecentCount: 0 });
const successPreserved = retryResult.some((m) => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === callA);
console.log(successPreserved ? "✅ Successful write preserved despite failed retry" : "❌ Successful write was incorrectly pruned");

// Summary
console.log("\n" + "=".repeat(70));
console.log("Validation Summary");
console.log("=".repeat(70));
const allPassed = beforeValid && afterValid && orphanedCheck && successPreserved;
console.log(allPassed ? "\n✅ All validation tests PASSED" : "\n❌ Some validation tests FAILED");

process.exit(allPassed ? 0 : 1);
