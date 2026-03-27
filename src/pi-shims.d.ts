declare module "@mariozechner/pi-coding-agent" {
	export type ExtensionAPI = any;
	export type ExtensionContext = any;
	export type SessionStartEvent = any;
	export type SessionSwitchEvent = any;
	export type BeforeAgentStartEvent = any;
	export type BeforeAgentStartEventResult = any;
}

declare module "@mariozechner/pi-agent-core" {
	export type AgentMessage = any;
}

declare module "bun:test" {
	export const beforeAll: any;
	export const describe: any;
	export const expect: any;
	export const test: any;
}
