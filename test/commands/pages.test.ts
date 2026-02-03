import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, mockBlockChildren } from '../fixtures/notion-data';

describe('Pages Command', () => {
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
    const { registerPagesCommand } = await import('../../src/commands/pages');
    program = new Command();
    registerPagesCommand(program);
  });

  describe('page get', () => {
    it('should get page by ID', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(console.log).toHaveBeenCalledWith('Test Page');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should get page with content', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage).mockResolvedValueOnce(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--content']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(console.log).toHaveBeenCalledWith('Page:', 'Test Page');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });

    it('should output JSON with content when both --json and --content are used', async () => {
      mockClient.get.mockResolvedValueOnce(mockPage).mockResolvedValueOnce(mockBlockChildren);

      await program.parseAsync(['node', 'test', 'page', 'get', 'page-123', '--content', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"page"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"blocks"'));
    });
  });

  describe('page create', () => {
    it('should create page in database with title', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { database_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
      });

      expect(console.log).toHaveBeenCalledWith('✅ Page created');
      expect(console.log).toHaveBeenCalledWith('ID:', 'new-page-123');
      expect(console.log).toHaveBeenCalledWith('URL:', 'https://notion.so/new-page-123');
    });

    it('should create page under parent page', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'page-456',
        '--parent-type', 'page',
        '--title', 'Subpage',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { page_id: 'page-456' },
        properties: {
          Name: {
            title: [{ text: { content: 'Subpage' } }],
          },
        },
      });
    });

    it('should auto-detect title property from database schema', async () => {
      mockClient.get.mockResolvedValue({
        properties: {
          'Task Name': { type: 'title' },
          Status: { type: 'status' },
        },
      });

      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Task',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { database_id: 'db-123' },
        properties: {
          'Task Name': {
            title: [{ text: { content: 'New Task' } }],
          },
        },
      });
    });

    it('should use custom title property name', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--title-prop', 'Title',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { database_id: 'db-123' },
        properties: {
          Title: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
      });
    });

    it('should create page with additional properties', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--prop', 'Status=Done',
        '--prop', 'Priority=High',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { database_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
          Status: {
            select: { name: 'Done' },
          },
          Priority: {
            select: { name: 'High' },
          },
        },
      });
    });

    it('should create page with initial content', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123', url: 'https://notion.so/new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--content', 'This is the initial content',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', {
        parent: { database_id: 'db-123' },
        properties: {
          Name: {
            title: [{ text: { content: 'New Page' } }],
          },
        },
        children: [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'This is the initial content' } }],
          },
        }],
      });
    });

    it('should output JSON when --json flag is used', async () => {
      const createdPage = { ...mockPage, id: 'new-page-123' };
      mockClient.post.mockResolvedValue(createdPage);

      await program.parseAsync([
        'node', 'test', 'page', 'create',
        '--parent', 'db-123',
        '--title', 'New Page',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });
  });

  describe('page update', () => {
    it('should update page properties', async () => {
      const updatedPage = { ...mockPage, id: 'page-123' };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--prop', 'Priority=High',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Status: {
            select: { name: 'Done' },
          },
          Priority: {
            select: { name: 'High' },
          },
        },
      });

      expect(console.log).toHaveBeenCalledWith('✅ Page updated');
      expect(console.log).toHaveBeenCalledWith('ID:', 'page-123');
    });

    it('should archive page with --archive flag', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', archived: true };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--archive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        archived: true,
      });
    });

    it('should unarchive page with --unarchive flag', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', archived: false };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--unarchive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        archived: false,
      });
    });

    it('should update properties and archive together', async () => {
      const updatedPage = { ...mockPage, id: 'page-123', archived: true };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--archive',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        properties: {
          Status: {
            select: { name: 'Done' },
          },
        },
        archived: true,
      });
    });

    it('should output JSON when --json flag is used', async () => {
      const updatedPage = { ...mockPage, id: 'page-123' };
      mockClient.patch.mockResolvedValue(updatedPage);

      await program.parseAsync([
        'node', 'test', 'page', 'update', 'page-123',
        '--prop', 'Status=Done',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "page"'));
    });
  });

  describe('page archive', () => {
    it('should archive page', async () => {
      mockClient.patch.mockResolvedValue({ ...mockPage, archived: true });

      await program.parseAsync(['node', 'test', 'page', 'archive', 'page-123']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', {
        archived: true,
      });

      expect(console.log).toHaveBeenCalledWith('✅ Page archived');
    });
  });

  describe('page property', () => {
    it('should get specific page property', async () => {
      const property = {
        object: 'property_item',
        id: 'prop-123',
        type: 'rollup',
        rollup: { type: 'array', array: [{ type: 'number', number: 42 }] },
      };

      mockClient.get.mockResolvedValue(property);

      await program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'prop-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123/properties/prop-123');
      expect(console.log).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const property = { object: 'property_item', id: 'prop-123', type: 'title' };

      mockClient.get.mockResolvedValue(property);

      await program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'prop-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "property_item"'));
    });
  });

  describe('Error handling', () => {
    it('should handle get errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle create errors', async () => {
      mockClient.post.mockRejectedValue(new Error('Invalid parent'));

      await expect(
        program.parseAsync([
          'node', 'test', 'page', 'create',
          '--parent', 'invalid-id',
          '--title', 'New Page',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Invalid parent');
    });

    it('should handle update errors', async () => {
      mockClient.patch.mockRejectedValue(new Error('Permission denied'));

      await expect(
        program.parseAsync([
          'node', 'test', 'page', 'update', 'page-123',
          '--prop', 'Status=Done',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Permission denied');
    });

    it('should handle archive errors', async () => {
      mockClient.patch.mockRejectedValue(new Error('Already archived'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'archive', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Already archived');
    });

    it('should handle property errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Property not found'));

      await expect(
        program.parseAsync(['node', 'test', 'page', 'property', 'page-123', 'invalid-prop'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Property not found');
    });
  });
});
