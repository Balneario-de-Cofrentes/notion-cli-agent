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
import { getBlockContent } from './markdown.js';
// ─── Block Fetching ─────────────────────────────────────────────────────────
/**
 * Fetch all child blocks of a given block/page, handling Notion's pagination.
 * Does NOT recurse into children — call recursively if you need the full tree.
 */
export async function fetchAllBlocks(client, blockId) {
    const blocks = [];
    let cursor;
    do {
        const params = cursor ? `?start_cursor=${cursor}` : '';
        const result = await client.get(`blocks/${blockId}/children${params}`);
        blocks.push(...result.results);
        cursor = result.has_more ? result.next_cursor : undefined;
    } while (cursor);
    return blocks;
}
// ─── Blocks → Markdown (async, recursive) ──────────────────────────────────
/**
 * Recursively fetch all child blocks of a page/block and convert to Markdown.
 * Uses the Notion API to fetch children on-the-fly (unlike blocksToMarkdownSync
 * which requires pre-fetched blocks).
 */
export async function blocksToMarkdownAsync(client, blockId, indent = 0) {
    const blocks = await fetchAllBlocks(client, blockId);
    let markdown = '';
    const indentStr = '  '.repeat(indent);
    for (const block of blocks) {
        let content = getBlockContent(block);
        // Add indentation for nested content
        if (indent > 0) {
            content = content
                .split('\n')
                .map(line => (line ? indentStr + line : ''))
                .join('\n');
        }
        markdown += content;
        // Recursively handle children
        if (block.has_children) {
            const childContent = await blocksToMarkdownAsync(client, block.id, indent + 1);
            markdown += childContent;
        }
    }
    return markdown;
}
// ─── Title Extraction ───────────────────────────────────────────────────────
/**
 * Extract the plain-text title from a Notion page's properties.
 * Returns 'Untitled' if no title property is found or it is empty.
 */
export function getPageTitle(page) {
    for (const value of Object.values(page.properties)) {
        const prop = value;
        if (prop.type === 'title' && prop.title) {
            return prop.title.map(t => t.plain_text).join('') || 'Untitled';
        }
    }
    return 'Untitled';
}
/**
 * Extract the plain-text title from a Notion database.
 * Returns 'Untitled' if no title is set.
 */
export function getDbTitle(db) {
    return db.title?.map(t => t.plain_text).join('') || 'Untitled';
}
/**
 * Extract the plain-text description from a Notion database.
 * Returns an empty string if no description is set.
 */
export function getDbDescription(db) {
    return db.description?.map(t => t.plain_text).join('') || '';
}
// ─── Property Value Extraction ──────────────────────────────────────────────
/**
 * Convert a Notion property value object to a human-readable string.
 * Returns null for unsupported or empty property types.
 *
 * Handles: title, rich_text, select, status, multi_select, date, number,
 *          checkbox, url, email, phone_number, people.
 */
export function getPropertyValue(prop) {
    const type = prop.type;
    const data = prop[type];
    switch (type) {
        case 'title':
        case 'rich_text':
            return (data
                ?.map(t => t.plain_text)
                .join('') || null);
        case 'select':
        case 'status':
            return data?.name || null;
        case 'multi_select':
            return (data?.map(s => s.name).join(', ') || null);
        case 'date': {
            const dateData = data;
            return dateData?.start || null;
        }
        case 'number':
            return data != null ? String(data) : null;
        case 'checkbox':
            return data ? 'Yes' : 'No';
        case 'url':
        case 'email':
        case 'phone_number':
            return data || null;
        case 'people':
            return (data
                ?.map(p => p.name)
                .filter(Boolean)
                .join(', ') || null);
        default:
            return null;
    }
}
//# sourceMappingURL=notion-helpers.js.map