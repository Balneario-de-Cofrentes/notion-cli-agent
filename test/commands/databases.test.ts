import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, mockPage, createPaginatedResult } from '../fixtures/notion-data';

describe('Databases Command', () => {
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
    const { registerDatabasesCommand } = await import('../../src/commands/databases');
    program = new Command();
    registerDatabasesCommand(program);
  });

  describe('database get', () => {
    it('should get database by ID', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'database', 'get', 'db-123']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(console.log).toHaveBeenCalledWith('Database:', 'Test Database');
      expect(console.log).toHaveBeenCalledWith('ID:', 'db-123');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Properties:'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'database', 'get', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "database"'));
    });
  });

  describe('database query', () => {
    it('should query database without filters', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'database', 'query', 'db-123']);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 100,
      });
    });

    it('should query with JSON filter', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      const filter = JSON.stringify({ property: 'Status', status: { equals: 'Done' } });
      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--filter', filter,
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        filter: { property: 'Status', status: { equals: 'Done' } },
        page_size: 100,
      });
    });

    it('should query with simple filter options', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--filter-prop', 'Status',
        '--filter-type', 'equals',
        '--filter-value', 'Done',
        '--filter-prop-type', 'status',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        filter: {
          property: 'Status',
          status: { equals: 'Done' },
        },
        page_size: 100,
      });
    });

    it('should query with sorting (descending)', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--sort', 'Created',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        sorts: [{
          property: 'Created',
          direction: 'descending',
        }],
        page_size: 100,
      });
    });

    it('should query with sorting (ascending)', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--sort', 'Priority',
        '--sort-dir', 'asc',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        sorts: [{
          property: 'Priority',
          direction: 'ascending',
        }],
        page_size: 100,
      });
    });

    it('should query with limit', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--limit', '50',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 50,
      });
    });

    it('should query with cursor', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--cursor', 'cursor-123',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        page_size: 100,
        start_cursor: 'cursor-123',
      });
    });

    it('should show pagination hint when has_more is true', async () => {
      const result = createPaginatedResult([mockPage], 'next-cursor-123', true);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'database', 'query', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('More results available. Use --cursor next-cursor-123')
      );
    });

    it('should output JSON when --json flag is used', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'database', 'query', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });

    it('should combine filter, sort, and pagination', async () => {
      const result = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'database', 'query', 'db-123',
        '--filter-prop', 'Status',
        '--filter-type', 'equals',
        '--filter-value', 'In Progress',
        '--filter-prop-type', 'status',
        '--sort', 'Priority',
        '--sort-dir', 'asc',
        '--limit', '25',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', {
        filter: {
          property: 'Status',
          status: { equals: 'In Progress' },
        },
        sorts: [{
          property: 'Priority',
          direction: 'ascending',
        }],
        page_size: 25,
      });
    });
  });

  describe('Error handling', () => {
    it('should handle get errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'database', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors', async () => {
      mockClient.post.mockRejectedValue(new Error('Invalid filter'));

      await expect(
        program.parseAsync(['node', 'test', 'database', 'query', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Invalid filter');
    });

    it('should handle invalid JSON filter', async () => {
      await expect(
        program.parseAsync([
          'node', 'test', 'database', 'query', 'db-123',
          '--filter', '{invalid json}',
        ])
      ).rejects.toThrow();
    });
  });
});
