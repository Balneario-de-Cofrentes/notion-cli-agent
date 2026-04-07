import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, mockPage, createPaginatedResult, createMockPage, setupDatabaseResolution } from '../fixtures/notion-data';

describe('Stats Command', () => {
  let program: Command;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();

    // Mock process.stdout.write (stats commands use it for progress)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

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
    const { registerStatsCommand } = await import('../../src/commands/stats');
    program = new Command();
    registerStatsCommand(program);
  });

  describe('stats overview', () => {
    it('should display overview with property breakdowns', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
        }),
        createMockPage('p2', 'Task 2', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
        createMockPage('p3', 'Task 3', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database: Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total entries: 3'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status:'));
    });

    it('should output JSON when --json flag is used', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"totalEntries": 1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"database": "Test Database"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"breakdowns"'));
    });

    it('should handle empty database', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total entries: 0'));
    });

    it('should include select properties matching naming conventions in breakdowns', async () => {
      // The stats command includes select properties whose name contains
      // 'priority', 'type', or 'category'
      const dbWithPriority = {
        ...mockDatabase,
        properties: {
          ...mockDatabase.properties,
          Priority: {
            id: 'priority',
            type: 'select',
            select: {
              options: [
                { name: 'Low', color: 'gray' },
                { name: 'High', color: 'red' },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithPriority);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
          Priority: { id: 'priority', type: 'select', select: { name: 'High', color: 'red' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123', '--json']);

      const logCall = (console.log as any).mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('"breakdowns"')
      );
      expect(logCall).toBeDefined();
      const parsed = JSON.parse(logCall[0]);
      expect(parsed.breakdowns).toHaveProperty('Priority');
      expect(parsed.breakdowns).toHaveProperty('Status');
    });

    it('should show activity data (createdByMonth, editedByMonth)', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        {
          ...createMockPage('p1', 'Task 1'),
          created_time: '2024-01-15T10:00:00.000Z',
          last_edited_time: '2024-02-01T10:00:00.000Z',
        },
        {
          ...createMockPage('p2', 'Task 2'),
          created_time: '2024-01-20T10:00:00.000Z',
          last_edited_time: '2024-01-25T10:00:00.000Z',
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123', '--json']);

      const logCall = (console.log as any).mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('"activity"')
      );
      expect(logCall).toBeDefined();
      const parsed = JSON.parse(logCall[0]);
      expect(parsed.activity.createdByMonth['2024-01']).toBe(2);
      expect(parsed.activity.editedByMonth['2024-02']).toBe(1);
    });

    it('should count (empty) for entries without a breakdown property value', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: null },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123', '--json']);

      const logCall = (console.log as any).mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('"breakdowns"')
      );
      const parsed = JSON.parse(logCall[0]);
      expect(parsed.breakdowns.Status['(empty)']).toBe(1);
    });

    it('should show LLM-friendly output with --llm flag', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'overview', 'db-123', '--llm']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Database Stats:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('**Total entries:** 1'));
      expect(console.log).toHaveBeenCalledWith('## Recent Activity');
    });
  });

  describe('stats timeline', () => {
    it('should display timeline for default 14 days', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        {
          ...createMockPage('p1', 'Task 1'),
          last_edited_time: new Date().toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Activity timeline (last 14 days)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total: 1 entries edited'));
    });

    it('should respect --days option', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123', '--days', '7']);

      // Should query with a filter for last_edited_time on_or_after 7 days ago
      expect(mockClient.post).toHaveBeenCalledWith(
        'data_sources/ds-456/query',
        expect.objectContaining({
          filter: expect.objectContaining({
            timestamp: 'last_edited_time',
            last_edited_time: expect.objectContaining({
              on_or_after: expect.any(String),
            }),
          }),
        })
      );

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Activity timeline (last 7 days)'));
    });

    it('should output JSON when --json flag is used', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        {
          ...createMockPage('p1', 'Task 1'),
          last_edited_time: new Date().toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"days": 14'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"byDay"'));
    });

    it('should group entries by day', async () => {
      setupDatabaseResolution(mockClient);
      const today = new Date().toISOString().split('T')[0];
      const entries = [
        {
          ...createMockPage('p1', 'Task 1'),
          last_edited_time: `${today}T10:00:00.000Z`,
        },
        {
          ...createMockPage('p2', 'Task 2'),
          last_edited_time: `${today}T14:00:00.000Z`,
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123', '--json']);

      const logCall = (console.log as any).mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('"byDay"')
      );
      const parsed = JSON.parse(logCall[0]);
      expect(parsed.byDay[today]).toHaveLength(2);
    });

    it('should handle empty results', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total: 0 entries edited'));
    });

    it('should show page titles when day has 5 or fewer entries', async () => {
      setupDatabaseResolution(mockClient);
      // Use a fixed date that's guaranteed to be within the 14-day window.
      // Generate a date 2 days ago at noon UTC to avoid timezone edge cases.
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      twoDaysAgo.setUTCHours(12, 0, 0, 0);
      const entries = [
        {
          ...createMockPage('p1', 'My Task'),
          last_edited_time: twoDaysAgo.toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123']);

      // Page titles appear indented with a └─ prefix on days with <= 5 entries
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('My Task'));
    });
  });

  describe('Error handling', () => {
    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'stats', 'overview', 'bad-db-000'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors in timeline', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockRejectedValue(new Error('Query failed'));

      await expect(
        program.parseAsync(['node', 'test', 'stats', 'timeline', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Query failed');
    });
  });
});
