/**
 * Configuration management for Pi-DCP
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DcpConfigWithPruneRuleObjects, type DcpConfig } from "./types.js";
/**
 * Load configuration from extension settings, files, or defaults
 * Priority (highest to lowest):
 * 1. CLI flags (--dcp-enabled, --dcp-debug)
 * 2. Config file in current directory (dcp.config.ts, etc.)
 * 3. Config file in home directory (~/.dcprc)
 * 4. Default configuration
 */
export declare function loadConfig(pi: ExtensionAPI): Promise<DcpConfigWithPruneRuleObjects>;
/**
 * Get default configuration (useful for testing or displaying defaults)
 */
export declare function getDefaultConfig(): DcpConfig;
/**
 * Generate sample configuration file content
 * Used by the init command to create dcp.config.ts
 */
export declare function generateConfigFileContent(options?: {
    simplified?: boolean;
}): string;
/**
 * Write configuration file to the specified path
 *
 * @param path - Full path where to write the config file
 * @param options - Options for file generation
 * @returns Promise that resolves when file is written
 */
export declare function writeConfigFile(path: string, options?: {
    force?: boolean;
    simplified?: boolean;
}): Promise<void>;
//# sourceMappingURL=config.d.ts.map