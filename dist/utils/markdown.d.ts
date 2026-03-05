/**
 * Shared Markdown ↔ Notion block conversion utilities
 *
 * Provides bidirectional conversion between Markdown text and Notion API
 * block/rich_text structures. Handles inline formatting (bold, italic, code,
 * strikethrough, links) which was previously missing from the import path.
 *
 * Exported functions:
 *   - parseInlineMarkdown(text)  → NotionRichTextItem[]  (Markdown → rich_text)
 *   - richTextToMarkdown(rt[])   → string                (rich_text → Markdown)
 *   - markdownToBlocks(md)       → NotionBlock[]         (full document → blocks)
 *   - blocksToMarkdownSync(blocks, indent) → string      (blocks → Markdown, sync)
 *   - getBlockContent(block)     → string                (single block → Markdown)
 */
import type { RichText, NotionRichTextItem, NotionBlock, Block } from '../types/notion.js';
/**
 * Parse inline Markdown formatting into an array of Notion rich_text items.
 *
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [text](url)
 * Handles nested annotations (e.g. ***bold italic***).
 * Does NOT parse block-level elements — those are handled by markdownToBlocks.
 */
export declare function parseInlineMarkdown(text: string): NotionRichTextItem[];
/**
 * Convert an array of Notion rich_text objects to a Markdown string.
 * Handles bold, italic, code, strikethrough annotations, and links.
 */
export declare function richTextToMarkdown(richText: RichText[]): string;
/**
 * Convert a single Notion block to its Markdown string representation.
 * Handles all common block types.
 */
export declare function getBlockContent(block: Block): string;
/**
 * Convert an array of already-fetched blocks (with optional .children) to
 * Markdown. This is the synchronous version that works on pre-fetched block
 * trees (as used by backup.ts). For the async version that fetches children
 * on-the-fly, see blocksToMarkdownAsync in the consumer modules.
 */
export declare function blocksToMarkdownSync(blocks: Block[], indent?: number): string;
/**
 * Convert a Markdown document string to an array of Notion blocks.
 *
 * Handles:
 *   - Headings (# ## ###)
 *   - Bullet lists (- or *)
 *   - Numbered lists (1. 2. etc.)
 *   - Todos (- [ ] / - [x])
 *   - Block quotes (>)
 *   - Fenced code blocks (```)
 *   - Dividers (---)
 *   - Images (![alt](url))
 *   - Paragraphs (everything else)
 *
 * Inline formatting within each line is parsed via parseInlineMarkdown().
 */
export declare function markdownToBlocks(markdown: string): NotionBlock[];
//# sourceMappingURL=markdown.d.ts.map