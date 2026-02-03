import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, mockBlock } from '../fixtures/notion-data';

describe('Duplicate Command', () => {
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
    const { registerDuplicateCommand } = await import('../../src/commands/duplicate');
    program = new Command();
    registerDuplicateCommand(program);
  });

  describe('duplicate page', () => {
    it('should duplicate page with default settings', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page', url: 'https://notion.so/new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'db-123' },
        properties: expect.objectContaining({
          Name: expect.objectContaining({
            title: expect.arrayContaining([
              expect.objectContaining({ text: expect.objectContaining({ content: expect.stringContaining('Copy of') }) }),
            ]),
          }),
        }),
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Page duplicated'));
    });

    it('should use custom title with --title', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123', '--title', 'Custom Title']);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        properties: expect.objectContaining({
          Name: expect.objectContaining({
            title: expect.arrayContaining([
              expect.objectContaining({ text: expect.objectContaining({ content: 'Custom Title' }) }),
            ]),
          }),
        }),
      }));
    });

    it('should duplicate to custom parent with --to', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123', '--to', 'db-456']);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'db-456' },
      }));
    });

    it('should support page parent with --parent-type page', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123', '--to', 'page-456', '--parent-type', 'page']);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { page_id: 'page-456' },
      }));
    });

    it('should copy content blocks by default', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: [mockBlock], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });
      mockClient.patch.mockResolvedValue({ results: [{ id: 'new-block' }] });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/new-page/children', expect.objectContaining({
        children: expect.any(Array),
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Copied 1 blocks'));
    });

    it('should skip content with --no-content', async () => {
      mockClient.get.mockResolvedValue(mockPage);
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123', '--no-content']);

      expect(mockClient.get).not.toHaveBeenCalledWith(expect.stringContaining('blocks/'));
      expect(mockClient.patch).not.toHaveBeenCalled();
    });

    it('should skip computed properties', async () => {
      const pageWithComputed = {
        ...mockPage,
        properties: {
          Title: { type: 'title', title: [{ type: 'text', plain_text: 'Test' }] },
          Formula: { type: 'formula', formula: { type: 'number', number: 42 } },
          Rollup: { type: 'rollup', rollup: { type: 'number', number: 10 } },
          CreatedTime: { type: 'created_time', created_time: '2026-01-01T00:00:00.000Z' },
        },
      };
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return pageWithComputed;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        properties: expect.not.objectContaining({
          Formula: expect.anything(),
          Rollup: expect.anything(),
          CreatedTime: expect.anything(),
        }),
      }));
    });

    it('should handle blocks with children recursively', async () => {
      const blockWithChildren = {
        id: 'block-1',
        type: 'toggle',
        toggle: { rich_text: [] },
        has_children: true,
      };
      const childBlock = {
        id: 'block-2',
        type: 'paragraph',
        paragraph: { rich_text: [] },
        has_children: false,
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path === 'blocks/page-123/children') return { results: [blockWithChildren], has_more: false };
        if (path === 'blocks/block-1/children') return { results: [childBlock], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });
      mockClient.patch.mockResolvedValueOnce({ results: [{ id: 'new-block-1' }] });
      mockClient.patch.mockResolvedValueOnce({ results: [{ id: 'new-block-2' }] });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(mockClient.get).toHaveBeenCalledWith('blocks/block-1/children');
    });

    it('should handle pagination in block fetching', async () => {
      const firstBatch = {
        results: [mockBlock],
        has_more: true,
        next_cursor: 'cursor-123',
      };
      const secondBatch = {
        results: [{ ...mockBlock, id: 'block-2' }],
        has_more: false,
      };

      let getCallCount = 0;
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) {
          getCallCount++;
          return getCallCount === 1 ? firstBatch : secondBatch;
        }
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });
      mockClient.patch.mockResolvedValue({ results: [{ id: 'new-block-1' }, { id: 'new-block-2' }] });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children?start_cursor=cursor-123');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Copied 2 blocks'));
    });

    it('should chunk large block arrays (100 per request)', async () => {
      const manyBlocks = Array.from({ length: 250 }, (_, i) => ({
        ...mockBlock,
        id: `block-${i}`,
      }));

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return { results: manyBlocks, has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue({ id: 'new-page' });
      mockClient.patch.mockResolvedValue({ results: Array(100).fill({ id: 'new-block' }) });

      await program.parseAsync(['node', 'test', 'duplicate', 'page', 'page-123']);

      // Should chunk into 3 requests: 100 + 100 + 50
      expect(mockClient.patch).toHaveBeenCalledTimes(3);
    });

    it('should handle page fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'duplicate', 'page', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });
  });

  describe('duplicate schema', () => {
    it('should clone database schema', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'new-db', url: 'https://notion.so/new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        parent: { page_id: 'page-parent' },
        title: expect.arrayContaining([
          expect.objectContaining({ text: expect.objectContaining({ content: expect.stringContaining('Copy of') }) }),
        ]),
        properties: expect.any(Object),
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Database schema cloned'));
    });

    it('should use custom title with --title', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent', '--title', 'New Schema']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        title: expect.arrayContaining([
          expect.objectContaining({ text: expect.objectContaining({ content: 'New Schema' }) }),
        ]),
      }));
    });

    it('should clone select property options', async () => {
      const dbWithSelect = {
        ...mockDatabase,
        properties: {
          Title: { id: 'title', name: 'Title', type: 'title' },
          Priority: {
            id: 'priority',
            name: 'Priority',
            type: 'select',
            select: {
              options: [
                { id: 'opt-1', name: 'High', color: 'red' },
                { id: 'opt-2', name: 'Low', color: 'green' },
              ],
            },
          },
        },
      };
      mockClient.get.mockResolvedValue(dbWithSelect);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.objectContaining({
          Priority: expect.objectContaining({
            select: expect.objectContaining({
              options: expect.arrayContaining([
                expect.objectContaining({ name: 'High', color: 'red' }),
                expect.objectContaining({ name: 'Low', color: 'green' }),
              ]),
            }),
          }),
        }),
      }));
    });

    it('should clone status property with groups', async () => {
      const dbWithStatus = {
        ...mockDatabase,
        properties: {
          Title: { id: 'title', name: 'Title', type: 'title' },
          Status: {
            id: 'status',
            name: 'Status',
            type: 'status',
            status: {
              options: [
                { id: 'stat-1', name: 'Todo', color: 'gray' },
                { id: 'stat-2', name: 'Done', color: 'green' },
              ],
              groups: [
                { id: 'grp-1', name: 'Not Started', option_ids: ['stat-1'] },
                { id: 'grp-2', name: 'Complete', option_ids: ['stat-2'] },
              ],
            },
          },
        },
      };
      mockClient.get.mockResolvedValue(dbWithStatus);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.objectContaining({
          Status: expect.objectContaining({
            status: expect.objectContaining({
              options: expect.any(Array),
              groups: expect.any(Array),
            }),
          }),
        }),
      }));
    });

    it('should skip formula and rollup properties', async () => {
      const dbWithComputed = {
        ...mockDatabase,
        properties: {
          Title: { id: 'title', name: 'Title', type: 'title' },
          Formula: { id: 'formula', name: 'Formula', type: 'formula', formula: {} },
          Rollup: { id: 'rollup', name: 'Rollup', type: 'rollup', rollup: {} },
        },
      };
      mockClient.get.mockResolvedValue(dbWithComputed);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.objectContaining({
          Title: expect.anything(),
        }),
      }));
      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.not.objectContaining({
          Formula: expect.anything(),
          Rollup: expect.anything(),
        }),
      }));
    });

    it('should skip relation properties with warning', async () => {
      const dbWithRelation = {
        ...mockDatabase,
        properties: {
          Title: { id: 'title', name: 'Title', type: 'title' },
          Project: {
            id: 'project',
            name: 'Project',
            type: 'relation',
            relation: { database_id: 'db-projects' },
          },
        },
      };
      mockClient.get.mockResolvedValue(dbWithRelation);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('⚠️ Skipping relation property: Project'));
      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.not.objectContaining({
          Project: expect.anything(),
        }),
      }));
    });

    it('should clone various property types', async () => {
      const dbWithManyTypes = {
        ...mockDatabase,
        properties: {
          Title: { id: 'title', name: 'Title', type: 'title' },
          Description: { id: 'desc', name: 'Description', type: 'rich_text' },
          Count: { id: 'count', name: 'Count', type: 'number', number: { format: 'number' } },
          Date: { id: 'date', name: 'Date', type: 'date' },
          People: { id: 'people', name: 'People', type: 'people' },
          Checkbox: { id: 'check', name: 'Checkbox', type: 'checkbox' },
          URL: { id: 'url', name: 'URL', type: 'url' },
          Email: { id: 'email', name: 'Email', type: 'email' },
          Phone: { id: 'phone', name: 'Phone', type: 'phone_number' },
        },
      };
      mockClient.get.mockResolvedValue(dbWithManyTypes);
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      await program.parseAsync(['node', 'test', 'duplicate', 'schema', 'db-123', '--to', 'page-parent']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        properties: expect.objectContaining({
          Title: expect.objectContaining({ title: {} }),
          Description: expect.objectContaining({ rich_text: {} }),
          Count: expect.objectContaining({ number: expect.objectContaining({ format: 'number' }) }),
          Date: expect.objectContaining({ date: {} }),
          People: expect.objectContaining({ people: {} }),
          Checkbox: expect.objectContaining({ checkbox: {} }),
          URL: expect.objectContaining({ url: {} }),
          Email: expect.objectContaining({ email: {} }),
          Phone: expect.objectContaining({ phone_number: {} }),
        }),
      }));
    });

    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'duplicate', 'schema', 'invalid-db', '--to', 'page-parent'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });

  describe('duplicate database', () => {
    it('should clone database with entries', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockImplementation(async (path: string, data: any) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') return { results: [mockPage], has_more: false };
        if (path === 'pages') return { id: 'new-page' };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.any(Object));
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        page_size: 100,
      }));
      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'new-db' },
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Database cloned'));
    });

    it('should show dry run preview with --dry-run', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ results: [mockPage, { ...mockPage, id: 'page-2' }], has_more: false });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent', '--dry-run']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🔍 Dry run'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Entries: 2'));
      // Should not create database or pages
      expect(mockClient.post).toHaveBeenCalledTimes(1); // Only query, no create
    });

    it('should respect --limit option', async () => {
      const manyPages = Array.from({ length: 5 }, (_, i) => ({ ...mockPage, id: `page-${i}` }));
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') return { results: manyPages, has_more: false };
        if (path === 'pages') return { id: 'new-page' };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent', '--limit', '3']);

      // Should only create 3 pages (not 5)
      const pageCreateCalls = mockClient.post.mock.calls.filter((call: any) => call[0] === 'pages');
      expect(pageCreateCalls.length).toBe(3);
    });

    it('should copy page content with --content', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('databases/')) return mockDatabase;
        if (path.startsWith('blocks/')) return { results: [mockBlock], has_more: false };
        throw new Error('Unexpected path');
      });
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') return { results: [mockPage], has_more: false };
        if (path === 'pages') return { id: 'new-page' };
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({ results: [{ id: 'new-block' }] });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent', '--content']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/new-page/children', expect.any(Object));
    });

    it('should handle pagination in database query', async () => {
      const firstBatch = {
        results: [mockPage],
        has_more: true,
        next_cursor: 'cursor-123',
      };
      const secondBatch = {
        results: [{ ...mockPage, id: 'page-2' }],
        has_more: false,
      };

      let queryCallCount = 0;
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockImplementation(async (path: string, data: any) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') {
          queryCallCount++;
          return queryCallCount === 1 ? firstBatch : secondBatch;
        }
        if (path === 'pages') return { id: 'new-page' };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent']);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        start_cursor: 'cursor-123',
      }));
      // Should create 2 pages total
      const pageCreateCalls = mockClient.post.mock.calls.filter((call: any) => call[0] === 'pages');
      expect(pageCreateCalls.length).toBe(2);
    });

    it('should continue on entry clone failures', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') {
          return {
            results: [
              mockPage,
              { ...mockPage, id: 'page-2' },
              { ...mockPage, id: 'page-3' },
            ],
            has_more: false,
          };
        }
        if (path === 'pages') {
          // Fail the second one
          if (mockClient.post.mock.calls.filter((c: any) => c[0] === 'pages').length === 1) {
            throw new Error('Entry create failed');
          }
          return { id: 'new-page' };
        }
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Entries: 2 cloned, 1 failed'));
    });

    it('should use custom title with --title', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'databases') return { id: 'new-db' };
        if (path === 'databases/db-123/query') return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'duplicate', 'database', 'db-123', '--to', 'page-parent', '--title', 'My Clone']);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        title: expect.arrayContaining([
          expect.objectContaining({ text: expect.objectContaining({ content: 'My Clone' }) }),
        ]),
      }));
    });

    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'duplicate', 'database', 'invalid-db', '--to', 'page-parent'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });
});
