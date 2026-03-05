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

import type {
  RichText,
  RichTextAnnotations,
  NotionRichTextItem,
  NotionBlock,
  Block,
  BlockData,
} from '../types/notion.js';

// ─── Inline Markdown → Notion Rich Text ─────────────────────────────────────

/**
 * Token types produced by the inline tokenizer.
 */
interface InlineToken {
  text: string;
  annotations: RichTextAnnotations;
  href?: string;
}

/**
 * Parse inline Markdown formatting into an array of Notion rich_text items.
 *
 * Supports: **bold**, *italic*, `code`, ~~strikethrough~~, [text](url)
 * Handles nested annotations (e.g. ***bold italic***).
 * Does NOT parse block-level elements — those are handled by markdownToBlocks.
 */
export function parseInlineMarkdown(text: string): NotionRichTextItem[] {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  const tokens = tokenizeInline(text);
  return tokens.map(token => {
    const item: NotionRichTextItem = {
      type: 'text',
      text: {
        content: token.text,
        link: token.href ? { url: token.href } : null,
      },
    };

    const hasAnnotations =
      token.annotations.bold ||
      token.annotations.italic ||
      token.annotations.code ||
      token.annotations.strikethrough;

    if (hasAnnotations) {
      item.annotations = { ...token.annotations };
    }

    return item;
  });
}

/**
 * Tokenize inline markdown into segments with their annotations.
 *
 * Strategy: use a regex to match the next inline pattern, emit plain text
 * before it, then the formatted segment. Repeat until input is consumed.
 *
 * Pattern priority (longest match first to avoid ambiguity):
 *   1. Links:          [text](url)
 *   2. Bold+Italic:    ***text*** or ___text___
 *   3. Bold:           **text** or __text__
 *   4. Italic:         *text* or _text_ (underscore only between spaces/bounds)
 *   5. Code:           `text`
 *   6. Strikethrough:  ~~text~~
 */
function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];

  // Combined pattern — order matters for alternation priority
  const pattern =
    /(\[([^\]]+)\]\(([^)]+)\))|(```(.+?)```)|(`([^`]+)`)|(~~(.+?)~~)|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    // Emit plain text before this match
    if (match.index > lastIndex) {
      tokens.push({
        text: input.slice(lastIndex, match.index),
        annotations: {},
      });
    }

    if (match[1]) {
      // Link: [text](url) — recursively parse the link text for nested formatting
      const linkText = match[2];
      const linkUrl = match[3];
      const innerTokens = tokenizeInline(linkText);
      for (const inner of innerTokens) {
        tokens.push({
          text: inner.text,
          annotations: inner.annotations,
          href: linkUrl,
        });
      }
    } else if (match[4]) {
      // Inline triple-backtick code (```text```) — treat same as single backtick
      tokens.push({
        text: match[5],
        annotations: { code: true },
      });
    } else if (match[6]) {
      // Code: `text`
      tokens.push({
        text: match[7],
        annotations: { code: true },
      });
    } else if (match[8]) {
      // Strikethrough: ~~text~~
      tokens.push({
        text: match[9],
        annotations: { strikethrough: true },
      });
    } else if (match[10]) {
      // Bold + Italic: ***text***
      tokens.push({
        text: match[11],
        annotations: { bold: true, italic: true },
      });
    } else if (match[12]) {
      // Bold: **text**
      tokens.push({
        text: match[13],
        annotations: { bold: true },
      });
    } else if (match[14]) {
      // Italic: *text*
      tokens.push({
        text: match[15],
        annotations: { italic: true },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Emit remaining plain text
  if (lastIndex < input.length) {
    tokens.push({
      text: input.slice(lastIndex),
      annotations: {},
    });
  }

  // If nothing was matched, return the entire input as plain text
  if (tokens.length === 0) {
    tokens.push({ text: input, annotations: {} });
  }

  return tokens;
}

// ─── Notion Rich Text → Markdown ────────────────────────────────────────────

/**
 * Convert an array of Notion rich_text objects to a Markdown string.
 * Handles bold, italic, code, strikethrough annotations, and links.
 */
export function richTextToMarkdown(richText: RichText[]): string {
  if (!richText || !Array.isArray(richText)) return '';

  return richText
    .map(rt => {
      let text = rt.plain_text || '';

      if (rt.annotations) {
        if (rt.annotations.code) text = `\`${text}\``;
        if (rt.annotations.bold) text = `**${text}**`;
        if (rt.annotations.italic) text = `*${text}*`;
        if (rt.annotations.strikethrough) text = `~~${text}~~`;
      }

      if (rt.href) {
        text = `[${text}](${rt.href})`;
      }

      return text;
    })
    .join('');
}

// ─── Block → Markdown (single block) ────────────────────────────────────────

/**
 * Convert a single Notion block to its Markdown string representation.
 * Handles all common block types.
 */
export function getBlockContent(block: Block): string {
  const type = block.type;
  const data = block[type] as BlockData | undefined;

  if (!data) return '';

  const richText = data.rich_text;
  const text = richTextToMarkdown(richText || []);

  switch (type) {
    case 'paragraph':
      return text ? `${text}\n` : '\n';

    case 'heading_1':
      return `# ${text}\n`;

    case 'heading_2':
      return `## ${text}\n`;

    case 'heading_3':
      return `### ${text}\n`;

    case 'bulleted_list_item':
      return `- ${text}\n`;

    case 'numbered_list_item':
      return `1. ${text}\n`;

    case 'to_do': {
      const checked = data.checked ? 'x' : ' ';
      return `- [${checked}] ${text}\n`;
    }

    case 'toggle':
      return `<details>\n<summary>${text}</summary>\n\n</details>\n`;

    case 'quote':
      return `> ${text}\n`;

    case 'callout': {
      const emoji = data.icon?.emoji || '';
      return `> ${emoji} ${text}\n`;
    }

    case 'code': {
      const lang = data.language || '';
      const code = richTextToMarkdown(richText || []);
      return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case 'divider':
      return `---\n`;

    case 'image': {
      const imageUrl =
        data.type === 'file' ? data.file?.url : data.external?.url;
      const caption = richTextToMarkdown(data.caption || []);
      return `![${caption}](${imageUrl})\n`;
    }

    case 'bookmark': {
      const bookmarkUrl = data.url || '';
      return `[${bookmarkUrl}](${bookmarkUrl})\n`;
    }

    case 'equation': {
      const expr = data.expression || '';
      return `$$${expr}$$\n`;
    }

    case 'table_of_contents':
      return `[TOC]\n`;

    default:
      return `<!-- Unsupported block type: ${type} -->\n`;
  }
}

// ─── Blocks → Markdown (recursive, synchronous) ─────────────────────────────

/**
 * Convert an array of already-fetched blocks (with optional .children) to
 * Markdown. This is the synchronous version that works on pre-fetched block
 * trees (as used by backup.ts). For the async version that fetches children
 * on-the-fly, see blocksToMarkdownAsync in the consumer modules.
 */
export function blocksToMarkdownSync(blocks: Block[], indent = 0): string {
  let markdown = '';
  const indentStr = '  '.repeat(indent);

  for (const block of blocks) {
    let content = getBlockContent(block);

    if (indent > 0) {
      content = content
        .split('\n')
        .map(line => (line ? indentStr + line : ''))
        .join('\n');
    }

    markdown += content;

    if (block.children && block.children.length > 0) {
      markdown += blocksToMarkdownSync(block.children, indent + 1);
    }
  }

  return markdown;
}

// ─── Markdown → Notion Blocks (full document) ───────────────────────────────

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
export function markdownToBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block (must be checked before heading to avoid ```# ... ```)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'plain text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: lang,
        },
      });
      i++; // Skip closing ```
      continue;
    }

    // Divider (--- or more dashes, must check before heading to avoid ---)
    if (/^---+$/.test(line)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i++;
      continue;
    }

    // Image: ![alt](url)
    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      blocks.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url: imageMatch[2] },
          caption: imageMatch[1]
            ? [{ type: 'text', text: { content: imageMatch[1] } }]
            : [],
        },
      });
      i++;
      continue;
    }

    // Headings
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: parseInlineMarkdown(h3Match[1]) },
      });
      i++;
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: parseInlineMarkdown(h2Match[1]) },
      });
      i++;
      continue;
    }

    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: parseInlineMarkdown(h1Match[1]) },
      });
      i++;
      continue;
    }

    // Checkbox / todo (must check before bullet since both start with -)
    const todoMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: parseInlineMarkdown(todoMatch[2]),
          checked: todoMatch[1].toLowerCase() === 'x',
        },
      });
      i++;
      continue;
    }

    // Bullet list
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInlineMarkdown(bulletMatch[1]) },
      });
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseInlineMarkdown(numMatch[1]) },
      });
      i++;
      continue;
    }

    // Quote
    const quoteMatch = line.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: parseInlineMarkdown(quoteMatch[1]) },
      });
      i++;
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: parseInlineMarkdown(line) },
      });
    }

    i++;
  }

  return blocks;
}
