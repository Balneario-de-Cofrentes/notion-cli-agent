import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockSearchResult, createPaginatedResult, createMockPage, createMockDatabase } from '../fixtures/notion-data';

describe('Search Command', () => {
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
    const { registerSearchCommand } = await import('../../src/commands/search');
    program = new Command();
    registerSearchCommand(program);
  });

  describe('Basic search', () => {
    it('should search without query', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        page_size: 10,
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test Page'));
    });

    it('should search with query', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', 'test query']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        query: 'test query',
        page_size: 10,
      });
    });

    it('should display empty results message', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'search']);

      expect(console.log).toHaveBeenCalledWith('No results found.');
    });
  });

  describe('Filtering', () => {
    it('should filter by page type', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--type', 'page']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        filter: { property: 'object', value: 'page' },
        page_size: 10,
      });
    });

    it('should filter by database type', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--type', 'database']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        filter: { property: 'object', value: 'data_source' },
        page_size: 10,
      });
    });
  });

  describe('Sorting', () => {
    it('should sort ascending', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--sort', 'asc']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        sort: {
          direction: 'asc',
          timestamp: 'last_edited_time',
        },
        page_size: 10,
      });
    });

    it('should sort descending', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--sort', 'desc']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        sort: {
          direction: 'desc',
          timestamp: 'last_edited_time',
        },
        page_size: 10,
      });
    });
  });

  describe('Pagination', () => {
    it('should limit results', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--limit', '50']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        page_size: 50,
      });
    });

    it('should use cursor for pagination', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--cursor', 'cursor-123']);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        page_size: 10,
        start_cursor: 'cursor-123',
      });
    });

    it('should show pagination hint when has_more is true', async () => {
      mockClient.post.mockResolvedValue({
        results: [createMockPage('page-1', 'Page 1')],
        has_more: true,
        next_cursor: 'next-cursor-123',
      });

      await program.parseAsync(['node', 'test', 'search']);

      expect(console.log).toHaveBeenCalledWith(
        'More results available. Use --cursor next-cursor-123'
      );
    });
  });

  describe('Output formats', () => {
    it('should output JSON when --json flag is used', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync(['node', 'test', 'search', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"results"'));
    });

    it('should format pages with icon', async () => {
      const result = createPaginatedResult([
        createMockPage('page-1', 'My Page'),
      ]);

      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📄'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('My Page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: page-1'));
    });

    it('should format databases with icon', async () => {
      const result = createPaginatedResult([
        createMockDatabase('db-1', 'My Database'),
      ]);

      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🗄️'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('My Database'));
    });

    it('should display URL when available', async () => {
      const page = createMockPage('page-1', 'My Page');
      page.url = 'https://notion.so/page-1';
      const result = createPaginatedResult([page]);

      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('URL: https://notion.so/page-1'));
    });
  });

  describe('Error handling', () => {
    it('should handle API errors', async () => {
      mockClient.post.mockRejectedValue(new Error('API Error: Rate limited'));

      await expect(
        program.parseAsync(['node', 'test', 'search'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'API Error: Rate limited');
    });
  });

  describe('--first flag', () => {
    it('should return only the first result', async () => {
      const result = createPaginatedResult([
        createMockPage('page-1', 'First'),
        createMockPage('page-2', 'Second'),
      ]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search', 'test', '--first']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('First'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Second'));
    });

    it('should exit 1 when no results and --first', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await expect(
        program.parseAsync(['node', 'test', 'search', 'nonexistent', '--first'])
      ).rejects.toThrow('process.exit(1)');
    });

    it('should output single object in JSON mode with --first', async () => {
      const result = createPaginatedResult([createMockPage('page-1', 'Only')]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search', 'test', '--first', '--json']);

      const output = (console.log as any).mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe('page-1');
      expect(parsed.object).toBe('page');
    });
  });

  describe('--db flag', () => {
    it('should filter results to pages from specified database', async () => {
      const page1 = { ...createMockPage('page-1', 'Match'), parent: { type: 'data_source_id', data_source_id: 'ds-1', database_id: 'db-target' } };
      const page2 = { ...createMockPage('page-2', 'Other'), parent: { type: 'data_source_id', data_source_id: 'ds-2', database_id: 'db-other' } };
      mockClient.post.mockResolvedValue(createPaginatedResult([page1, page2]));

      await program.parseAsync(['node', 'test', 'search', 'test', '--db', 'db-target']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Match'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Other'));
    });

    it('should show no results when --db matches nothing', async () => {
      const page1 = { ...createMockPage('page-1', 'Page'), parent: { type: 'data_source_id', database_id: 'db-other' } };
      mockClient.post.mockResolvedValue(createPaginatedResult([page1]));

      await program.parseAsync(['node', 'test', 'search', 'test', '--db', 'db-none']);

      expect(console.log).toHaveBeenCalledWith('No results found.');
    });

    it('should paginate through results when --db filters out first page', async () => {
      const wrongDb = { ...createMockPage('page-1', 'Wrong'), parent: { type: 'data_source_id', database_id: 'db-other' } };
      const rightDb = { ...createMockPage('page-2', 'Right'), parent: { type: 'data_source_id', database_id: 'db-target' } };

      mockClient.post
        .mockResolvedValueOnce({ results: [wrongDb], has_more: true, next_cursor: 'cursor-2' })
        .mockResolvedValueOnce({ results: [rightDb], has_more: false, next_cursor: null });

      await program.parseAsync(['node', 'test', 'search', 'test', '--db', 'db-target', '--first']);

      expect(mockClient.post).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Right'));
    });
  });

  describe('--exact flag', () => {
    it('should filter to exact title matches only', async () => {
      const page1 = createMockPage('page-1', 'Project Alpha');
      const page2 = createMockPage('page-2', 'Project Alpha Beta');
      mockClient.post.mockResolvedValue(createPaginatedResult([page1, page2]));

      await program.parseAsync(['node', 'test', 'search', 'Project Alpha', '--exact']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project Alpha'));
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Beta'));
    });

    it('should be case-insensitive for exact matching', async () => {
      const page1 = createMockPage('page-1', 'My Task');
      mockClient.post.mockResolvedValue(createPaginatedResult([page1]));

      await program.parseAsync(['node', 'test', 'search', 'my task', '--exact']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('My Task'));
    });
  });

  describe('--llm flag', () => {
    it('should output compact format', async () => {
      const result = createPaginatedResult([
        createMockPage('page-1', 'Task One'),
        createMockPage('page-2', 'Task Two'),
      ]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search', 'task', '--llm']);

      expect(console.log).toHaveBeenCalledWith('[page] page-1 Task One');
      expect(console.log).toHaveBeenCalledWith('[page] page-2 Task Two');
    });

    it('should show db type for databases', async () => {
      const result = createPaginatedResult([createMockDatabase('db-1', 'My DB')]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search', 'db', '--llm']);

      expect(console.log).toHaveBeenCalledWith('[db] db-1 My DB');
    });
  });

  describe('--ids-only flag', () => {
    it('should output only IDs one per line', async () => {
      const result = createPaginatedResult([
        createMockPage('page-1', 'Task One'),
        createMockPage('page-2', 'Task Two'),
      ]);
      mockClient.post.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'search', 'task', '--ids-only']);

      expect(console.log).toHaveBeenCalledWith('page-1');
      expect(console.log).toHaveBeenCalledWith('page-2');
    });

    it('should output nothing for empty results', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'search', 'nothing', '--ids-only']);

      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('Combined options', () => {
    it('should handle multiple options together', async () => {
      mockClient.post.mockResolvedValue(mockSearchResult);

      await program.parseAsync([
        'node', 'test', 'search', 'my query',
        '--type', 'page',
        '--sort', 'desc',
        '--limit', '25',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('search', {
        query: 'my query',
        filter: { property: 'object', value: 'page' },
        sort: {
          direction: 'desc',
          timestamp: 'last_edited_time',
        },
        page_size: 25,
      });
    });
  });
});
