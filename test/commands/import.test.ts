import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase } from '../fixtures/notion-data';

describe('Import Command', () => {
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
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) {
          return mockFS.get(path);
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      readdirSync: vi.fn((path: string) => {
        // Return files in the directory
        const prefix = path.endsWith('/') ? path : path + '/';
        return Array.from(mockFS.keys())
          .filter(k => k.startsWith(prefix) && k !== path)
          .map(k => k.substring(prefix.length).split('/')[0])
          .filter((v, i, arr) => arr.indexOf(v) === i); // unique
      }),
      statSync: vi.fn((path: string) => ({
        isFile: () => mockFS.has(path) && !mockFS.get(path)?.startsWith('<dir>'),
        isDirectory: () => mockFS.has(path) && mockFS.get(path)?.startsWith('<dir>'),
      })),
    }));

    // Import command and register it
    const { registerImportCommand } = await import('../../src/commands/import');
    program = new Command();
    registerImportCommand(program);
  });

  describe('import markdown', () => {
    const markdownContent = `---
notion_id: "page-123"
status: "Draft"
---

# Test Document

This is a paragraph.

## Section 1

- Bullet 1
- Bullet 2

\`\`\`javascript
console.log("code");
\`\`\`
`;

    it('should import markdown file to page', async () => {
      mockFS.set('/tmp/test.md', markdownContent);
      mockClient.patch.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/test.md', '--to', 'page-123']);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: expect.arrayContaining([
          expect.objectContaining({ type: 'heading_1' }),
          expect.objectContaining({ type: 'paragraph' }),
          expect.objectContaining({ type: 'heading_2' }),
          expect.objectContaining({ type: 'bulleted_list_item' }),
          expect.objectContaining({ type: 'code' }),
        ]),
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Imported'));
    });

    it('should show dry run preview without importing', async () => {
      mockFS.set('/tmp/test.md', markdownContent);

      await program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/test.md', '--to', 'page-123', '--dry-run']);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });

    it('should replace existing content with --replace flag', async () => {
      mockFS.set('/tmp/test.md', markdownContent);
      mockClient.get.mockResolvedValue({
        results: [{ id: 'block-1' }, { id: 'block-2' }],
      });
      mockClient.delete.mockResolvedValue({});
      mockClient.patch.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/test.md', '--to', 'page-123', '--replace']);

      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(mockClient.delete).toHaveBeenCalledWith('blocks/block-1');
      expect(mockClient.delete).toHaveBeenCalledWith('blocks/block-2');
      expect(mockClient.patch).toHaveBeenCalled();
    });

    it('should chunk large imports into batches of 100', async () => {
      // Create markdown with 250 items (will need 3 chunks)
      const largeMarkdown = '- Item\n'.repeat(250);
      mockFS.set('/tmp/large.md', largeMarkdown);
      mockClient.patch.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/large.md', '--to', 'page-123']);

      // Should have 3 patch calls (100 + 100 + 50)
      expect(mockClient.patch).toHaveBeenCalledTimes(3);
      expect(mockClient.patch).toHaveBeenNthCalledWith(1, 'blocks/page-123/children', {
        children: expect.arrayContaining([expect.objectContaining({ type: 'bulleted_list_item' })]),
      });
    });

    it('should handle file read errors', async () => {
      // File not in mockFS, will throw ENOENT

      await expect(
        program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/missing.md', '--to', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', expect.stringContaining('ENOENT'));
    });
  });

  describe('import csv', () => {
    const csvContent = `Name,Status,Priority,Due Date
Task 1,Done,High,2026-02-15
Task 2,In Progress,Medium,2026-02-20
Task 3,Todo,Low,2026-03-01`;

    it('should import CSV to database', async () => {
      mockFS.set('/tmp/data.csv', csvContent);
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'page-new' });

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/data.csv', '--to', 'db-123']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledTimes(3); // 3 rows
      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'db-123' },
        properties: expect.any(Object),
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Imported 3 rows'));
    });

    it('should show CSV import preview with --dry-run', async () => {
      mockFS.set('/tmp/data.csv', csvContent);
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/data.csv', '--to', 'db-123', '--dry-run']);

      expect(mockClient.post).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Preview'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });

    it('should respect --limit option', async () => {
      mockFS.set('/tmp/data.csv', csvContent);
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'page-new' });

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/data.csv', '--to', 'db-123', '--limit', '2']);

      expect(mockClient.post).toHaveBeenCalledTimes(2); // Only 2 rows
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Imported 2 rows'));
    });

    it('should use custom title column with --title-column', async () => {
      const customCSV = `ID,Description\n1,First Item\n2,Second Item`;
      mockFS.set('/tmp/custom.csv', customCSV);
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'page-new' });

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/custom.csv', '--to', 'db-123', '--title-column', 'Description']);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        properties: expect.objectContaining({
          Name: expect.objectContaining({
            title: expect.arrayContaining([
              expect.objectContaining({ text: expect.objectContaining({ content: 'First Item' }) }),
            ]),
          }),
        }),
      }));
    });

    it('should handle CSV with quotes and commas', async () => {
      const complexCSV = `Name,Description\n"Item, with comma","Description ""quoted"""\nSimple,Basic`;
      mockFS.set('/tmp/complex.csv', complexCSV);
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({ id: 'page-new' });

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/complex.csv', '--to', 'db-123']);

      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });

    it('should handle empty CSV gracefully', async () => {
      mockFS.set('/tmp/empty.csv', 'Name\n'); // Only header
      mockClient.get.mockResolvedValue(mockDatabase);

      await expect(
        program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/empty.csv', '--to', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('must have header row and at least one data row'));
    });

    it('should continue on row errors', async () => {
      mockFS.set('/tmp/data.csv', csvContent);
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post
        .mockResolvedValueOnce({ id: 'page-1' })
        .mockRejectedValueOnce(new Error('Invalid property'))
        .mockResolvedValueOnce({ id: 'page-3' });

      await program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/data.csv', '--to', 'db-123']);

      expect(mockClient.post).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Imported 2 rows, 1 failed'));
    });
  });

  // Obsidian vault import tests skipped due to complex fs recursive operations
  // The obsidian command requires recursive directory traversal and complex file handling
  // that is difficult to mock comprehensively. Core functionality is tested via markdown tests.

  describe('Error handling', () => {
    it('should handle markdown import API errors', async () => {
      mockFS.set('/tmp/test.md', '# Test');
      mockClient.patch.mockRejectedValue(new Error('API error'));

      await expect(
        program.parseAsync(['node', 'test', 'import', 'markdown', '/tmp/test.md', '--to', 'page-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'API error');
    });

    it('should handle CSV import database errors', async () => {
      mockFS.set('/tmp/data.csv', 'Name\nItem');
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'import', 'csv', '/tmp/data.csv', '--to', 'invalid-db'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

  });
});
