import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, createPaginatedResult } from '../fixtures/notion-data';
import * as fs from 'fs';

describe('Export Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

    // Create mock client
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    // Mock the client module
    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    // Mock fs module
    vi.doMock('fs', () => ({
      writeFileSync: vi.fn((path: string, data: string) => {
        mockFS.set(path, data);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      mkdirSync: vi.fn((path: string) => {
        mockFS.set(path, '<directory>');
      }),
    }));

    // Import command and register it
    const { registerExportCommand } = await import('../../src/commands/export');
    program = new Command();
    registerExportCommand(program);
  });

  describe('export page', () => {
    const mockPageWithBlocks = {
      ...mockPage,
      url: 'https://notion.so/page-123',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
    };

    const mockBlocks = {
      results: [
        {
          id: 'block-1',
          type: 'heading_1',
          heading_1: { rich_text: [{ type: 'text', plain_text: 'Introduction' }] },
          has_children: false,
        },
        {
          id: 'block-2',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', plain_text: 'This is content.' }] },
          has_children: false,
        },
      ],
      has_more: false,
    };

    it('should export page to stdout by default', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Test Page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Introduction'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This is content.'));
    });

    it('should export page to file with --output', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123', '--output', '/tmp/page.md']);

      expect(mockFS.has('/tmp/page.md')).toBe(true);
      const content = mockFS.get('/tmp/page.md') || '';
      expect(content).toContain('# Test Page');
      expect(content).toContain('# Introduction');
      expect(console.log).toHaveBeenCalledWith('✅ Exported to /tmp/page.md');
    });

    it('should include frontmatter with --obsidian', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123', '--output', '/tmp/page.md', '--obsidian']);

      const content = mockFS.get('/tmp/page.md') || '';
      expect(content).toContain('---');
      expect(content).toContain('notion_id: "page-123"');
      expect(content).toContain('notion_url: "https://notion.so/page-123"');
      expect(content).toContain('created: 2026-01-01');
      expect(content).toContain('updated: 2026-01-02');
    });

    it('should export without content when --no-content is used', async () => {
      mockClient.get.mockResolvedValue(mockPageWithBlocks);

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123', '--no-content']);

      // Should not fetch blocks
      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).not.toHaveBeenCalledWith('blocks/page-123/children');

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('# Test Page');
      expect(output).not.toContain('Introduction');
    });

    it('should export without frontmatter when --no-frontmatter is used', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123', '--obsidian', '--no-frontmatter', '--output', '/tmp/page.md']);

      const content = mockFS.get('/tmp/page.md') || '';
      expect(content).not.toContain('notion_id:');
      expect(content).toContain('# Test Page');
      expect(content).toContain('# Introduction');
    });

    it('should handle paginated blocks', async () => {
      const firstBatch = {
        results: [mockBlocks.results[0]],
        has_more: true,
        next_cursor: 'cursor-123',
      };
      const secondBatch = {
        results: [mockBlocks.results[1]],
        has_more: false,
      };

      let callCount = 0;
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/page-123/children?start_cursor=')) return secondBatch;
        if (path.startsWith('blocks/')) {
          callCount++;
          if (callCount === 1) return firstBatch;
          return secondBatch;
        }
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children?start_cursor=cursor-123');
    });

    it('should handle blocks with rich text annotations', async () => {
      const richTextBlock = {
        results: [
          {
            id: 'block-1',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  plain_text: 'bold text',
                  annotations: { bold: true },
                },
                {
                  type: 'text',
                  plain_text: ' italic ',
                  annotations: { italic: true },
                },
                {
                  type: 'text',
                  plain_text: 'code',
                  annotations: { code: true },
                },
              ],
            },
            has_children: false,
          },
        ],
        has_more: false,
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return richTextBlock;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('**bold text**');
      expect(output).toContain('* italic *'); // Note: spaces included in plain_text
      expect(output).toContain('`code`');
    });

    it('should convert different block types to markdown', async () => {
      const mixedBlocks = {
        results: [
          {
            id: 'b1',
            type: 'heading_1',
            heading_1: { rich_text: [{ type: 'text', plain_text: 'H1' }] },
            has_children: false,
          },
          {
            id: 'b2',
            type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', plain_text: 'H2' }] },
            has_children: false,
          },
          {
            id: 'b3',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'Bullet' }] },
            has_children: false,
          },
          {
            id: 'b4',
            type: 'to_do',
            to_do: { rich_text: [{ type: 'text', plain_text: 'Todo' }], checked: false },
            has_children: false,
          },
          {
            id: 'b5',
            type: 'quote',
            quote: { rich_text: [{ type: 'text', plain_text: 'Quote' }] },
            has_children: false,
          },
          {
            id: 'b6',
            type: 'divider',
            divider: {},
            has_children: false,
          },
          {
            id: 'b7',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', plain_text: 'console.log("hello")' }],
              language: 'javascript',
            },
            has_children: false,
          },
        ],
        has_more: false,
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mixedBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'export', 'page', 'page-123']);

      const output = (console.log as any).mock.calls[0][0];
      expect(output).toContain('# H1');
      expect(output).toContain('## H2');
      expect(output).toContain('- Bullet');
      expect(output).toContain('- [ ] Todo');
      expect(output).toContain('> Quote');
      expect(output).toContain('---');
      expect(output).toContain('```javascript');
      expect(output).toContain('console.log("hello")');
    });
  });

  describe('export database', () => {
    it('should export database to vault folder', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage, { ...mockPage, id: 'page-2' }]));
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault']);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {});
      expect(mockFS.has('/vault/Test Page.md')).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Exported 2 pages'));
    });

    it('should create subfolder when --folder is specified', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--folder', 'subfolder']);

      expect(mockFS.has('/vault/subfolder')).toBe(true);
      expect(mockFS.has('/vault/subfolder/Test Page.md')).toBe(true);
    });

    it('should export with content when --content is specified', async () => {
      const mockPageBlocks = { results: [{ id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'Content' }] }, has_children: false }], has_more: false };
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));
      mockClient.get.mockResolvedValue(mockPageBlocks);

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--content']);

      const pageContent = mockFS.get('/vault/Test Page.md') || '';
      expect(pageContent).toContain('Content');
    });

    it('should respect --limit option', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage, { ...mockPage, id: 'page-2' }, { ...mockPage, id: 'page-3' }]));
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--limit', '2']);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', { page_size: 2 });
    });

    it('should apply --filter option', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      const filter = JSON.stringify({ property: 'Status', status: { equals: 'Done' } });
      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--filter', filter]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        filter: { property: 'Status', status: { equals: 'Done' } },
      });
    });

    it('should handle pagination in database export', async () => {
      const firstBatch = {
        results: [mockPage],
        has_more: true,
        next_cursor: 'cursor-123',
      };
      const secondBatch = {
        results: [{ ...mockPage, id: 'page-2' }],
        has_more: false,
      };

      let callCount = 0;
      mockClient.post.mockImplementation(async (path: string, body: any) => {
        callCount++;
        // Verify the cursor is only in the second call
        if (callCount === 1) {
          expect(body).not.toHaveProperty('start_cursor');
          return firstBatch;
        } else {
          expect(body).toHaveProperty('start_cursor', 'cursor-123');
          return secondBatch;
        }
      });
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault']);

      expect(mockClient.post).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Exported 2 pages'));
    });

    it('should sanitize filenames to avoid filesystem issues', async () => {
      const pageWithSpecialChars = {
        ...mockPage,
        id: 'page-special',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Test: <Page> | With / Special * Chars?' }],
          },
        },
      };

      mockClient.post.mockResolvedValue(createPaginatedResult([pageWithSpecialChars]));
      mockClient.get.mockResolvedValue({ results: [], has_more: false });

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault']);

      // Check that special characters were replaced in filename
      const files = Array.from(mockFS.keys());
      const mdFile = files.find(f => f.endsWith('.md'));
      expect(mdFile).toBeDefined();

      // Extract just the filename (last part after /)
      const filename = mdFile!.split('/').pop() || '';
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).not.toContain('|');
      expect(filename).not.toContain('*');
      expect(filename).not.toContain('?');
      // Note: / in title gets replaced with -, so checking filename only
      expect(filename).toContain('-'); // Dashes should be present (replaced special chars)
    });

    it('should handle content fetch errors gracefully', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));
      mockClient.get.mockRejectedValue(new Error('Block fetch failed'));

      await program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--content']);

      const pageContent = mockFS.get('/vault/Test Page.md') || '';
      expect(pageContent).toContain('<!-- Failed to fetch content -->');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Exported 1 pages'));
    });
  });

  describe('Error handling', () => {
    it('should handle page export errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'export', 'page', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle database export errors', async () => {
      mockClient.post.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'export', 'database', 'invalid-db', '--vault', '/vault'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle invalid filter JSON', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await expect(
        program.parseAsync(['node', 'test', 'export', 'database', 'db-123', '--vault', '/vault', '--filter', '{invalid json}'])
      ).rejects.toThrow();
    });
  });
});
