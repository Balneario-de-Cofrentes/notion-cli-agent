import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mockDataSource,
  mockPage,
  createPaginatedResult,
  createMockDataSource,
  mockMultiDsDatabase,
} from '../fixtures/notion-data';

describe('DatabaseResolver (API v2025-09-03)', () => {
  let mockClient: any;
  let resolver: typeof import('../../src/utils/database-resolver');

  beforeEach(async () => {
    vi.resetModules();
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    };
    resolver = await import('../../src/utils/database-resolver');
    resolver.clearResolverCache();
    resolver.setGlobalDataSourceId(undefined);
  });

  /**
   * Helper: set up mock chain for standard resolution flow.
   * 1. GET /databases/{id} → { data_sources: [{ id, name }] }
   * 2. GET /data_sources/{id} → schema with properties
   */
  function setupResolutionMocks(dataSourceId = 'ds-456') {
    mockClient.get
      .mockResolvedValueOnce({
        ...mockMultiDsDatabase,
        data_sources: [{ id: dataSourceId, name: 'Test Data Source' }],
      })
      .mockResolvedValueOnce({ ...mockDataSource, id: dataSourceId });
  }

  /**
   * Helper: set up mock for explicit data-source-id path.
   * Only GET /data_sources/{id} (skip discovery).
   */
  function setupExplicitDsMock(dataSourceId = 'ds-456') {
    mockClient.get.mockResolvedValueOnce({ ...mockDataSource, id: dataSourceId });
  }

  // ─── resolveDatabase ──────────────────────────────────────────────────────

  describe('resolveDatabase()', () => {
    it('should discover data_source via /databases/ then fetch schema from /data_sources/', async () => {
      setupResolutionMocks();

      const result = await resolver.resolveDatabase(mockClient, 'db-123');

      expect(result.type).toBe('data_source');
      expect(result.schemaPath).toBe('data_sources/ds-456');
      expect(result.queryPath).toBe('data_sources/ds-456/query');
      expect(result.updatePath).toBe('data_sources/ds-456');
      expect(result.schema.properties).toBeDefined();
      expect(result.databaseId).toBe('db-123');
      expect(result.dataSourceId).toBe('ds-456');
      // Step 1: discover
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      // Step 2: fetch schema
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-456');
    });

    it('should error with helpful message when multiple data sources exist', async () => {
      mockClient.get.mockResolvedValueOnce({
        ...mockMultiDsDatabase,
        data_sources: [
          { id: 'ds-1', name: 'Source A' },
          { id: 'ds-2', name: 'Source B' },
        ],
      });

      await expect(resolver.resolveDatabase(mockClient, 'multi-ds-db-123'))
        .rejects.toThrow('--data-source-id');
    });

    it('should error when database has no data sources', async () => {
      mockClient.get.mockResolvedValueOnce({
        ...mockMultiDsDatabase,
        data_sources: [],
      });

      await expect(resolver.resolveDatabase(mockClient, 'empty-db'))
        .rejects.toThrow('no data sources');
    });

    it('should use explicit dataSourceId without discovery', async () => {
      setupExplicitDsMock('ds-explicit');

      const result = await resolver.resolveDatabase(mockClient, 'any-db-id', 'ds-explicit');

      expect(result.type).toBe('data_source');
      expect(result.schemaPath).toBe('data_sources/ds-explicit');
      expect(result.queryPath).toBe('data_sources/ds-explicit/query');
      // Only one GET call (no discovery step)
      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-explicit');
    });

    it('should cache resolution results for same database ID', async () => {
      setupResolutionMocks();

      const result1 = await resolver.resolveDatabase(mockClient, 'db-123');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-123');

      expect(result1).toBe(result2);
      expect(mockClient.get).toHaveBeenCalledTimes(2); // discovery + schema, then cached
    });

    it('should cache resolution with explicit dataSourceId using composite key', async () => {
      setupExplicitDsMock('ds-1');

      const result1 = await resolver.resolveDatabase(mockClient, 'db-x', 'ds-1');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-x', 'ds-1');

      expect(result1).toBe(result2);
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });

    it('should not share cache between different database IDs', async () => {
      const ds1 = createMockDataSource('ds-1', 'DS One');
      const ds2 = createMockDataSource('ds-2', 'DS Two');

      mockClient.get
        .mockResolvedValueOnce({ data_sources: [{ id: 'ds-1', name: 'DS One' }] })
        .mockResolvedValueOnce(ds1)
        .mockResolvedValueOnce({ data_sources: [{ id: 'ds-2', name: 'DS Two' }] })
        .mockResolvedValueOnce(ds2);

      const result1 = await resolver.resolveDatabase(mockClient, 'db-1');
      const result2 = await resolver.resolveDatabase(mockClient, 'db-2');

      expect(result1.dataSourceId).toBe('ds-1');
      expect(result2.dataSourceId).toBe('ds-2');
      expect(mockClient.get).toHaveBeenCalledTimes(4);
    });

    it('should propagate errors without swallowing', async () => {
      mockClient.get.mockRejectedValue(new Error('Notion API Error (404): Resource not found'));

      await expect(resolver.resolveDatabase(mockClient, 'bad-id'))
        .rejects.toThrow('Notion API Error (404)');
    });

    it('should propagate network errors', async () => {
      mockClient.get.mockRejectedValue(new Error('fetch failed'));

      await expect(resolver.resolveDatabase(mockClient, 'db-123'))
        .rejects.toThrow('fetch failed');
    });

    it('should clear cache when clearResolverCache is called', async () => {
      setupResolutionMocks();
      await resolver.resolveDatabase(mockClient, 'db-123');

      resolver.clearResolverCache();

      setupResolutionMocks();
      await resolver.resolveDatabase(mockClient, 'db-123');

      expect(mockClient.get).toHaveBeenCalledTimes(4); // 2 per resolution
    });

    it('should normalize data_source response to Database shape', async () => {
      setupResolutionMocks();

      const result = await resolver.resolveDatabase(mockClient, 'db-123');

      expect(result.schema.id).toBeDefined();
      expect(result.schema.properties).toBeDefined();
      expect(result.schema.title).toBeDefined();
      expect(result.schema.object).toBe('database');
    });

    it('should handle database ID with dashes (UUID format)', async () => {
      const uuidId = '2c98284a-8643-8140-9380-deaf158a1077';
      mockClient.get
        .mockResolvedValueOnce({ data_sources: [{ id: 'ds-uuid', name: 'UUID DS' }] })
        .mockResolvedValueOnce({ ...mockDataSource, id: 'ds-uuid' });

      const result = await resolver.resolveDatabase(mockClient, uuidId);

      expect(result.databaseId).toBe(uuidId);
      expect(mockClient.get).toHaveBeenCalledWith(`databases/${uuidId}`);
    });

    it('should handle data_source with minimal properties', async () => {
      const minimalDs = { object: 'data_source', id: 'ds-minimal', properties: {} };
      mockClient.get
        .mockResolvedValueOnce({ data_sources: [{ id: 'ds-minimal', name: 'Minimal' }] })
        .mockResolvedValueOnce(minimalDs);

      const result = await resolver.resolveDatabase(mockClient, 'db-minimal');

      expect(result.schema.properties).toEqual({});
      expect(result.type).toBe('data_source');
    });

    it('should handle concurrent resolutions for same ID without duplicate calls', async () => {
      let resolveGet: (value: any) => void;
      const pendingGet = new Promise((resolve) => { resolveGet = resolve; });
      mockClient.get.mockReturnValueOnce(pendingGet);

      const promise1 = resolver.resolveDatabase(mockClient, 'db-concurrent', 'ds-explicit');
      const promise2 = resolver.resolveDatabase(mockClient, 'db-concurrent', 'ds-explicit');

      resolveGet!({ ...mockDataSource, id: 'ds-explicit' });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe(result2);
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });
  });

  // ─── data_source ids passed in place of database ids ──────────────────────

  /**
   * Registries written by `notion sync` before v0.22.0 hold data_source ids,
   * and `notion inspect workspace` still prints them, so an id reaching the
   * resolver may be either kind. `GET databases/{data_source_id}` 404s with a
   * misleading "share it with your integration" message (issue #60), so fall
   * back to `GET data_sources/{id}` before giving up.
   */
  describe('resolveDatabase() with a data_source id', () => {
    const notFound = () =>
      new Error('Notion API Error (404): Could not find database with ID: ds-456.');

    it('falls back to /data_sources/ when /databases/ 404s', async () => {
      mockClient.get
        .mockRejectedValueOnce(notFound())
        .mockResolvedValueOnce({
          ...mockDataSource,
          id: 'ds-456',
          parent: { type: 'database_id', database_id: 'db-123' },
        });

      const result = await resolver.resolveDatabase(mockClient, 'ds-456');

      expect(mockClient.get).toHaveBeenNthCalledWith(1, 'databases/ds-456');
      expect(mockClient.get).toHaveBeenNthCalledWith(2, 'data_sources/ds-456');
      expect(result.dataSourceId).toBe('ds-456');
      expect(result.databaseId).toBe('db-123');
      expect(result.queryPath).toBe('data_sources/ds-456/query');
    });

    it('recognises a 404 carried on the error status, not just the message', async () => {
      const err = Object.assign(new Error('Could not find database'), { status: 404 });
      mockClient.get
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ ...mockDataSource, id: 'ds-456' });

      const result = await resolver.resolveDatabase(mockClient, 'ds-456');

      expect(result.dataSourceId).toBe('ds-456');
    });

    it('uses the given id as databaseId when the data_source has no database parent', async () => {
      mockClient.get
        .mockRejectedValueOnce(notFound())
        .mockResolvedValueOnce({ ...mockDataSource, id: 'ds-456' });

      const result = await resolver.resolveDatabase(mockClient, 'ds-456');

      expect(result.databaseId).toBe('ds-456');
    });

    it('rethrows the original error when the id is neither a database nor a data_source', async () => {
      mockClient.get.mockRejectedValue(notFound());

      await expect(resolver.resolveDatabase(mockClient, 'ds-456'))
        .rejects.toThrow('Could not find database with ID: ds-456');
    });

    it('does not fall back on non-404 failures', async () => {
      mockClient.get.mockRejectedValueOnce(
        new Error('Notion API Error (401): API token is invalid.'),
      );

      await expect(resolver.resolveDatabase(mockClient, 'ds-456'))
        .rejects.toThrow('401');
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });

    it('does not fall back when the database exists but has no data sources', async () => {
      mockClient.get.mockResolvedValueOnce({ ...mockMultiDsDatabase, data_sources: [] });

      await expect(resolver.resolveDatabase(mockClient, 'db-123'))
        .rejects.toThrow('has no data sources');
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getDatabaseSchema ─────────────────────────────────────────────────────

  describe('getDatabaseSchema()', () => {
    it('should return schema via discovery', async () => {
      setupResolutionMocks();

      const schema = await resolver.getDatabaseSchema(mockClient, 'db-123');

      expect(schema.properties).toBeDefined();
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-456');
    });

    it('should return schema for explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');

      const schema = await resolver.getDatabaseSchema(mockClient, 'any-id', { dataSourceId: 'ds-456' });

      expect(schema.properties).toBeDefined();
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-456');
    });

    it('should use cached resolution on repeated calls', async () => {
      setupResolutionMocks();

      await resolver.getDatabaseSchema(mockClient, 'db-123');
      await resolver.getDatabaseSchema(mockClient, 'db-123');

      expect(mockClient.get).toHaveBeenCalledTimes(2); // discovery + schema, then cached
    });
  });

  // ─── queryDatabase ─────────────────────────────────────────────────────────

  describe('queryDatabase()', () => {
    it('should query via data_sources path', async () => {
      setupResolutionMocks();
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      const result = await resolver.queryDatabase(mockClient, 'db-123', { page_size: 10 });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', { page_size: 10 });
      expect(result).toEqual(queryResult);
    });

    it('should query with explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      await resolver.queryDatabase(mockClient, 'any-id', { page_size: 20 }, { dataSourceId: 'ds-456' });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', { page_size: 20 });
    });

    it('should pass empty body when none provided', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await resolver.queryDatabase(mockClient, 'db-123');

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', {});
    });

    it('should pass complex filter bodies through unchanged', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      const complexBody = {
        filter: { and: [{ property: 'Status', status: { equals: 'Done' } }] },
        sorts: [{ property: 'Name', direction: 'ascending' }],
        page_size: 50,
        start_cursor: 'cursor-abc',
      };

      await resolver.queryDatabase(mockClient, 'db-123', complexBody);

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', complexBody);
    });

    it('should use cached resolution for subsequent queries', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await resolver.queryDatabase(mockClient, 'db-123', {});
      await resolver.queryDatabase(mockClient, 'db-123', { page_size: 5 });

      // get called twice for resolution (discovery + schema), post called twice for queries
      expect(mockClient.get).toHaveBeenCalledTimes(2);
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });
  });

  // ─── updateDatabase ────────────────────────────────────────────────────────

  describe('updateDatabase()', () => {
    it('should update via data_sources path', async () => {
      setupResolutionMocks();
      mockClient.patch.mockResolvedValue({ ...mockDataSource, title: 'Updated' });

      const body = { title: [{ type: 'text', text: { content: 'Updated' } }] };
      await resolver.updateDatabase(mockClient, 'db-123', body);

      expect(mockClient.patch).toHaveBeenCalledWith('data_sources/ds-456', body);
    });

    it('should update with explicit data source ID', async () => {
      setupExplicitDsMock('ds-456');
      mockClient.patch.mockResolvedValue(mockDataSource);

      const body = { title: [{ type: 'text', text: { content: 'New Title' } }] };
      await resolver.updateDatabase(mockClient, 'any-id', body, { dataSourceId: 'ds-456' });

      expect(mockClient.patch).toHaveBeenCalledWith('data_sources/ds-456', body);
    });
  });

  // ─── queryDatabaseDirect ──────────────────────────────────────────────────

  describe('queryDatabaseDirect()', () => {
    it('should query using pre-resolved path', async () => {
      setupResolutionMocks();
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      const resolved = await resolver.resolveDatabase(mockClient, 'db-123');
      const result = await resolver.queryDatabaseDirect(mockClient, resolved, { page_size: 10 });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', { page_size: 10 });
      expect(result).toEqual(queryResult);
    });
  });

  // ─── queryAllPages ──────────────────────────────────────────────────────────

  describe('queryAllPages()', () => {
    it('should fetch all pages with automatic pagination', async () => {
      setupResolutionMocks();
      const page1 = { ...mockPage, id: 'page-1' };
      const page2 = { ...mockPage, id: 'page-2' };
      const page3 = { ...mockPage, id: 'page-3' };

      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([page1, page2], 'cursor-2', true))
        .mockResolvedValueOnce(createPaginatedResult([page3]));

      const pages = await resolver.queryAllPages(mockClient, 'db-123');

      expect(pages).toHaveLength(3);
      expect(pages.map(p => p.id)).toEqual(['page-1', 'page-2', 'page-3']);
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });

    it('should pass filter and sorts to every query call', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      const filter = { property: 'Status', status: { equals: 'Done' } };
      const sorts = [{ property: 'Name', direction: 'ascending' }];

      await resolver.queryAllPages(mockClient, 'db-123', { filter, sorts: sorts as any });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', {
        page_size: 100,
        filter,
        sorts,
      });
    });

    it('should respect limit and truncate results', async () => {
      setupResolutionMocks();
      const pages = Array.from({ length: 5 }, (_, i) => ({ ...mockPage, id: `page-${i}` }));
      mockClient.post.mockResolvedValue(createPaginatedResult(pages, 'cursor-next', true));

      const result = await resolver.queryAllPages(mockClient, 'db-123', { limit: 3 });

      expect(result).toHaveLength(3);
      expect(mockClient.post).toHaveBeenCalledTimes(1);
    });

    it('should use custom pageSize', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await resolver.queryAllPages(mockClient, 'db-123', { pageSize: 50 });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', {
        page_size: 50,
      });
    });

    it('should call onProgress callback with running count', async () => {
      setupResolutionMocks();
      const page1 = { ...mockPage, id: 'page-1' };
      const page2 = { ...mockPage, id: 'page-2' };

      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([page1], 'cursor-2', true))
        .mockResolvedValueOnce(createPaginatedResult([page2]));

      const progressCalls: number[] = [];
      await resolver.queryAllPages(mockClient, 'db-123', {
        onProgress: (n) => progressCalls.push(n),
      });

      expect(progressCalls).toEqual([1, 2]);
    });

    it('should handle empty results', async () => {
      setupResolutionMocks();
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      const pages = await resolver.queryAllPages(mockClient, 'db-123');

      expect(pages).toHaveLength(0);
    });

    it('should pass start_cursor on subsequent pages', async () => {
      setupResolutionMocks();
      mockClient.post
        .mockResolvedValueOnce(createPaginatedResult([mockPage], 'cursor-xyz', true))
        .mockResolvedValueOnce(createPaginatedResult([mockPage]));

      await resolver.queryAllPages(mockClient, 'db-123');

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', {
        page_size: 100,
        start_cursor: 'cursor-xyz',
      });
    });
  });

  // ─── Global data-source-id fallback ─────────────────────────────────────────

  describe('setGlobalDataSourceId()', () => {
    it('should use global data-source-id when no explicit option is provided', async () => {
      setupExplicitDsMock('ds-global');

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.getDatabaseSchema(mockClient, 'any-db');

      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-global');
    });

    it('should prefer explicit dataSourceId over global', async () => {
      setupExplicitDsMock('ds-explicit');

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.getDatabaseSchema(mockClient, 'any-db', { dataSourceId: 'ds-explicit' });

      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-explicit');
    });

    it('should not use global when cleared', async () => {
      setupResolutionMocks();

      resolver.setGlobalDataSourceId('ds-global');
      resolver.setGlobalDataSourceId(undefined);
      await resolver.getDatabaseSchema(mockClient, 'db-123');

      // Without global, goes through discovery
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
    });

    it('should flow through to queryDatabase', async () => {
      setupExplicitDsMock('ds-global');
      const queryResult = createPaginatedResult([mockPage]);
      mockClient.post.mockResolvedValue(queryResult);

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.queryDatabase(mockClient, 'any-db', { page_size: 10 });

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-global/query', { page_size: 10 });
    });

    it('should flow through to queryAllPages', async () => {
      setupExplicitDsMock('ds-global');
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.queryAllPages(mockClient, 'any-db');

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-global/query', { page_size: 100 });
    });

    it('should flow through to updateDatabase', async () => {
      setupExplicitDsMock('ds-global');
      mockClient.patch.mockResolvedValue(mockDataSource);

      resolver.setGlobalDataSourceId('ds-global');
      await resolver.updateDatabase(mockClient, 'any-db', { title: 'test' });

      expect(mockClient.patch).toHaveBeenCalledWith('data_sources/ds-global', { title: 'test' });
    });
  });
});
