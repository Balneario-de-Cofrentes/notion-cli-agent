import { describe, it, expect, vi } from 'vitest';
import { createMockFetch, mockNotionAPI } from './mocks/fetch.mock';
import { mockPage } from './fixtures/notion-data';

describe('Test Infrastructure', () => {
  describe('Setup', () => {
    it('should have NOTION_TOKEN env var set', () => {
      expect(process.env.NOTION_TOKEN).toBe('test_token_default');
    });

    it('should have fetch mocked globally', () => {
      expect(global.fetch).toBeDefined();
      expect(vi.isMockFunction(global.fetch)).toBe(true);
    });

    it('should have console methods mocked', () => {
      expect(vi.isMockFunction(console.log)).toBe(true);
      expect(vi.isMockFunction(console.error)).toBe(true);
    });

    it('should have process.exit mocked', () => {
      expect(vi.isMockFunction(process.exit)).toBe(true);
    });
  });

  describe('Fetch Mocks', () => {
    it('should create simple mock fetch', async () => {
      const mockFetch = createMockFetch({ data: { test: 'data' } });
      const response = await mockFetch('https://api.notion.com/v1/test', {});

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ test: 'data' });
    });

    it('should create route-based mock', async () => {
      const mockFetch = mockNotionAPI({
        'GET pages/123': { data: mockPage },
        'POST search': { data: { results: [] } },
      });

      const pageResponse = await mockFetch('https://api.notion.com/v1/pages/123', {
        method: 'GET',
      });
      const searchResponse = await mockFetch('https://api.notion.com/v1/search', {
        method: 'POST',
      });

      expect(await pageResponse.json()).toEqual(mockPage);
      expect(await searchResponse.json()).toEqual({ results: [] });
    });

    it('should return 404 for unmocked routes', async () => {
      const mockFetch = mockNotionAPI({});
      const response = await mockFetch('https://api.notion.com/v1/unknown', {
        method: 'GET',
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.object).toBe('error');
    });
  });

  describe('Fixtures', () => {
    it('should provide valid page fixture', () => {
      expect(mockPage.object).toBe('page');
      expect(mockPage.id).toBe('page-123');
      expect(mockPage.properties.Name.title[0].plain_text).toBe('Test Page');
    });
  });
});
