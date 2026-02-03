import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, mockBlock, mockBlockChildren, createPaginatedResult } from '../fixtures/notion-data';

describe('AI Command', () => {
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
    const { registerAICommand } = await import('../../src/commands/ai');
    program = new Command();
    registerAICommand(program);
  });

  describe('ai summarize', () => {
    const mockPageWithBlocks = {
      ...mockPage,
      last_edited_time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      properties: {
        ...mockPage.properties,
        Status: {
          type: 'status',
          status: { name: 'In Progress' },
        },
        Priority: {
          type: 'select',
          select: { name: 'High' },
        },
      },
    };

    const mockBlocks = {
      results: [
        {
          id: 'block-1',
          type: 'heading_1',
          heading_1: { rich_text: [{ plain_text: 'Introduction' }] },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          paragraph: { rich_text: [{ plain_text: 'This is a test page' }] },
        },
        {
          id: 'block-3',
          type: 'to_do',
          to_do: { rich_text: [{ plain_text: 'Task 1' }], checked: false },
        },
        {
          id: 'block-4',
          type: 'to_do',
          to_do: { rich_text: [{ plain_text: 'Task 2' }], checked: true },
        },
      ],
      has_more: false,
    };

    it('should generate page summary with structure info', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'summarize', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Test Page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('**Blocks:** 4'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('**Todos:** 1/2 completed'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'summarize', 'page-123', '--json']);

      const jsonOutput = (console.log as any).mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('structure');
      expect(parsed.structure).toHaveProperty('totalBlocks', 4);
      expect(parsed.structure.todos).toEqual({ completed: 1, pending: 1 });
    });

    it('should limit content lines with --max-lines', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) return mockBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'summarize', 'page-123', '--max-lines', '2', '--json']);

      const jsonOutput = (console.log as any).mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      // Preview should be limited
      const previewLines = parsed.preview.split('\n');
      expect(previewLines.length).toBeLessThanOrEqual(2);
    });

    it('should handle paginated blocks', async () => {
      const firstBatch = {
        results: [mockBlocks.results[0], mockBlocks.results[1]],
        has_more: true,
        next_cursor: 'cursor-123',
      };
      const secondBatch = {
        results: [mockBlocks.results[2], mockBlocks.results[3]],
        has_more: false,
      };

      let callCount = 0;
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithBlocks;
        if (path.startsWith('blocks/')) {
          callCount++;
          if (callCount === 1) return firstBatch;
          return secondBatch;
        }
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'summarize', 'page-123', '--json']);

      // Should fetch both batches
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children');
      expect(mockClient.get).toHaveBeenCalledWith('blocks/page-123/children?start_cursor=cursor-123');
    });
  });

  describe('ai extract', () => {
    const mockPageWithContent = {
      id: 'page-123',
      url: 'https://notion.so/page-123',
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-02T00:00:00.000Z',
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'Test Page' }],
        },
        Email: {
          type: 'email',
          email: 'test@example.com',
        },
        Phone: {
          type: 'phone_number',
          phone_number: '+34 123 456 789',
        },
      },
    };

    const mockContentBlocks = {
      results: [
        {
          id: 'block-1',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { plain_text: 'Contact: john@example.com, phone: +1 555-1234, website: https://example.com' },
            ],
          },
        },
      ],
      has_more: false,
    };

    it('should extract fields from properties', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPageWithContent;
        if (path.startsWith('blocks/')) return { results: [], has_more: false };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'email,phone', '--from-props']);

      const output = (console.log as any).mock.calls[0][0];
      const extracted = JSON.parse(output);
      expect(extracted.email).toBe('test@example.com');
      expect(extracted.phone).toBe('+34 123 456 789');
    });

    it('should extract from content when --from-props is not set', async () => {
      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return mockContentBlocks;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'email,phone,url']);

      const output = (console.log as any).mock.calls[0][0];
      const extracted = JSON.parse(output);
      expect(extracted.email).toContain('@example.com');
      expect(extracted.phone).toContain('555');
      expect(extracted.url).toBe('https://example.com');
    });

    it('should skip content extraction with --from-props', async () => {
      mockClient.get.mockResolvedValue(mockPageWithContent);

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'email', '--from-props']);

      // Should not fetch blocks
      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
    });

    it('should initialize missing fields as null', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'missing_field', '--from-props']);

      const output = (console.log as any).mock.calls[0][0];
      const extracted = JSON.parse(output);
      expect(extracted.missing_field).toBeNull();
    });

    it('should extract dates from content', async () => {
      const blocksWithDate = {
        results: [
          {
            id: 'block-1',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Due date: 2026-02-15' }] },
          },
        ],
        has_more: false,
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return blocksWithDate;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'date']);

      const output = (console.log as any).mock.calls[0][0];
      const extracted = JSON.parse(output);
      expect(extracted.date).toBe('2026-02-15');
    });

    it('should extract prices from content', async () => {
      const blocksWithPrice = {
        results: [
          {
            id: 'block-1',
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Price: 99.99 €' }] },
          },
        ],
        has_more: false,
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path.startsWith('pages/')) return mockPage;
        if (path.startsWith('blocks/')) return blocksWithPrice;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'ai', 'extract', 'page-123', '--schema', 'price']);

      const output = (console.log as any).mock.calls[0][0];
      const extracted = JSON.parse(output);
      expect(extracted.price).toContain('99.99');
    });
  });

  describe('ai prompt', () => {
    const mockDbWithSchema = {
      ...mockDatabase,
      description: [{ plain_text: 'Task management database' }],
    };

    it('should generate agent prompt for database', async () => {
      mockClient.get.mockResolvedValue(mockDbWithSchema);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'ai', 'prompt', 'db-123']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', { page_size: 2 });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Working with Notion Database:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Task management database'));
    });

    it('should list property types and options', async () => {
      mockClient.get.mockResolvedValue(mockDbWithSchema);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'ai', 'prompt', 'db-123']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Properties');
      expect(allLogs).toContain('### Status');
      expect(allLogs).toContain('**Valid values:**');
      expect(allLogs).toContain('Use EXACTLY these values');
    });

    it('should include common operations examples', async () => {
      mockClient.get.mockResolvedValue(mockDbWithSchema);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'ai', 'prompt', 'db-123']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Common Operations');
      expect(allLogs).toContain('### Search entries');
      expect(allLogs).toContain('### Create new entry');
      expect(allLogs).toContain('### Update entry');
      expect(allLogs).toContain('### Smart find');
    });

    it('should customize number of example entries', async () => {
      mockClient.get.mockResolvedValue(mockDbWithSchema);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage, mockPage, mockPage]));

      await program.parseAsync(['node', 'test', 'ai', 'prompt', 'db-123', '--examples', '3']);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', { page_size: 3 });
    });
  });

  describe('ai suggest', () => {
    it('should suggest find command for "done" query', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'show me done tasks']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('# Suggested commands');
      expect(allLogs).toContain('## Find completed items');
      expect(allLogs).toContain('notion find "hecho"');
    });

    it('should suggest create command for "create" query', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'crear nueva tarea']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Create new entry');
      expect(allLogs).toContain('notion page create');
    });

    it('should suggest update commands', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'actualizar tareas']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Update entries');
      expect(allLogs).toContain('notion page update');
      expect(allLogs).toContain('notion bulk update');
    });

    it('should suggest archive command', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'archivar completadas']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Archive entries');
      expect(allLogs).toContain('notion bulk archive');
    });

    it('should suggest stats commands', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'mostrar estadísticas']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Get statistics');
      expect(allLogs).toContain('notion stats overview');
      expect(allLogs).toContain('notion stats timeline');
    });

    it('should suggest export command', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'export database']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Export/Backup');
      expect(allLogs).toContain('notion export db');
    });

    it('should suggest find overdue command', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'tareas vencidas']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Find overdue items');
      expect(allLogs).toContain('notion find "vencidas"');
    });

    it('should suggest find unassigned command', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'ai', 'suggest', 'db-123', 'sin asignar']);

      const allLogs = (console.log as any).mock.calls.map((call: any) => call[0]).join('\n');
      expect(allLogs).toContain('## Find unassigned items');
      expect(allLogs).toContain('notion find "sin asignar"');
    });
  });

  describe('Error handling', () => {
    it('should handle summarize errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'ai', 'summarize', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle extract errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'ai', 'extract', 'invalid-page', '--schema', 'email'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle prompt errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'ai', 'prompt', 'invalid-db'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle suggest errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'ai', 'suggest', 'invalid-db', 'query'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });
});
