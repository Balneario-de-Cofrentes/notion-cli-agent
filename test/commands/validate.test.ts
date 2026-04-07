import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, mockPage, createPaginatedResult, createMockPage, setupDatabaseResolution } from '../fixtures/notion-data';

describe('Validate Command', () => {
  let program: Command;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();

    // Mock process.stdout.write (validate commands use it for progress)
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
    const { registerValidateCommand } = await import('../../src/commands/validate');
    program = new Command();
    registerValidateCommand(program);
  });

  describe('validate check', () => {
    it('should run basic validation and report no issues', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'check', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validating database: Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No issues found'));
    });

    it('should detect entries with empty titles', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', '', {
          Name: {
            id: 'title', type: 'title',
            title: [], // empty title
          },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'check', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('EMPTY TITLE'));
    });

    it('should check required properties with --required flag', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Assignee: { id: 'assignee', type: 'people', people: [] },
          'Due Date': { id: 'due', type: 'date', date: null },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--required', 'Assignee,Due Date',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('MISSING REQUIRED'));
      // Should find two missing required properties
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Missing required property: Assignee'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Missing required property: Due Date'));
    });

    it('should check for overdue items with --check-dates', async () => {
      // Database needs a 'Deadline' date property and a status property for overdue detection
      const dbWithDeadline = {
        ...mockDatabase,
        properties: {
          ...mockDatabase.properties,
          Deadline: { id: 'deadline', type: 'date', date: {} },
        },
      };
      setupDatabaseResolution(mockClient, dbWithDeadline);

      const pastDate = '2023-06-01';
      const entries = [
        createMockPage('p1', 'Overdue Task', {
          Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
          Deadline: { id: 'deadline', type: 'date', date: { start: pastDate } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--check-dates',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('OVERDUE'));
    });

    it('should not flag completed items as overdue', async () => {
      const dbWithDeadline = {
        ...mockDatabase,
        properties: {
          ...mockDatabase.properties,
          Deadline: { id: 'deadline', type: 'date', date: {} },
        },
      };
      setupDatabaseResolution(mockClient, dbWithDeadline);

      const entries = [
        createMockPage('p1', 'Done Task', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
          Deadline: { id: 'deadline', type: 'date', date: { start: '2023-01-01' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--check-dates',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No issues found'));
    });

    it('should check for stale in-progress items with --check-stale', async () => {
      setupDatabaseResolution(mockClient);

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const entries = [
        {
          ...createMockPage('p1', 'Stale Task', {
            Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
          }),
          last_edited_time: sixtyDaysAgo.toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--check-stale', '30',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('STALE'));
    });

    it('should not flag recently edited items as stale', async () => {
      setupDatabaseResolution(mockClient);

      const entries = [
        {
          ...createMockPage('p1', 'Active Task', {
            Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
          }),
          last_edited_time: new Date().toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--check-stale', '30',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No issues found'));
    });

    it('should output JSON when --json flag is used', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', '', {
          Name: { id: 'title', type: 'title', title: [] },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'check', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"issues"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"summary"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"errors"'));
    });

    it('should handle empty database', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'validate', 'check', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No issues found'));
    });

    it('should display health score after validation', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'check', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Health Score:'));
    });

    it('should show fix suggestions with --fix flag', async () => {
      const dbWithDeadline = {
        ...mockDatabase,
        properties: {
          ...mockDatabase.properties,
          Deadline: { id: 'deadline', type: 'date', date: {} },
        },
      };
      setupDatabaseResolution(mockClient, dbWithDeadline);

      const entries = [
        createMockPage('p1', 'Overdue Task', {
          Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
          Deadline: { id: 'deadline', type: 'date', date: { start: '2023-01-01' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync([
        'node', 'test', 'validate', 'check', 'db-123',
        '--check-dates', '--fix',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Fix:'));
    });
  });

  describe('validate lint', () => {
    it('should run lint checks', async () => {
      setupDatabaseResolution(mockClient);
      // The lint command calls queryDatabase multiple times:
      // once for each check filter, and once for duplicate detection
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Linting: Test Database'));
    });

    it('should detect entries with empty titles', async () => {
      setupDatabaseResolution(mockClient);
      const emptyTitleEntry = createMockPage('p1', '', {
        Name: { id: 'title', type: 'title', title: [] },
      });
      // First post call: empty titles check - returns 1 result
      // Subsequent calls: return empty results
      let callCount = 0;
      mockClient.post.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return createPaginatedResult([emptyTitleEntry]);
        }
        return createPaginatedResult([]);
      });

      await program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Empty titles: 1 found'));
    });

    it('should detect duplicate titles', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Duplicate Name'),
        createMockPage('p2', 'Duplicate Name'),
        createMockPage('p3', 'Unique Name'),
      ];
      // All filter-based checks return empty results
      // Final query for duplicate check returns entries
      let callCount = 0;
      mockClient.post.mockImplementation(async () => {
        callCount++;
        // The last call is the duplicate detection query
        if (callCount >= 3) {
          return createPaginatedResult(entries);
        }
        return createPaginatedResult([]);
      });

      await program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Duplicate titles'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('duplicate name'));
    });

    it('should show OK when no issues found', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Unique Task 1'),
        createMockPage('p2', 'Unique Task 2'),
      ];
      // All filter queries return empty, final query returns unique entries
      let callCount = 0;
      const totalFilterChecks = 2; // empty titles + in-progress stale
      mockClient.post.mockImplementation(async () => {
        callCount++;
        if (callCount > totalFilterChecks) {
          return createPaginatedResult(entries);
        }
        return createPaginatedResult([]);
      });

      await program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Empty titles: OK'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Duplicate titles: OK'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total issues: 0'));
    });

    it('should handle filter errors gracefully', async () => {
      setupDatabaseResolution(mockClient);
      // First call fails (filter not supported), second is duplicate check
      let callCount = 0;
      mockClient.post.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('filter not supported');
        }
        return createPaginatedResult([]);
      });

      await program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    });
  });

  describe('validate health', () => {
    it('should display health score', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
          Priority: { id: 'priority', type: 'select', select: { name: 'High', color: 'red' } },
          Tags: { id: 'tags', type: 'multi_select', multi_select: [{ name: 'bug', color: 'red' }] },
          Assignee: { id: 'assignee', type: 'people', people: [{ name: 'Test User' }] },
          'Due Date': { id: 'due', type: 'date', date: { start: '2024-06-01' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Health Report: Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Health Score:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Completion rate:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Average fill rate:'));
    });

    it('should show property fill rates', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
          Assignee: { id: 'assignee', type: 'people', people: [] },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('Property fill rates:');
    });

    it('should calculate completion rate from status property', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Done Task', {
          Status: { id: 'status', type: 'status', status: { name: 'Done', color: 'green' } },
        }),
        createMockPage('p2', 'Active Task', {
          Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      // 1 of 2 entries done = 50%
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Completion rate: 50%'));
    });

    it('should show recommendations for low fill rates', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        createMockPage('p1', 'Task 1', {
          Status: { id: 'status', type: 'status', status: null },
          Assignee: { id: 'assignee', type: 'people', people: [] },
          'Due Date': { id: 'due', type: 'date', date: null },
        }),
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Recommendations:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('populated'));
    });

    it('should handle empty database', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      // With empty entries, some calculations may produce NaN or 0.
      // The command should still complete without errors.
      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Health Report'));
    });

    it('should show activity score for recently edited entries', async () => {
      setupDatabaseResolution(mockClient);
      const entries = [
        {
          ...createMockPage('p1', 'Recent Task', {
            Status: { id: 'status', type: 'status', status: { name: 'In Progress', color: 'blue' } },
          }),
          last_edited_time: new Date().toISOString(),
        },
      ];
      mockClient.post.mockResolvedValue(createPaginatedResult(entries));

      await program.parseAsync(['node', 'test', 'validate', 'health', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Activity (last 7 days): 1/1'));
    });
  });

  describe('Error handling', () => {
    it('should handle database fetch errors in check', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'validate', 'check', 'bad-db-000'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors in lint', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockRejectedValue(new Error('Query failed'));

      await expect(
        program.parseAsync(['node', 'test', 'validate', 'lint', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Query failed');
    });

    it('should handle errors in health command', async () => {
      mockClient.get.mockRejectedValue(new Error('Access denied'));

      await expect(
        program.parseAsync(['node', 'test', 'validate', 'health', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Access denied');
    });
  });
});
