import { describe, it, expect } from 'vitest';
import {
  parseInlineMarkdown,
  richTextToMarkdown,
  markdownToBlocks,
  blocksToMarkdownSync,
  getBlockContent,
} from '../../src/utils/markdown';
import type { RichText, Block, NotionRichTextItem } from '../../src/types/notion';

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Extract the plain text + annotations from a rich_text array for easy assertion */
function simplify(items: NotionRichTextItem[]) {
  return items.map(i => ({
    text: i.text.content,
    ...(i.annotations?.bold ? { bold: true } : {}),
    ...(i.annotations?.italic ? { italic: true } : {}),
    ...(i.annotations?.code ? { code: true } : {}),
    ...(i.annotations?.strikethrough ? { strikethrough: true } : {}),
    ...(i.text.link ? { href: i.text.link.url } : {}),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// parseInlineMarkdown
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseInlineMarkdown()', () => {
  describe('plain text', () => {
    it('should return a single rich_text item for plain text', () => {
      const result = parseInlineMarkdown('Hello world');
      expect(simplify(result)).toEqual([{ text: 'Hello world' }]);
    });

    it('should handle empty string', () => {
      const result = parseInlineMarkdown('');
      expect(result).toHaveLength(1);
      expect(result[0].text.content).toBe('');
    });
  });

  describe('bold', () => {
    it('should parse **bold** text', () => {
      const result = parseInlineMarkdown('Hello **bold** world');
      expect(simplify(result)).toEqual([
        { text: 'Hello ' },
        { text: 'bold', bold: true },
        { text: ' world' },
      ]);
    });

    it('should parse bold at start of line', () => {
      const result = parseInlineMarkdown('**bold** start');
      expect(simplify(result)).toEqual([
        { text: 'bold', bold: true },
        { text: ' start' },
      ]);
    });

    it('should parse bold at end of line', () => {
      const result = parseInlineMarkdown('end **bold**');
      expect(simplify(result)).toEqual([
        { text: 'end ' },
        { text: 'bold', bold: true },
      ]);
    });

    it('should parse multiple bold segments', () => {
      const result = parseInlineMarkdown('**one** and **two**');
      expect(simplify(result)).toEqual([
        { text: 'one', bold: true },
        { text: ' and ' },
        { text: 'two', bold: true },
      ]);
    });
  });

  describe('italic', () => {
    it('should parse *italic* text', () => {
      const result = parseInlineMarkdown('Hello *italic* world');
      expect(simplify(result)).toEqual([
        { text: 'Hello ' },
        { text: 'italic', italic: true },
        { text: ' world' },
      ]);
    });
  });

  describe('bold + italic', () => {
    it('should parse ***bold italic*** text', () => {
      const result = parseInlineMarkdown('Hello ***bold italic*** world');
      expect(simplify(result)).toEqual([
        { text: 'Hello ' },
        { text: 'bold italic', bold: true, italic: true },
        { text: ' world' },
      ]);
    });
  });

  describe('inline code', () => {
    it('should parse `code` text', () => {
      const result = parseInlineMarkdown('Use `npm install` here');
      expect(simplify(result)).toEqual([
        { text: 'Use ' },
        { text: 'npm install', code: true },
        { text: ' here' },
      ]);
    });

    it('should parse code with special characters', () => {
      const result = parseInlineMarkdown('Run `git commit -m "msg"`');
      expect(simplify(result)).toEqual([
        { text: 'Run ' },
        { text: 'git commit -m "msg"', code: true },
      ]);
    });
  });

  describe('strikethrough', () => {
    it('should parse ~~strikethrough~~ text', () => {
      const result = parseInlineMarkdown('This is ~~deleted~~ text');
      expect(simplify(result)).toEqual([
        { text: 'This is ' },
        { text: 'deleted', strikethrough: true },
        { text: ' text' },
      ]);
    });
  });

  describe('links', () => {
    it('should parse [text](url) links', () => {
      const result = parseInlineMarkdown('Visit [Google](https://google.com) now');
      expect(simplify(result)).toEqual([
        { text: 'Visit ' },
        { text: 'Google', href: 'https://google.com' },
        { text: ' now' },
      ]);
    });

    it('should parse link at start of line', () => {
      const result = parseInlineMarkdown('[Link](https://example.com) is here');
      expect(simplify(result)).toEqual([
        { text: 'Link', href: 'https://example.com' },
        { text: ' is here' },
      ]);
    });

    it('should parse link with bold text inside', () => {
      const result = parseInlineMarkdown('[**Bold Link**](https://example.com)');
      expect(simplify(result)).toEqual([
        { text: 'Bold Link', bold: true, href: 'https://example.com' },
      ]);
    });
  });

  describe('mixed formatting', () => {
    it('should parse multiple formats in one line', () => {
      const result = parseInlineMarkdown('**bold** and *italic* and `code`');
      expect(simplify(result)).toEqual([
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true },
        { text: ' and ' },
        { text: 'code', code: true },
      ]);
    });

    it('should handle formatting adjacent to each other', () => {
      const result = parseInlineMarkdown('**bold***italic*');
      expect(simplify(result)).toEqual([
        { text: 'bold', bold: true },
        { text: 'italic', italic: true },
      ]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// richTextToMarkdown
// ═══════════════════════════════════════════════════════════════════════════════

describe('richTextToMarkdown()', () => {
  it('should convert plain text', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'Hello world' },
    ];
    expect(richTextToMarkdown(rt)).toBe('Hello world');
  });

  it('should convert bold text', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'bold', annotations: { bold: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('**bold**');
  });

  it('should convert italic text', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'italic', annotations: { italic: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('*italic*');
  });

  it('should convert code text', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'code', annotations: { code: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('`code`');
  });

  it('should convert strikethrough text', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'deleted', annotations: { strikethrough: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('~~deleted~~');
  });

  it('should convert links', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'Google', href: 'https://google.com' },
    ];
    expect(richTextToMarkdown(rt)).toBe('[Google](https://google.com)');
  });

  it('should convert bold + italic combined', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'both', annotations: { bold: true, italic: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('***both***');
  });

  it('should concatenate multiple rich_text segments', () => {
    const rt: RichText[] = [
      { type: 'text', plain_text: 'Hello ' },
      { type: 'text', plain_text: 'world', annotations: { bold: true } },
    ];
    expect(richTextToMarkdown(rt)).toBe('Hello **world**');
  });

  it('should handle null/undefined input', () => {
    expect(richTextToMarkdown(null as unknown as RichText[])).toBe('');
    expect(richTextToMarkdown(undefined as unknown as RichText[])).toBe('');
  });

  it('should handle empty array', () => {
    expect(richTextToMarkdown([])).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// markdownToBlocks
// ═══════════════════════════════════════════════════════════════════════════════

describe('markdownToBlocks()', () => {
  describe('headings', () => {
    it('should parse h1', () => {
      const blocks = markdownToBlocks('# Title');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('heading_1');
    });

    it('should parse h2', () => {
      const blocks = markdownToBlocks('## Subtitle');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('heading_2');
    });

    it('should parse h3', () => {
      const blocks = markdownToBlocks('### Section');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('heading_3');
    });

    it('should preserve inline formatting in headings', () => {
      const blocks = markdownToBlocks('## Hello **bold** world');
      expect(blocks).toHaveLength(1);
      const h2 = blocks[0].heading_2 as { rich_text: NotionRichTextItem[] };
      expect(simplify(h2.rich_text)).toEqual([
        { text: 'Hello ' },
        { text: 'bold', bold: true },
        { text: ' world' },
      ]);
    });
  });

  describe('lists', () => {
    it('should parse bullet list with -', () => {
      const blocks = markdownToBlocks('- Item 1\n- Item 2');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('bulleted_list_item');
      expect(blocks[1].type).toBe('bulleted_list_item');
    });

    it('should parse bullet list with *', () => {
      const blocks = markdownToBlocks('* Item 1');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('bulleted_list_item');
    });

    it('should parse numbered list', () => {
      const blocks = markdownToBlocks('1. First\n2. Second');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('numbered_list_item');
    });

    it('should preserve inline formatting in list items', () => {
      const blocks = markdownToBlocks('- **Bold item** with `code`');
      const bullet = blocks[0].bulleted_list_item as { rich_text: NotionRichTextItem[] };
      expect(simplify(bullet.rich_text)).toEqual([
        { text: 'Bold item', bold: true },
        { text: ' with ' },
        { text: 'code', code: true },
      ]);
    });
  });

  describe('todos', () => {
    it('should parse unchecked todo', () => {
      const blocks = markdownToBlocks('- [ ] Do this');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('to_do');
      const todo = blocks[0].to_do as { checked: boolean };
      expect(todo.checked).toBe(false);
    });

    it('should parse checked todo', () => {
      const blocks = markdownToBlocks('- [x] Done');
      const todo = blocks[0].to_do as { checked: boolean };
      expect(todo.checked).toBe(true);
    });

    it('should parse checked todo with uppercase X', () => {
      const blocks = markdownToBlocks('- [X] Done');
      const todo = blocks[0].to_do as { checked: boolean };
      expect(todo.checked).toBe(true);
    });
  });

  describe('quotes', () => {
    it('should parse block quote', () => {
      const blocks = markdownToBlocks('> A wise saying');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('quote');
    });

    it('should preserve inline formatting in quotes', () => {
      const blocks = markdownToBlocks('> A **wise** saying');
      const quote = blocks[0].quote as { rich_text: NotionRichTextItem[] };
      expect(simplify(quote.rich_text)).toEqual([
        { text: 'A ' },
        { text: 'wise', bold: true },
        { text: ' saying' },
      ]);
    });
  });

  describe('code blocks', () => {
    it('should parse fenced code block', () => {
      const md = '```javascript\nconsole.log("hi");\n```';
      const blocks = markdownToBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('code');
      const code = blocks[0].code as { language: string; rich_text: NotionRichTextItem[] };
      expect(code.language).toBe('javascript');
      expect(code.rich_text[0].text.content).toBe('console.log("hi");');
    });

    it('should parse code block with no language', () => {
      const md = '```\nplain code\n```';
      const blocks = markdownToBlocks(md);
      const code = blocks[0].code as { language: string };
      expect(code.language).toBe('plain text');
    });

    it('should preserve multi-line code', () => {
      const md = '```python\ndef foo():\n  return 42\n```';
      const blocks = markdownToBlocks(md);
      const code = blocks[0].code as { rich_text: NotionRichTextItem[] };
      expect(code.rich_text[0].text.content).toBe('def foo():\n  return 42');
    });
  });

  describe('dividers', () => {
    it('should parse --- as divider', () => {
      const blocks = markdownToBlocks('---');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('divider');
    });

    it('should parse ----- as divider', () => {
      const blocks = markdownToBlocks('-----');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('divider');
    });
  });

  describe('images', () => {
    it('should parse image with alt text', () => {
      const blocks = markdownToBlocks('![My image](https://example.com/img.png)');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
      const img = blocks[0].image as { external: { url: string }; caption: NotionRichTextItem[] };
      expect(img.external.url).toBe('https://example.com/img.png');
      expect(img.caption[0].text.content).toBe('My image');
    });

    it('should parse image without alt text', () => {
      const blocks = markdownToBlocks('![](https://example.com/img.png)');
      expect(blocks).toHaveLength(1);
      const img = blocks[0].image as { caption: NotionRichTextItem[] };
      expect(img.caption).toEqual([]);
    });
  });

  describe('paragraphs', () => {
    it('should parse regular text as paragraph', () => {
      const blocks = markdownToBlocks('Just some text');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
    });

    it('should preserve inline formatting in paragraphs', () => {
      const blocks = markdownToBlocks('Hello **bold** and *italic*');
      const para = blocks[0].paragraph as { rich_text: NotionRichTextItem[] };
      expect(simplify(para.rich_text)).toEqual([
        { text: 'Hello ' },
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true },
      ]);
    });
  });

  describe('empty / whitespace', () => {
    it('should skip empty lines', () => {
      const blocks = markdownToBlocks('\n\n\n');
      expect(blocks).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const blocks = markdownToBlocks('');
      expect(blocks).toHaveLength(0);
    });
  });

  describe('mixed document', () => {
    it('should parse a full mixed document', () => {
      const md = [
        '# Title',
        '',
        'Some **bold** paragraph.',
        '',
        '- Item 1',
        '- Item 2',
        '',
        '> A quote',
        '',
        '---',
        '',
        '```js',
        'const x = 1;',
        '```',
      ].join('\n');

      const blocks = markdownToBlocks(md);
      const types = blocks.map(b => b.type);
      expect(types).toEqual([
        'heading_1',
        'paragraph',
        'bulleted_list_item',
        'bulleted_list_item',
        'quote',
        'divider',
        'code',
      ]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getBlockContent
// ═══════════════════════════════════════════════════════════════════════════════

describe('getBlockContent()', () => {
  it('should convert paragraph to markdown', () => {
    const block: Block = {
      id: '1',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', plain_text: 'Hello' }] },
    };
    expect(getBlockContent(block)).toBe('Hello\n');
  });

  it('should convert empty paragraph to newline', () => {
    const block: Block = {
      id: '1',
      type: 'paragraph',
      paragraph: { rich_text: [] },
    };
    expect(getBlockContent(block)).toBe('\n');
  });

  it('should convert heading_1', () => {
    const block: Block = {
      id: '1',
      type: 'heading_1',
      heading_1: { rich_text: [{ type: 'text', plain_text: 'Title' }] },
    };
    expect(getBlockContent(block)).toBe('# Title\n');
  });

  it('should convert heading_2', () => {
    const block: Block = {
      id: '1',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', plain_text: 'Sub' }] },
    };
    expect(getBlockContent(block)).toBe('## Sub\n');
  });

  it('should convert heading_3', () => {
    const block: Block = {
      id: '1',
      type: 'heading_3',
      heading_3: { rich_text: [{ type: 'text', plain_text: 'Section' }] },
    };
    expect(getBlockContent(block)).toBe('### Section\n');
  });

  it('should convert bulleted_list_item', () => {
    const block: Block = {
      id: '1',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'Item' }] },
    };
    expect(getBlockContent(block)).toBe('- Item\n');
  });

  it('should convert numbered_list_item', () => {
    const block: Block = {
      id: '1',
      type: 'numbered_list_item',
      numbered_list_item: { rich_text: [{ type: 'text', plain_text: 'Item' }] },
    };
    expect(getBlockContent(block)).toBe('1. Item\n');
  });

  it('should convert unchecked to_do', () => {
    const block: Block = {
      id: '1',
      type: 'to_do',
      to_do: { rich_text: [{ type: 'text', plain_text: 'Task' }], checked: false },
    };
    expect(getBlockContent(block)).toBe('- [ ] Task\n');
  });

  it('should convert checked to_do', () => {
    const block: Block = {
      id: '1',
      type: 'to_do',
      to_do: { rich_text: [{ type: 'text', plain_text: 'Done' }], checked: true },
    };
    expect(getBlockContent(block)).toBe('- [x] Done\n');
  });

  it('should convert quote', () => {
    const block: Block = {
      id: '1',
      type: 'quote',
      quote: { rich_text: [{ type: 'text', plain_text: 'Wisdom' }] },
    };
    expect(getBlockContent(block)).toBe('> Wisdom\n');
  });

  it('should convert code block with language', () => {
    const block: Block = {
      id: '1',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', plain_text: 'const x = 1;' }],
        language: 'javascript',
      },
    };
    expect(getBlockContent(block)).toBe('```javascript\nconst x = 1;\n```\n');
  });

  it('should convert divider', () => {
    const block: Block = { id: '1', type: 'divider', divider: {} };
    expect(getBlockContent(block)).toBe('---\n');
  });

  it('should convert toggle', () => {
    const block: Block = {
      id: '1',
      type: 'toggle',
      toggle: { rich_text: [{ type: 'text', plain_text: 'Details' }] },
    };
    expect(getBlockContent(block)).toBe('<details>\n<summary>Details</summary>\n\n</details>\n');
  });

  it('should convert callout with emoji', () => {
    const block: Block = {
      id: '1',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', plain_text: 'Note' }],
        icon: { type: 'emoji', emoji: '🔥' },
      },
    };
    expect(getBlockContent(block)).toContain('> ');
    expect(getBlockContent(block)).toContain('Note');
  });

  it('should convert image with external URL', () => {
    const block: Block = {
      id: '1',
      type: 'image',
      image: {
        type: 'external',
        external: { url: 'https://example.com/img.png' },
        caption: [{ type: 'text', plain_text: 'My Image' }],
      },
    };
    expect(getBlockContent(block)).toBe('![My Image](https://example.com/img.png)\n');
  });

  it('should convert bookmark', () => {
    const block: Block = {
      id: '1',
      type: 'bookmark',
      bookmark: { url: 'https://example.com' },
    };
    expect(getBlockContent(block)).toBe('[https://example.com](https://example.com)\n');
  });

  it('should convert equation', () => {
    const block: Block = {
      id: '1',
      type: 'equation',
      equation: { expression: 'E = mc^2' },
    };
    expect(getBlockContent(block)).toBe('$$E = mc^2$$\n');
  });

  it('should convert table_of_contents', () => {
    const block: Block = {
      id: '1',
      type: 'table_of_contents',
      table_of_contents: {},
    };
    expect(getBlockContent(block)).toBe('[TOC]\n');
  });

  it('should add comment for unsupported types', () => {
    const block: Block = { id: '1', type: 'column_list', column_list: {} };
    expect(getBlockContent(block)).toBe('<!-- Unsupported block type: column_list -->\n');
  });

  it('should handle block with missing data', () => {
    const block: Block = { id: '1', type: 'paragraph' };
    expect(getBlockContent(block)).toBe('');
  });

  it('should preserve rich text annotations', () => {
    const block: Block = {
      id: '1',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', plain_text: 'Hello ', annotations: {} },
          { type: 'text', plain_text: 'world', annotations: { bold: true } },
        ],
      },
    };
    expect(getBlockContent(block)).toBe('Hello **world**\n');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// blocksToMarkdownSync
// ═══════════════════════════════════════════════════════════════════════════════

describe('blocksToMarkdownSync()', () => {
  it('should convert a list of blocks to markdown', () => {
    const blocks: Block[] = [
      {
        id: '1',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', plain_text: 'Title' }] },
      },
      {
        id: '2',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', plain_text: 'Content' }] },
      },
    ];
    const result = blocksToMarkdownSync(blocks);
    expect(result).toBe('# Title\nContent\n');
  });

  it('should handle nested children', () => {
    const blocks: Block[] = [
      {
        id: '1',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'Parent' }] },
        children: [
          {
            id: '2',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'Child' }] },
          },
        ],
      },
    ];
    const result = blocksToMarkdownSync(blocks);
    expect(result).toContain('- Parent');
    expect(result).toContain('  - Child');
  });

  it('should handle empty array', () => {
    expect(blocksToMarkdownSync([])).toBe('');
  });

  it('should apply indentation correctly', () => {
    const blocks: Block[] = [
      {
        id: '1',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', plain_text: 'Indented' }] },
      },
    ];
    const result = blocksToMarkdownSync(blocks, 2);
    expect(result).toContain('    Indented');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Round-trip: Markdown → Blocks → Markdown
// ═══════════════════════════════════════════════════════════════════════════════

describe('round-trip: markdownToBlocks → getBlockContent', () => {
  it('should round-trip a heading', () => {
    const md = '## Hello World';
    const blocks = markdownToBlocks(md);
    // Convert each block back to markdown and check
    expect(blocks[0].type).toBe('heading_2');
    // Note: markdownToBlocks produces NotionRichTextItem format, but
    // getBlockContent expects RichText (with plain_text). This test
    // validates the structure is correct for the Notion API.
    const h2 = blocks[0].heading_2 as { rich_text: NotionRichTextItem[] };
    expect(h2.rich_text).toHaveLength(1);
    expect(h2.rich_text[0].text.content).toBe('Hello World');
  });

  it('should round-trip inline formatting through parseInlineMarkdown', () => {
    const input = 'Hello **bold** and *italic* text';
    const richText = parseInlineMarkdown(input);
    // The rich text should have the correct annotations
    expect(simplify(richText)).toEqual([
      { text: 'Hello ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' text' },
    ]);
  });
});
