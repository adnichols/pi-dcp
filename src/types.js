/**
 * Core type definitions for Pi-DCP
 */
export const isPruneRuleObject = (obj) => {
    return typeof obj === 'object'
        && obj !== null
        && 'name' in obj
        && ('prepare' in obj || 'process' in obj)
        && typeof obj.name === 'string'
        && (typeof obj.prepare === 'function'
            || typeof obj.process === 'function');
};
//# sourceMappingURL=types.js.map