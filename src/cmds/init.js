/**
 * DCP Init Command
 *
 * Generate a default dcp.config.ts file in the current directory.
 */
import { writeConfigFile } from "../config.js";
import { join } from "path";
export function createInitCommand() {
    return {
        description: "Generate a default dcp.config.ts file in the current directory",
        handler: async (args, ctx) => {
            const configPath = join(process.cwd(), "dcp.config.ts");
            const force = args?.toLowerCase() === "--force";
            try {
                await writeConfigFile(configPath, { force });
                ctx.ui.notify(`Config file created: ${configPath}`, "info");
            }
            catch (error) {
                if (error.message?.includes("already exists")) {
                    ctx.ui.notify("Config file already exists. Use '/dcp-init --force' to overwrite.", "warning");
                }
                else {
                    ctx.ui.notify(`Failed to create config file: ${error.message || error}`, "error");
                }
            }
        },
    };
}
//# sourceMappingURL=init.js.map