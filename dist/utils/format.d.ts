/**
 * Formatting utilities for CLI output
 */
export declare function formatOutput(data: unknown): string;
export declare function formatPageTitle(page: unknown): string;
export declare function formatDatabaseTitle(db: unknown): string;
export declare function formatBlock(block: unknown): string;
export declare function parseProperties(props: string[]): Record<string, unknown>;
export declare function parseFilter(property: string, filterType: string, value: string, propType?: string): Record<string, unknown>;
//# sourceMappingURL=format.d.ts.map