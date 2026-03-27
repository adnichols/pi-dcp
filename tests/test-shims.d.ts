declare module "bun:test" {
	export function beforeAll(fn: (...args: any[]) => any): void;
	export function describe(name: string, fn: (...args: any[]) => any): void;
	export function test(name: string, fn: (...args: any[]) => any): void;
	export function expect(value: any): any;
}

declare module "@mariozechner/pi-agent-core" {
	export interface AgentMessage {
		role: string;
		content?: any;
		toolCallId?: string;
		toolName?: string;
		isError?: boolean;
		timestamp?: number;
		details?: Record<string, any>;
		[key: string]: any;
	}
}
