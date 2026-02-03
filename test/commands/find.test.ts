import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, createPaginatedResult, createMockPage } from '../fixtures/notion-data';

describe('Find Command', () => {
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
    const { registerFindCommand } = await import('../../src/commands/find');
    program = new Command();
    registerFindCommand(program);
  });

  describe('Status pattern matching', () => {
    it('should find "done" tasks', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync(['node', 'test', 'find', 'done', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalledWith(
        'databases/db-123/query',
        expect.objectContaining({
          filter: expect.objectContaining({
            property: expect.any(String),
          }),
        })
      );
    });

    it('should recognize "in progress" pattern', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'in progress tasks', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should recognize "todo" pattern', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'pending todo', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should recognize Spanish patterns', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'tareas terminadas', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });
  });

  describe('Assignee pattern matching', () => {
    it('should find unassigned tasks', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'unassigned', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });
  });

  describe('Date pattern matching', () => {
    it('should find overdue tasks', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'overdue', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should find tasks for today', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'today', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should find tasks for this week', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'this week', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });
  });

  describe('Priority pattern matching', () => {
    it('should find urgent tasks', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'urgent', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should find high priority tasks', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'high priority', '-d', 'db-123']);

      expect(mockClient.post).toHaveBeenCalled();
    });
  });

  describe('Output formats', () => {
    it('should display results in human-readable format', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([
        createMockPage('1', 'Task 1'),
        createMockPage('2', 'Task 2'),
      ]));

      await program.parseAsync(['node', 'test', 'find', 'done', '-d', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 results'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([createMockPage('1', 'Task 1')]));

      await program.parseAsync(['node', 'test', 'find', 'done', '-d', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });

    it('should show empty results message', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'find', 'done', '-d', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('No matching entries found.');
    });
  });

  describe('Explain mode', () => {
    it('should explain query translation with --explain flag', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);

      await program.parseAsync(['node', 'test', 'find', 'overdue urgent tasks', '-d', 'db-123', '--explain']);

      // Verify explain mode outputs (console.log called 4 times for explain output)
      expect(console.log).toHaveBeenCalledWith('🔍 Parsed query:', expect.any(String));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📋 Generated filter:'), expect.any(String));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('💡 To execute manually:'));
    });
  });

  describe('Error handling', () => {
    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'find', 'done', '-d', 'invalid-db'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });

    it('should handle query errors', async () => {
      mockClient.get.mockResolvedValue(mockDatabase);
      mockClient.post.mockRejectedValue(new Error('Invalid filter'));

      await expect(
        program.parseAsync(['node', 'test', 'find', 'done', '-d', 'db-123'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Invalid filter');
    });
  });
});
