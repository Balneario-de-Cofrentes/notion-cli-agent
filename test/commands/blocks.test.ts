import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockBlock, mockBlockChildren, createPaginatedResult } from '../fixtures/notion-data';

describe('Blocks Command', () => {
  let program: Command;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();

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

    // Import command and register it
    const { registerBlocksCommand } = await import('../../src/commands/blocks');
    program = new Command();
    registerBlocksCommand(program);
  });

  describe('block get', () => {
    it('should get block by ID', async () => {
      mockClient.get.mockResolvedValue(mockBlock);

      await program.parseAsync(['node', 'test', 'block', 'get', 'block-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/block-123');
      expect(console.log).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockBlock);

      await program.parseAsync(['node', 'test', 'block', 'get', 'block-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "block"'));
    });
  });

  describe('block list', () => {
    it('should list child blocks', async () => {
      mockClient.get.mockResolvedValue(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'block', 'list', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children', {
        page_size: 100,
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('should list with limit', async () => {
      mockClient.get.mockResolvedValue(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'block', 'list', 'page-123', '--limit', '50']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children', {
        page_size: 50,
      });
    });

    it('should list with cursor', async () => {
      mockClient.get.mockResolvedValue(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'block', 'list', 'page-123', '--cursor', 'cursor-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children', {
        page_size: 100,
        start_cursor: 'cursor-123',
      });
    });

    it('should show pagination hint when has_more is true', async () => {
      const result = {
        ...mockBlockChildren,
        has_more: true,
        next_cursor: 'next-cursor-123',
      };
      mockClient.get.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'block', 'list', 'page-123']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('More results available. Use --cursor next-cursor-123')
      );
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'block', 'list', 'page-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });
  });

  describe('block append', () => {
    it('should append paragraph block', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--text', 'New paragraph',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'New paragraph' } }],
          },
        }],
      });

      expect(console.log).toHaveBeenCalledWith('✅ Added 1 block(s)');
    });

    it('should append heading blocks', async () => {
      const result = { results: [mockBlock, mockBlock, mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--heading1', 'Heading 1',
        '--heading2', 'Heading 2',
        '--heading3', 'Heading 3',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'heading_1' }),
          expect.objectContaining({ type: 'heading_2' }),
          expect.objectContaining({ type: 'heading_3' }),
        ]),
      });

      expect(console.log).toHaveBeenCalledWith('✅ Added 3 block(s)');
    });

    it('should append bullet list items', async () => {
      const result = { results: [mockBlock, mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--bullet', 'Item 1', 'Item 2',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'bulleted_list_item' }),
          expect.objectContaining({ type: 'bulleted_list_item' }),
        ]),
      });
    });

    it('should append numbered list items', async () => {
      const result = { results: [mockBlock, mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--numbered', 'Step 1', 'Step 2',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'numbered_list_item' }),
          expect.objectContaining({ type: 'numbered_list_item' }),
        ]),
      });
    });

    it('should append todo items', async () => {
      const result = { results: [mockBlock, mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--todo', 'Task 1', 'Task 2',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'to_do' }),
          expect.objectContaining({ type: 'to_do' }),
        ]),
      });
    });

    it('should append code block', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--code', 'console.log("hello")',
        '--code-lang', 'javascript',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: 'console.log("hello")' } }],
            language: 'javascript',
          },
        }],
      });
    });

    it('should append quote block', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--quote', 'A famous quote',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'quote',
          quote: {
            rich_text: [{ type: 'text', text: { content: 'A famous quote' } }],
          },
        }],
      });
    });

    it('should append divider', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--divider',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'divider',
          divider: {},
        }],
      });
    });

    it('should append callout block', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--callout', 'Important note',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: 'Important note' } }],
            icon: { type: 'emoji', emoji: '💡' },
          },
        }],
      });
    });

    it('should append multiple block types together', async () => {
      const result = { results: [mockBlock, mockBlock, mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--text', 'Paragraph',
        '--bullet', 'Item 1',
        '--divider',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'paragraph' }),
          expect.objectContaining({ type: 'bulleted_list_item' }),
          expect.objectContaining({ type: 'divider' }),
        ]),
      });
    });

    it('should output JSON when --json flag is used', async () => {
      const result = { results: [mockBlock] };
      mockClient.patch.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'block', 'append', 'page-123',
        '--text', 'New paragraph',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"results"'));
    });
  });

  describe('Error handling', () => {
    it('should handle get errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Block not found'));

      await expect(
        program.parseAsync(['node', 'test', 'block', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Block not found');
    });

    it('should handle list errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'block', 'list', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle append errors', async () => {
      mockClient.patch.mockRejectedValue(new Error('Permission denied'));

      await expect(
        program.parseAsync([
          'node', 'test', 'block', 'append', 'page-123',
          '--text', 'New paragraph',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Permission denied');
    });
  });
});
