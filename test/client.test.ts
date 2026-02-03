import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockFetch, mockNotionError } from './mocks/fetch.mock';
import { createMockFS } from './mocks/fs.mock';
import * as os from 'os';

describe('NotionClient', () => {
  beforeEach(() => {
    // Reset modules to clear singleton
    vi.resetModules();
  });

  describe('Constructor', () => {
    it('should create client with token', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });
      expect(client).toBeDefined();
    });

    it('should accept custom version', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token', version: '2023-01-01' });

      global.fetch = createMockFetch({ data: { success: true } });
      await client.get('test');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Notion-Version': '2023-01-01',
          }),
        })
      );
    });

    it('should use default version when not provided', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { success: true } });
      await client.get('test');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Notion-Version': '2022-06-28',
          }),
        })
      );
    });
  });

  describe('request() Method', () => {
    it('should make GET request with auth headers', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token_123' });

      global.fetch = createMockFetch({ data: { result: 'success' } });
      await client.request('pages/123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test_token_123',
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should make POST request with body', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      const requestBody = { parent: { database_id: 'db-123' }, title: 'Test' };
      global.fetch = createMockFetch({ data: { id: 'page-new' } });
      await client.request('pages', { method: 'POST', body: requestBody });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        })
      );
    });

    it('should make PATCH request with body', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      const updateData = { archived: true };
      global.fetch = createMockFetch({ data: { id: 'page-123', archived: true } });
      await client.request('pages/123', { method: 'PATCH', body: updateData });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updateData),
        })
      );
    });

    it('should make DELETE request', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { success: true } });
      await client.request('blocks/123', { method: 'DELETE' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/blocks/123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle query parameters', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { results: [] } });
      await client.request('databases/123/query', {
        method: 'POST',
        query: { page_size: 100, filter_properties: 'abc123' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/databases/123/query?page_size=100&filter_properties=abc123',
        expect.any(Object)
      );
    });

    it('should filter undefined query parameters', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { results: [] } });
      await client.request('search', {
        method: 'POST',
        query: { query: 'test', start_cursor: undefined },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/search?query=test',
        expect.any(Object)
      );
    });

    it('should handle 400 Bad Request', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = mockNotionError(400, 'Invalid request data');

      await expect(client.request('pages')).rejects.toThrow(
        'Notion API Error (400): Invalid request data'
      );
    });

    it('should handle 401 Unauthorized', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'invalid_token' });

      global.fetch = mockNotionError(401, 'Unauthorized');

      await expect(client.request('pages/123')).rejects.toThrow(
        'Notion API Error (401): Unauthorized'
      );
    });

    it('should handle 404 Not Found', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = mockNotionError(404, 'Resource not found');

      await expect(client.request('pages/invalid')).rejects.toThrow(
        'Notion API Error (404): Resource not found'
      );
    });

    it('should handle 429 Rate Limited', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = mockNotionError(429, 'Rate limited');

      await expect(client.request('search')).rejects.toThrow(
        'Notion API Error (429): Rate limited'
      );
    });

    it('should handle 500 Internal Server Error', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = mockNotionError(500, 'Internal server error');

      await expect(client.request('pages/123')).rejects.toThrow(
        'Notion API Error (500): Internal server error'
      );
    });

    it('should fallback to statusText when error has no message', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
      });

      await expect(client.request('pages/123')).rejects.toThrow(
        'Notion API Error (503): Service Unavailable'
      );
    });

    it('should handle malformed error response', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      await expect(client.request('pages/123')).rejects.toThrow(
        'Notion API Error (500): Internal Error'
      );
    });
  });

  describe('Convenience Methods', () => {
    it('should call request() with GET method', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { id: 'page-123' } });
      const result = await client.get('pages/123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/123',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual({ id: 'page-123' });
    });

    it('should call request() with POST method and body', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      const body = { query: 'test' };
      global.fetch = createMockFetch({ data: { results: [] } });
      const result = await client.post('search', body);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
      expect(result).toEqual({ results: [] });
    });

    it('should call request() with PATCH method and body', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      const body = { archived: true };
      global.fetch = createMockFetch({ data: { id: 'page-123', archived: true } });
      const result = await client.patch('pages/123', body);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/pages/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
      expect(result).toEqual({ id: 'page-123', archived: true });
    });

    it('should call request() with DELETE method', async () => {
      const { NotionClient } = await import('../src/client');
      const client = new NotionClient({ token: 'test_token' });

      global.fetch = createMockFetch({ data: { success: true } });
      const result = await client.delete('blocks/123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/blocks/123',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('Token Resolution', () => {
    it('should read from NOTION_TOKEN env', async () => {
      process.env.NOTION_TOKEN = 'env_token_primary';
      delete process.env.NOTION_API_KEY;

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('env_token_primary');
    });

    it('should read from NOTION_API_KEY env', async () => {
      delete process.env.NOTION_TOKEN;
      process.env.NOTION_API_KEY = 'env_token_secondary';

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('env_token_secondary');
    });

    it('should prefer NOTION_TOKEN over NOTION_API_KEY', async () => {
      process.env.NOTION_TOKEN = 'token_primary';
      process.env.NOTION_API_KEY = 'token_secondary';

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('token_primary');
    });

    it('should read from config file if no env var', async () => {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_API_KEY;

      const mockFileSystem = createMockFS({
        [`${os.homedir()}/.config/notion/api_key`]: 'file_token_123\n',
      });

      vi.doMock('fs', () => ({
        readFileSync: vi.fn(mockFileSystem.readFileSync),
      }));

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('file_token_123');
      vi.doUnmock('fs');
    });

    it('should trim whitespace from file token', async () => {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_API_KEY;

      const mockFileSystem = createMockFS({
        [`${os.homedir()}/.config/notion/api_key`]: '  token_with_spaces  \n',
      });

      vi.doMock('fs', () => ({
        readFileSync: vi.fn(mockFileSystem.readFileSync),
      }));

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('token_with_spaces');
      vi.doUnmock('fs');
    });

    it('should try alternate config path', async () => {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_API_KEY;

      const mockFileSystem = createMockFS({
        [`${os.homedir()}/.notion/token`]: 'alt_path_token',
      });

      vi.doMock('fs', () => ({
        readFileSync: vi.fn(mockFileSystem.readFileSync),
      }));

      const { getTokenSync } = await import('../src/client');
      const token = getTokenSync();

      expect(token).toBe('alt_path_token');
      vi.doUnmock('fs');
    });

    it('should throw if no token found', async () => {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_API_KEY;

      const mockFileSystem = createMockFS({});

      vi.doMock('fs', () => ({
        readFileSync: vi.fn(mockFileSystem.readFileSync),
      }));

      const { getTokenSync } = await import('../src/client');

      expect(() => getTokenSync()).toThrow(
        'Notion API token not found. Set NOTION_TOKEN env var or create ~/.config/notion/api_key'
      );
      vi.doUnmock('fs');
    });
  });

  describe('Singleton Management', () => {
    it('should create and return client instance', async () => {
      const { initClient, getClient } = await import('../src/client');

      const client1 = initClient('test_token');
      const client2 = getClient();

      expect(client1).toBe(client2);
    });

    it('should throw if getClient called before init', async () => {
      const { getClient } = await import('../src/client');

      expect(() => getClient()).toThrow(
        'Client not initialized. Call initClient() first.'
      );
    });

    it('should use token from environment if not provided', async () => {
      process.env.NOTION_TOKEN = 'env_auto_token';

      const { initClient } = await import('../src/client');
      const client = initClient();

      global.fetch = createMockFetch({ data: { success: true } });
      await client.get('test');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer env_auto_token',
          }),
        })
      );
    });

    it('should reset state between test modules', async () => {
      // First module load
      const { initClient: init1, getClient: get1 } = await import('../src/client');
      init1('token1');
      const client1 = get1();

      // Reset modules
      vi.resetModules();

      // Second module load
      const { getClient: get2 } = await import('../src/client');

      // Should throw because singleton was reset
      expect(() => get2()).toThrow('Client not initialized');
    });
  });
});
