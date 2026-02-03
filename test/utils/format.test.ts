import { describe, it, expect } from 'vitest';
import {
  formatOutput,
  formatPageTitle,
  formatDatabaseTitle,
  formatBlock,
  parseProperties,
  parseFilter,
} from '../../src/utils/format';

describe('Format Utilities', () => {
  describe('formatOutput()', () => {
    it('should format JSON with indentation', () => {
      const data = { name: 'Test', value: 123 };
      const result = formatOutput(data);
      expect(result).toBe('{\n  "name": "Test",\n  "value": 123\n}');
    });

    it('should handle null', () => {
      const result = formatOutput(null);
      expect(result).toBe('null');
    });

    it('should handle arrays', () => {
      const data = [1, 2, 3];
      const result = formatOutput(data);
      expect(result).toBe('[\n  1,\n  2,\n  3\n]');
    });

    it('should handle nested structures', () => {
      const data = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
      const result = formatOutput(data);
      expect(result).toContain('"users"');
      expect(result).toContain('"name": "Alice"');
      expect(result).toContain('"name": "Bob"');
    });
  });

  describe('formatPageTitle()', () => {
    it('should extract title from properties', () => {
      const page = {
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'My Page Title' }],
          },
        },
      };
      expect(formatPageTitle(page)).toBe('My Page Title');
    });

    it('should return Untitled for missing title', () => {
      const page = {
        properties: {
          Status: {
            type: 'status',
          },
        },
      };
      expect(formatPageTitle(page)).toBe('Untitled');
    });

    it('should return Untitled for empty title array', () => {
      const page = {
        properties: {
          Name: {
            type: 'title',
            title: [],
          },
        },
      };
      expect(formatPageTitle(page)).toBe('Untitled');
    });

    it('should concatenate multi-segment titles', () => {
      const page = {
        properties: {
          Name: {
            type: 'title',
            title: [
              { plain_text: 'Part One ' },
              { plain_text: 'Part Two' },
            ],
          },
        },
      };
      expect(formatPageTitle(page)).toBe('Part One Part Two');
    });

    it('should handle missing properties object', () => {
      const page = {};
      expect(formatPageTitle(page)).toBe('Untitled');
    });

    it('should throw on null/undefined (known gap)', () => {
      // Known gap: formatPageTitle doesn't handle null/undefined gracefully
      // The function expects an object with properties, not null/undefined
      expect(() => formatPageTitle(null)).toThrow();
      expect(() => formatPageTitle(undefined)).toThrow();
    });
  });

  describe('formatDatabaseTitle()', () => {
    it('should extract title from title array', () => {
      const db = {
        title: [{ plain_text: 'My Database' }],
      };
      expect(formatDatabaseTitle(db)).toBe('My Database');
    });

    it('should return Untitled Database for missing title', () => {
      const db = {};
      expect(formatDatabaseTitle(db)).toBe('Untitled Database');
    });

    it('should return Untitled Database for empty title array', () => {
      const db = {
        title: [],
      };
      expect(formatDatabaseTitle(db)).toBe('Untitled Database');
    });

    it('should concatenate multi-segment titles', () => {
      const db = {
        title: [
          { plain_text: 'Project ' },
          { plain_text: 'Tasks' },
        ],
      };
      expect(formatDatabaseTitle(db)).toBe('Project Tasks');
    });
  });

  describe('formatBlock()', () => {
    it('should format paragraph block', () => {
      const block = {
        id: 'block-123456789',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ plain_text: 'This is a paragraph.' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('¶');
      expect(result).toContain('This is a paragraph.');
      expect(result).toContain('(block-12...)');
    });

    it('should format heading blocks', () => {
      const h1 = {
        id: 'h1-123456789',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ plain_text: 'Heading 1' }],
        },
      };
      const result = formatBlock(h1);
      expect(result).toContain('H1');
      expect(result).toContain('Heading 1');
    });

    it('should format code block with language', () => {
      const block = {
        id: 'code-123456789',
        type: 'code',
        code: {
          language: 'javascript',
          rich_text: [{ plain_text: 'console.log("hello");' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('`');
      expect(result).toContain('[javascript]');
      expect(result).toContain('console.log("hello");');
    });

    it('should format code block without language', () => {
      const block = {
        id: 'code-123456789',
        type: 'code',
        code: {
          rich_text: [{ plain_text: 'plain text' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('[plain text]');
    });

    it('should format bulleted list item', () => {
      const block = {
        id: 'list-123456789',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ plain_text: 'Item 1' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('•');
      expect(result).toContain('Item 1');
    });

    it('should format numbered list item', () => {
      const block = {
        id: 'list-123456789',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ plain_text: 'Item 1' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('#');
      expect(result).toContain('Item 1');
    });

    it('should format to-do block', () => {
      const block = {
        id: 'todo-123456789',
        type: 'to_do',
        to_do: {
          rich_text: [{ plain_text: 'Task to do' }],
          checked: false,
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('☐');
      expect(result).toContain('Task to do');
    });

    it('should format divider', () => {
      const block = {
        id: 'div-123456789',
        type: 'divider',
        divider: {},
      };
      const result = formatBlock(block);
      expect(result).toContain('—');
      expect(result).toContain('---');
    });

    it('should format image block with URL', () => {
      const block = {
        id: 'img-123456789',
        type: 'image',
        image: {
          url: 'https://example.com/image.jpg',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('🖼');
      expect(result).toContain('https://example.com/image.jpg');
    });

    it('should format image block with caption fallback', () => {
      const block = {
        id: 'img-123456789',
        type: 'image',
        image: {
          caption: [{ plain_text: 'My Image' }],
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('🖼');
      expect(result).toContain('My Image');
    });

    it('should format video block', () => {
      const block = {
        id: 'vid-123456789',
        type: 'video',
        video: {
          url: 'https://example.com/video.mp4',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('🎥');
      expect(result).toContain('https://example.com/video.mp4');
    });

    it('should format file block', () => {
      const block = {
        id: 'file-123456789',
        type: 'file',
        file: {
          url: 'https://example.com/file.pdf',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('📎');
      expect(result).toContain('https://example.com/file.pdf');
    });

    it('should format PDF block', () => {
      const block = {
        id: 'pdf-123456789',
        type: 'pdf',
        pdf: {
          url: 'https://example.com/doc.pdf',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('📄');
      expect(result).toContain('https://example.com/doc.pdf');
    });

    it('should format embed block', () => {
      const block = {
        id: 'embed-123456789',
        type: 'embed',
        embed: {
          url: 'https://example.com/embed',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('🔗');
      expect(result).toContain('https://example.com/embed');
    });

    it('should format bookmark block', () => {
      const block = {
        id: 'bm-123456789',
        type: 'bookmark',
        bookmark: {
          url: 'https://example.com',
        },
      };
      const result = formatBlock(block);
      expect(result).toContain('🔖');
      expect(result).toContain('https://example.com');
    });

    it('should handle blocks with no content', () => {
      const block = {
        id: 'empty-123456789',
        type: 'paragraph',
        paragraph: {},
      };
      const result = formatBlock(block);
      expect(result).toContain('¶');
      expect(result).toContain('(empty-12...)');
    });

    it('should handle unknown block types', () => {
      const block = {
        id: 'unknown-123456789',
        type: 'unknown_type',
      };
      const result = formatBlock(block);
      expect(result).toContain('?');
      expect(result).toContain('[unknown_type]');
    });
  });

  describe('parseProperties()', () => {
    it('should parse text properties as select', () => {
      const props = ['Status=In Progress'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Status: { select: { name: 'In Progress' } },
      });
    });

    it('should parse number properties (integer)', () => {
      const props = ['Count=42'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Count: { number: 42 },
      });
    });

    it('should parse number properties (float)', () => {
      const props = ['Score=98.5'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Score: { number: 98.5 },
      });
    });

    it('should parse checkbox properties (true)', () => {
      const props = ['Done=true'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Done: { checkbox: true },
      });
    });

    it('should parse checkbox properties (false)', () => {
      const props = ['Done=false'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Done: { checkbox: false },
      });
    });

    it('should parse date properties', () => {
      const props = ['DueDate=2024-12-31'];
      const result = parseProperties(props);
      expect(result).toEqual({
        DueDate: { date: { start: '2024-12-31' } },
      });
    });

    it('should parse date with time', () => {
      const props = ['DueDate=2024-12-31T14:30:00'];
      const result = parseProperties(props);
      expect(result).toEqual({
        DueDate: { date: { start: '2024-12-31T14:30:00' } },
      });
    });

    it('should parse URL properties (http)', () => {
      const props = ['Website=http://example.com'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Website: { url: 'http://example.com' },
      });
    });

    it('should parse URL properties (https)', () => {
      const props = ['Website=https://example.com'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Website: { url: 'https://example.com' },
      });
    });

    it('should parse email properties', () => {
      const props = ['Contact=user@example.com'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Contact: { email: 'user@example.com' },
      });
    });

    it('should parse multi-select properties', () => {
      const props = ['Tags=bug,urgent,frontend'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Tags: {
          multi_select: [
            { name: 'bug' },
            { name: 'urgent' },
            { name: 'frontend' },
          ],
        },
      });
    });

    it('should trim whitespace in multi-select', () => {
      const props = ['Tags=bug, urgent, frontend'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Tags: {
          multi_select: [
            { name: 'bug' },
            { name: 'urgent' },
            { name: 'frontend' },
          ],
        },
      });
    });

    it('should parse JSON properties', () => {
      const props = ['Data={"key":"value"}'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Data: { key: 'value' },
      });
    });

    it('should parse JSON array properties', () => {
      const props = ['Items=[1,2,3]'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Items: [1, 2, 3],
      });
    });

    it('should fallback to rich_text for invalid JSON', () => {
      const props = ['Data={invalid json}'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Data: { rich_text: [{ text: { content: '{invalid json}' } }] },
      });
    });

    it('should skip properties without = sign', () => {
      const props = ['InvalidProperty', 'Valid=123'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Valid: { number: 123 },
      });
    });

    it('should parse multiple properties', () => {
      const props = [
        'Status=In Progress',
        'Count=42',
        'Done=true',
        'Tags=bug,urgent',
      ];
      const result = parseProperties(props);
      expect(result).toEqual({
        Status: { select: { name: 'In Progress' } },
        Count: { number: 42 },
        Done: { checkbox: true },
        Tags: {
          multi_select: [{ name: 'bug' }, { name: 'urgent' }],
        },
      });
    });

    it('should handle property values with special characters', () => {
      const props = ['Title=Hello, World!'];
      const result = parseProperties(props);
      expect(result).toEqual({
        Title: {
          multi_select: [{ name: 'Hello' }, { name: 'World!' }],
        },
      });
    });

    it('should handle empty property value', () => {
      const props = ['Empty='];
      const result = parseProperties(props);
      expect(result).toEqual({
        Empty: { select: { name: '' } },
      });
    });
  });

  describe('parseFilter()', () => {
    describe('Explicit property type', () => {
      it('should create status filter', () => {
        const filter = parseFilter('Status', 'equals', 'Done', 'status');
        expect(filter).toEqual({
          property: 'Status',
          status: { equals: 'Done' },
        });
      });

      it('should create select filter', () => {
        const filter = parseFilter('Priority', 'equals', 'High', 'select');
        expect(filter).toEqual({
          property: 'Priority',
          select: { equals: 'High' },
        });
      });

      it('should create multi_select filter', () => {
        const filter = parseFilter('Tags', 'contains', 'bug', 'multi_select');
        expect(filter).toEqual({
          property: 'Tags',
          multi_select: { contains: 'bug' },
        });
      });

      it('should create rich_text filter', () => {
        const filter = parseFilter('Name', 'contains', 'test', 'rich_text');
        expect(filter).toEqual({
          property: 'Name',
          rich_text: { contains: 'test' },
        });
      });

      it('should create text filter', () => {
        const filter = parseFilter('Name', 'contains', 'test', 'text');
        expect(filter).toEqual({
          property: 'Name',
          rich_text: { contains: 'test' },
        });
      });

      it('should create number filter', () => {
        const filter = parseFilter('Count', 'greater_than', '10', 'number');
        expect(filter).toEqual({
          property: 'Count',
          number: { greater_than: 10 },
        });
      });

      it('should create checkbox filter (true)', () => {
        const filter = parseFilter('Done', 'equals', 'true', 'checkbox');
        expect(filter).toEqual({
          property: 'Done',
          checkbox: { equals: true },
        });
      });

      it('should create checkbox filter (false)', () => {
        const filter = parseFilter('Done', 'equals', 'false', 'checkbox');
        expect(filter).toEqual({
          property: 'Done',
          checkbox: { equals: false },
        });
      });

      it('should create date filter', () => {
        const filter = parseFilter('DueDate', 'on_or_after', '2024-01-01', 'date');
        expect(filter).toEqual({
          property: 'DueDate',
          date: { on_or_after: '2024-01-01' },
        });
      });

      it('should handle unknown property types', () => {
        const filter = parseFilter('Custom', 'equals', 'value', 'custom_type');
        expect(filter).toEqual({
          property: 'Custom',
          custom_type: { equals: 'value' },
        });
      });
    });

    describe('Auto-detection from value', () => {
      it('should auto-detect boolean values', () => {
        const filter1 = parseFilter('Done', 'equals', 'true');
        expect(filter1).toEqual({
          property: 'Done',
          checkbox: { equals: true },
        });

        const filter2 = parseFilter('Done', 'equals', 'false');
        expect(filter2).toEqual({
          property: 'Done',
          checkbox: { equals: false },
        });
      });

      it('should auto-detect number values (integer)', () => {
        const filter = parseFilter('Count', 'greater_than', '42');
        expect(filter).toEqual({
          property: 'Count',
          number: { greater_than: 42 },
        });
      });

      it('should auto-detect number values (float)', () => {
        const filter = parseFilter('Score', 'less_than', '98.5');
        expect(filter).toEqual({
          property: 'Score',
          number: { less_than: 98.5 },
        });
      });

      it('should auto-detect date values', () => {
        const filter = parseFilter('DueDate', 'on_or_before', '2024-12-31');
        expect(filter).toEqual({
          property: 'DueDate',
          date: { on_or_before: '2024-12-31' },
        });
      });

      it('should auto-detect date values with time', () => {
        const filter = parseFilter('CreatedAt', 'after', '2024-01-01T10:00:00');
        expect(filter).toEqual({
          property: 'CreatedAt',
          date: { after: '2024-01-01T10:00:00' },
        });
      });

      it('should default to select for text values', () => {
        const filter = parseFilter('Status', 'equals', 'In Progress');
        expect(filter).toEqual({
          property: 'Status',
          select: { equals: 'In Progress' },
        });
      });
    });

    describe('Various filter types', () => {
      it('should support equals filter', () => {
        const filter = parseFilter('Status', 'equals', 'Done', 'status');
        expect(filter.status).toEqual({ equals: 'Done' });
      });

      it('should support contains filter', () => {
        const filter = parseFilter('Name', 'contains', 'test', 'rich_text');
        expect(filter.rich_text).toEqual({ contains: 'test' });
      });

      it('should support greater_than filter', () => {
        const filter = parseFilter('Count', 'greater_than', '10', 'number');
        expect(filter.number).toEqual({ greater_than: 10 });
      });

      it('should support less_than filter', () => {
        const filter = parseFilter('Count', 'less_than', '100', 'number');
        expect(filter.number).toEqual({ less_than: 100 });
      });

      it('should support on_or_after filter', () => {
        const filter = parseFilter('Date', 'on_or_after', '2024-01-01', 'date');
        expect(filter.date).toEqual({ on_or_after: '2024-01-01' });
      });

      it('should support on_or_before filter', () => {
        const filter = parseFilter('Date', 'on_or_before', '2024-12-31', 'date');
        expect(filter.date).toEqual({ on_or_before: '2024-12-31' });
      });
    });
  });
});
