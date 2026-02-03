import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, mockPage, createPaginatedResult } from '../fixtures/notion-data';

describe('Backup Command', () => {
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
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) {
          return mockFS.get(path);
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      mkdirSync: vi.fn((path: string) => {
        mockFS.set(path, '<directory>');
      }),
    }));

    // Import command and register it
    const { registerBackupCommand } = await import('../../src/commands/backup');
    program = new Command();
    registerBackupCommand(program);
  });

  describe('basic backup', () => {
    it('should backup database to output directory', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        page_size: 100,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      }));

      // Should create output directory
      expect(mockFS.has('/backup')).toBe(true);

      // Should save schema.json
      expect(mockFS.has('/backup/schema.json')).toBe(true);
      const schema = JSON.parse(mockFS.get('/backup/schema.json') || '{}');
      expect(schema.id).toBe('db-123');

      // Should save index.json
      expect(mockFS.has('/backup/index.json')).toBe(true);
      const index = JSON.parse(mockFS.get('/backup/index.json') || '[]');
      expect(index).toHaveLength(1);

      // Should save .backup-meta.json
      expect(mockFS.has('/backup/.backup-meta.json')).toBe(true);
      const meta = JSON.parse(mockFS.get('/backup/.backup-meta.json') || '{}');
      expect(meta.databaseId).toBe('db-123');
      expect(meta.entriesCount).toBe(1);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Backup complete!'));
    });

    it('should save pages in JSON format by default', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      // Should create pages directory
      expect(mockFS.has('/backup/pages')).toBe(true);

      // Should have a JSON file in pages/
      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.json'));
      expect(pageFiles.length).toBe(1);

      const pageData = JSON.parse(mockFS.get(pageFiles[0]) || '{}');
      expect(pageData.id).toBe('page-123');
      expect(pageData).toHaveProperty('properties');
    });

    it('should save pages in markdown format with --format markdown', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--format', 'markdown']);

      // Should have a markdown file in pages/
      const mdFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.md'));
      expect(mdFiles.length).toBe(1);

      const mdContent = mockFS.get(mdFiles[0]) || '';
      expect(mdContent).toContain('# Test Page');
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

      mockClient.get.mockResolvedValue(mockDatabase);
      let callCount = 0;
      mockClient.post.mockImplementation(async (path: string, body: any) => {
        callCount++;
        return callCount === 1 ? firstBatch : secondBatch;
      });

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      expect(mockClient.post).toHaveBeenCalledTimes(2);
      expect(mockClient.post).toHaveBeenNthCalledWith(2, 'databases/db-123/query', expect.objectContaining({
        start_cursor: 'cursor-123',
      }));

      // Should have 2 page files
      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.json'));
      expect(pageFiles.length).toBe(2);
    });

    it('should respect --limit option', async () => {
      const pages = [
        mockPage,
        { ...mockPage, id: 'page-2' },
        { ...mockPage, id: 'page-3' },
      ];
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult(pages));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--limit', '2']);

      // Should only save 2 pages
      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/'));
      expect(pageFiles.length).toBe(2);

      const meta = JSON.parse(mockFS.get('/backup/.backup-meta.json') || '{}');
      expect(meta.entriesCount).toBe(2);
    });

    it('should handle empty database', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      expect(console.log).toHaveBeenCalledWith('No entries to backup.');

      // Should still save schema
      expect(mockFS.has('/backup/schema.json')).toBe(true);
    });
  });

  describe('backup with content', () => {
    const mockBlocks = {
      results: [
        {
          id: 'block-1',
          type: 'heading_1',
          heading_1: { rich_text: [{ type: 'text', plain_text: 'Title' }] },
          has_children: false,
        },
        {
          id: 'block-2',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', plain_text: 'Content' }] },
          has_children: false,
        },
      ],
      has_more: false,
    };

    it('should fetch and save page content with --content', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('databases/')) return mockDatabase;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--content']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');

      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.json'));
      const pageData = JSON.parse(mockFS.get(pageFiles[0]) || '{}');
      expect(pageData).toHaveProperty('content');
      expect(pageData.content).toBeInstanceOf(Array);
      expect(pageData.content.length).toBeGreaterThan(0);

      const meta = JSON.parse(mockFS.get('/backup/.backup-meta.json') || '{}');
      expect(meta.includesContent).toBe(true);
    });

    it('should handle content fetch errors gracefully', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('databases/')) return mockDatabase;
        if (path.startsWith('blocks/')) throw new Error('Block fetch failed');
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--content']);

      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.json'));
      const pageData = JSON.parse(mockFS.get(pageFiles[0]) || '{}');
      expect(pageData).toHaveProperty('content_error');
      expect(pageData.content_error).toBe('Block fetch failed');
    });

    it('should include content in markdown format', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('databases/')) return mockDatabase;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--content', '--format', 'markdown']);

      const mdFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/') && k.endsWith('.md'));
      const mdContent = mockFS.get(mdFiles[0]) || '';
      expect(mdContent).toContain('# Title');
      expect(mdContent).toContain('Content');
    });
  });

  describe('incremental backup', () => {
    const previousMeta = {
      databaseId: 'db-123',
      databaseTitle: 'Test Database',
      lastBackup: '2026-01-15T00:00:00.000Z',
      entriesCount: 5,
      format: 'json',
      includesContent: false,
    };

    it('should perform incremental backup with --incremental', async () => {
      mockFS.set('/backup/.backup-meta.json', JSON.stringify(previousMeta));
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--incremental']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Incremental backup since'));

      // Should query with last_edited_time filter
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { after: '2026-01-15T00:00:00.000Z' },
        },
      }));
    });

    it('should perform full backup if no previous metadata exists', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--incremental']);

      // Should not have filter in query
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        page_size: 100,
      }));
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.not.objectContaining({
        filter: expect.anything(),
      }));
    });

    it('should update metadata after incremental backup', async () => {
      mockFS.set('/backup/.backup-meta.json', JSON.stringify(previousMeta));
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup', '--incremental']);

      const newMeta = JSON.parse(mockFS.get('/backup/.backup-meta.json') || '{}');
      expect(newMeta.lastBackup).not.toBe(previousMeta.lastBackup);
      expect(newMeta.entriesCount).toBe(1);
      expect(new Date(newMeta.lastBackup).getTime()).toBeGreaterThan(new Date(previousMeta.lastBackup).getTime());
    });
  });

  describe('Error handling', () => {
    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'backup', 'invalid-db', '--output', '/backup'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockRejectedValue(new Error('Query failed'));

      await expect(
        program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Query failed');
    });
  });

  describe('output formats', () => {
    it('should include size summary in MB', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Size:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('MB'));
    });

    it('should show database title and entry count', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage, { ...mockPage, id: 'page-2' }]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database: Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Entries: 2'));
    });

    it('should sanitize page filenames', async () => {
      const pageWithSpecialChars = {
        ...mockPage,
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Page: <Test> | With / Special * Chars?' }],
          },
        },
      };
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([pageWithSpecialChars]));

      await program.parseAsync(['node', 'test', 'backup', 'db-123', '--output', '/backup']);

      const pageFiles = Array.from(mockFS.keys()).filter(k => k.startsWith('/backup/pages/'));
      expect(pageFiles.length).toBe(1);

      const filename = pageFiles[0].split('/').pop() || '';
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).not.toContain('|');
      expect(filename).not.toContain('*');
      expect(filename).not.toContain('?');
    });
  });
});
