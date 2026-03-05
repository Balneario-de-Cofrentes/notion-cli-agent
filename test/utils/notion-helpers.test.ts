import { describe, it, expect, vi } from 'vitest';
import {
  fetchAllBlocks,
  getPageTitle,
  getDbTitle,
  getDbDescription,
  getPropertyValue,
} from '../../src/utils/notion-helpers';
import type { Block, Page, Database } from '../../src/types/notion';

// ─── fetchAllBlocks ─────────────────────────────────────────────────────────

describe('fetchAllBlocks()', () => {
  function createMockClient(pages: { results: Block[]; has_more: boolean; next_cursor?: string }[]) {
    let callIndex = 0;
    return {
      get: vi.fn(async () => pages[callIndex++]),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
  }

  it('should return blocks from a single page', async () => {
    const blocks: Block[] = [
      { id: 'b1', type: 'paragraph' },
      { id: 'b2', type: 'heading_1' },
    ];
    const client = createMockClient([{ results: blocks, has_more: false }]);

    const result = await fetchAllBlocks(client as any, 'page-1');

    expect(result).toEqual(blocks);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('blocks/page-1/children');
  });

  it('should handle pagination across multiple pages', async () => {
    const page1Blocks: Block[] = [{ id: 'b1', type: 'paragraph' }];
    const page2Blocks: Block[] = [{ id: 'b2', type: 'heading_1' }];
    const page3Blocks: Block[] = [{ id: 'b3', type: 'to_do' }];

    const client = createMockClient([
      { results: page1Blocks, has_more: true, next_cursor: 'cursor-1' },
      { results: page2Blocks, has_more: true, next_cursor: 'cursor-2' },
      { results: page3Blocks, has_more: false },
    ]);

    const result = await fetchAllBlocks(client as any, 'page-1');

    expect(result).toEqual([...page1Blocks, ...page2Blocks, ...page3Blocks]);
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(client.get).toHaveBeenCalledWith('blocks/page-1/children');
    expect(client.get).toHaveBeenCalledWith('blocks/page-1/children?start_cursor=cursor-1');
    expect(client.get).toHaveBeenCalledWith('blocks/page-1/children?start_cursor=cursor-2');
  });

  it('should return empty array when no blocks exist', async () => {
    const client = createMockClient([{ results: [], has_more: false }]);

    const result = await fetchAllBlocks(client as any, 'empty-page');

    expect(result).toEqual([]);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});

// ─── getPageTitle ───────────────────────────────────────────────────────────

describe('getPageTitle()', () => {
  it('should extract title from page properties', () => {
    const page: Page = {
      id: 'p1',
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'My Page' }],
        },
      },
    };
    expect(getPageTitle(page)).toBe('My Page');
  });

  it('should concatenate multiple title segments', () => {
    const page: Page = {
      id: 'p1',
      properties: {
        Title: {
          type: 'title',
          title: [{ plain_text: 'Hello ' }, { plain_text: 'World' }],
        },
      },
    };
    expect(getPageTitle(page)).toBe('Hello World');
  });

  it('should return "Untitled" when no title property exists', () => {
    const page: Page = {
      id: 'p1',
      properties: {
        Status: { type: 'select', select: { name: 'Done' } },
      },
    };
    expect(getPageTitle(page)).toBe('Untitled');
  });

  it('should return "Untitled" when title array is empty', () => {
    const page: Page = {
      id: 'p1',
      properties: {
        Name: { type: 'title', title: [] },
      },
    };
    expect(getPageTitle(page)).toBe('Untitled');
  });

  it('should return "Untitled" when properties are empty', () => {
    const page: Page = { id: 'p1', properties: {} };
    expect(getPageTitle(page)).toBe('Untitled');
  });

  it('should find title property regardless of property name', () => {
    const page: Page = {
      id: 'p1',
      properties: {
        Status: { type: 'select', select: null },
        'Task Name': {
          type: 'title',
          title: [{ plain_text: 'Custom Named Title' }],
        },
      },
    };
    expect(getPageTitle(page)).toBe('Custom Named Title');
  });
});

// ─── getDbTitle ─────────────────────────────────────────────────────────────

describe('getDbTitle()', () => {
  it('should extract title from database', () => {
    const db: Database = {
      id: 'db1',
      title: [{ plain_text: 'My Database' }],
      properties: {},
    };
    expect(getDbTitle(db)).toBe('My Database');
  });

  it('should concatenate multiple title segments', () => {
    const db: Database = {
      id: 'db1',
      title: [{ plain_text: 'Projects ' }, { plain_text: 'Tracker' }],
      properties: {},
    };
    expect(getDbTitle(db)).toBe('Projects Tracker');
  });

  it('should return "Untitled" when title is undefined', () => {
    const db: Database = { id: 'db1', properties: {} };
    expect(getDbTitle(db)).toBe('Untitled');
  });

  it('should return "Untitled" when title array is empty', () => {
    const db: Database = { id: 'db1', title: [], properties: {} };
    expect(getDbTitle(db)).toBe('Untitled');
  });
});

// ─── getDbDescription ───────────────────────────────────────────────────────

describe('getDbDescription()', () => {
  it('should extract description from database', () => {
    const db: Database = {
      id: 'db1',
      description: [{ plain_text: 'A description' }],
      properties: {},
    };
    expect(getDbDescription(db)).toBe('A description');
  });

  it('should concatenate multiple description segments', () => {
    const db: Database = {
      id: 'db1',
      description: [{ plain_text: 'Part one ' }, { plain_text: 'part two' }],
      properties: {},
    };
    expect(getDbDescription(db)).toBe('Part one part two');
  });

  it('should return empty string when description is undefined', () => {
    const db: Database = { id: 'db1', properties: {} };
    expect(getDbDescription(db)).toBe('');
  });

  it('should return empty string when description array is empty', () => {
    const db: Database = { id: 'db1', description: [], properties: {} };
    expect(getDbDescription(db)).toBe('');
  });
});

// ─── getPropertyValue ───────────────────────────────────────────────────────

describe('getPropertyValue()', () => {
  describe('title and rich_text', () => {
    it('should extract title text', () => {
      const prop = { type: 'title', title: [{ plain_text: 'Hello' }] };
      expect(getPropertyValue(prop)).toBe('Hello');
    });

    it('should concatenate multiple title segments', () => {
      const prop = { type: 'title', title: [{ plain_text: 'Hello ' }, { plain_text: 'World' }] };
      expect(getPropertyValue(prop)).toBe('Hello World');
    });

    it('should extract rich_text', () => {
      const prop = { type: 'rich_text', rich_text: [{ plain_text: 'Some text' }] };
      expect(getPropertyValue(prop)).toBe('Some text');
    });

    it('should return null for empty title', () => {
      const prop = { type: 'title', title: [] };
      expect(getPropertyValue(prop)).toBeNull();
    });

    it('should return null for null/undefined rich_text', () => {
      const prop = { type: 'rich_text', rich_text: null };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('select and status', () => {
    it('should extract select name', () => {
      const prop = { type: 'select', select: { name: 'Option A' } };
      expect(getPropertyValue(prop)).toBe('Option A');
    });

    it('should extract status name', () => {
      const prop = { type: 'status', status: { name: 'In Progress' } };
      expect(getPropertyValue(prop)).toBe('In Progress');
    });

    it('should return null for null select', () => {
      const prop = { type: 'select', select: null };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('multi_select', () => {
    it('should join multi_select names with commas', () => {
      const prop = { type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
      expect(getPropertyValue(prop)).toBe('A, B, C');
    });

    it('should return null for empty multi_select', () => {
      const prop = { type: 'multi_select', multi_select: [] };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('date', () => {
    it('should extract start date', () => {
      const prop = { type: 'date', date: { start: '2024-01-15' } };
      expect(getPropertyValue(prop)).toBe('2024-01-15');
    });

    it('should return null for null date', () => {
      const prop = { type: 'date', date: null };
      expect(getPropertyValue(prop)).toBeNull();
    });

    it('should return null for date without start', () => {
      const prop = { type: 'date', date: {} };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('number', () => {
    it('should convert number to string', () => {
      const prop = { type: 'number', number: 42 };
      expect(getPropertyValue(prop)).toBe('42');
    });

    it('should handle zero', () => {
      const prop = { type: 'number', number: 0 };
      expect(getPropertyValue(prop)).toBe('0');
    });

    it('should return null for null number', () => {
      const prop = { type: 'number', number: null };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('checkbox', () => {
    it('should return "Yes" for true', () => {
      const prop = { type: 'checkbox', checkbox: true };
      expect(getPropertyValue(prop)).toBe('Yes');
    });

    it('should return "No" for false', () => {
      const prop = { type: 'checkbox', checkbox: false };
      expect(getPropertyValue(prop)).toBe('No');
    });
  });

  describe('url, email, phone_number', () => {
    it('should return url value', () => {
      const prop = { type: 'url', url: 'https://example.com' };
      expect(getPropertyValue(prop)).toBe('https://example.com');
    });

    it('should return email value', () => {
      const prop = { type: 'email', email: 'test@example.com' };
      expect(getPropertyValue(prop)).toBe('test@example.com');
    });

    it('should return phone_number value', () => {
      const prop = { type: 'phone_number', phone_number: '+1234567890' };
      expect(getPropertyValue(prop)).toBe('+1234567890');
    });

    it('should return null for null url', () => {
      const prop = { type: 'url', url: null };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('people', () => {
    it('should join people names with commas', () => {
      const prop = { type: 'people', people: [{ name: 'Alice' }, { name: 'Bob' }] };
      expect(getPropertyValue(prop)).toBe('Alice, Bob');
    });

    it('should filter out people without names', () => {
      const prop = { type: 'people', people: [{ name: 'Alice' }, {}, { name: 'Charlie' }] };
      expect(getPropertyValue(prop)).toBe('Alice, Charlie');
    });

    it('should return null for empty people array', () => {
      const prop = { type: 'people', people: [] };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });

  describe('unsupported types', () => {
    it('should return null for formula', () => {
      const prop = { type: 'formula', formula: { type: 'string', string: 'result' } };
      expect(getPropertyValue(prop)).toBeNull();
    });

    it('should return null for rollup', () => {
      const prop = { type: 'rollup', rollup: { type: 'number', number: 5 } };
      expect(getPropertyValue(prop)).toBeNull();
    });

    it('should return null for relation', () => {
      const prop = { type: 'relation', relation: [{ id: 'page-id' }] };
      expect(getPropertyValue(prop)).toBeNull();
    });

    it('should return null for unknown types', () => {
      const prop = { type: 'unknown_type', unknown_type: 'value' };
      expect(getPropertyValue(prop)).toBeNull();
    });
  });
});
