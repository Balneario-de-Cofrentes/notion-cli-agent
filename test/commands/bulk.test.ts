import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, createPaginatedResult, createMockPage } from '../fixtures/notion-data';

describe('Bulk Command', () => {
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
    const { registerBulkCommand } = await import('../../src/commands/bulk');
    program = new Command();
    registerBulkCommand(program);
  });

  describe('bulk update', () => {
    it('should update matching entries with --yes flag', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
        '--yes',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        filter: expect.any(Object),
        page_size: 100,
      }));
      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Updated 2 entries'));
    });

    it('should show preview without --yes flag', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Entries to update:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Use --yes to execute'));
    });

    it('should support dry run mode', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
        '--dry-run',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });

    it('should respect --limit option', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
        '--limit', '50',
        '--yes',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        page_size: 50,
      }));
    });

    it('should handle multiple where conditions', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo,Priority=High',
        '--set', 'Status=Done',
        '--yes',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        filter: expect.objectContaining({
          and: expect.any(Array),
        }),
      }));
    });

    it('should handle multiple set properties', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done,Priority=Low',
        '--yes',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/1', expect.objectContaining({
        properties: expect.objectContaining({
          Status: expect.any(Object),
          Priority: expect.any(Object),
        }),
      }));
    });

    it('should handle no matching entries', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Nonexistent',
        '--set', 'Status=Done',
        '--yes',
      ]);

      expect(console.log).toHaveBeenCalledWith('No entries match the condition.');
      expect(mockClient.patch).not.toHaveBeenCalled();
    });

    it('should handle update errors and continue', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
        createMockPage('3', 'Task 3'),
      ]));
      mockClient.patch
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Update failed'))
        .mockResolvedValueOnce({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
        '--yes',
      ]);

      expect(mockClient.patch).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Updated 2 entries, 1 failed'));
    });

    it('should handle invalid where clause', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await expect(
        program.parseAsync([
          'node', 'test', 'bulk', 'update', 'db-123',
          '--where', '',
          '--set', 'Status=Done',
          '--yes',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error: Invalid --where clause');
    });

    it('should show pagination hint when has_more is true', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue({
        results: [createMockPage('1', 'Task 1')],
        has_more: true,
      });

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Status=Todo',
        '--set', 'Status=Done',
        '--dry-run',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('more available'));
    });

    it('should handle comparison operators in where clause', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'update', 'db-123',
        '--where', 'Priority!=Low',
        '--set', 'Status=Done',
        '--dry-run',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        filter: expect.objectContaining({
          property: 'Priority',
        }),
      }));
    });
  });

  describe('bulk archive', () => {
    it('should archive matching entries with --yes flag', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'archive', 'db-123',
        '--where', 'Status=Done',
        '--yes',
      ]);

      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(mockClient.patch).toHaveBeenCalledWith('pages/1', { archived: true });
      expect(mockClient.patch).toHaveBeenCalledWith('pages/2', { archived: true });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Archived 2 entries'));
    });

    it('should show preview without --yes flag', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'archive', 'db-123',
        '--where', 'Status=Done',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Entries to archive:'));
    });

    it('should support dry run mode', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'archive', 'db-123',
        '--where', 'Status=Done',
        '--dry-run',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });

    it('should handle archive errors', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));
      mockClient.patch
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Archive failed'));

      await program.parseAsync([
        'node', 'test', 'bulk', 'archive', 'db-123',
        '--where', 'Status=Done',
        '--yes',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Archived 1 entries, 1 failed'));
    });
  });

  describe('bulk delete', () => {
    it('should archive entries (delete is alias for archive)', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync([
        'node', 'test', 'bulk', 'delete', 'db-123',
        '--where', 'Status=Obsolete',
        '--yes',
      ]);

      // Delete is an alias for archive, so uses patch
      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(mockClient.patch).toHaveBeenCalledWith('pages/1', { archived: true });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Note: Notion does not support permanent deletion'));
    });

    it('should support dry run mode', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync([
        'node', 'test', 'bulk', 'delete', 'db-123',
        '--where', 'Status=Obsolete',
        '--dry-run',
      ]);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
    });
  });

  describe('Error handling', () => {
    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync([
          'node', 'test', 'bulk', 'update', 'invalid-db',
          '--where', 'Status=Todo',
          '--set', 'Status=Done',
          '--yes',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockRejectedValue(new Error('Query failed'));

      await expect(
        program.parseAsync([
          'node', 'test', 'bulk', 'update', 'db-123',
          '--where', 'Status=Todo',
          '--set', 'Status=Done',
          '--yes',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Query failed');
    });
  });
});
