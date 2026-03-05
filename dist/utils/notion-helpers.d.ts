/**
 * Shared Notion API helper functions
 *
 * Consolidates utility functions that were previously duplicated across
 * multiple command files: fetchAllBlocks, getPageTitle, getPropertyValue,
 * getDbTitle, blocksToMarkdownAsync.
 *
 * Exported functions:
 *   - fetchAllBlocks(client, blockId)           → Block[]   (paginated child block fetcher)
 *   - blocksToMarkdownAsync(client, blockId)     → string    (recursive async blocks → markdown)
 *   - getPageTitle(page)                         → string    (extract title from page properties)
 *   - getDbTitle(db)                             → string    (extract title from database)
 *   - getDbDescription(db)                       → string    (extract description from database)
 *   - getPropertyValue(prop)                     → string | null  (property → display string)
 */
import type { getClient } from '../client.js';
import type { Block, Page, Database } from '../types/notion.js';
/**
 * Fetch all child blocks of a given block/page, handling Notion's pagination.
 * Does NOT recurse into children — call recursively if you need the full tree.
 */
export declare function fetchAllBlocks(client: ReturnType<typeof getClient>, blockId: string): Promise<Block[]>;
/**
 * Recursively fetch all child blocks of a page/block and convert to Markdown.
 * Uses the Notion API to fetch children on-the-fly (unlike blocksToMarkdownSync
 * which requires pre-fetched blocks).
 */
export declare function blocksToMarkdownAsync(client: ReturnType<typeof getClient>, blockId: string, indent?: number): Promise<string>;
/**
 * Extract the plain-text title from a Notion page's properties.
 * Returns 'Untitled' if no title property is found or it is empty.
 */
export declare function getPageTitle(page: Page): string;
/**
 * Extract the plain-text title from a Notion database.
 * Returns 'Untitled' if no title is set.
 */
export declare function getDbTitle(db: Database): string;
/**
 * Extract the plain-text description from a Notion database.
 * Returns an empty string if no description is set.
 */
export declare function getDbDescription(db: Database): string;
/**
 * Convert a Notion property value object to a human-readable string.
 * Returns null for unsupported or empty property types.
 *
 * Handles: title, rich_text, select, status, multi_select, date, number,
 *          checkbox, url, email, phone_number, people.
 */
export declare function getPropertyValue(prop: Record<string, unknown>): string | null;
//# sourceMappingURL=notion-helpers.d.ts.map