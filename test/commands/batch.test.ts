import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase, mockBlock } from '../fixtures/notion-data';

describe('Batch Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

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

    // Mock fs module
    vi.doMock('fs', () => ({
      readFileSync: vi.fn((path: string) => {
        if (mockFS.has(path)) {
          return mockFS.get(path);
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }),
    }));

    // Import command and register it
    const { registerBatchCommand } = await import('../../src/commands/batch');
    program = new Command();
    registerBatchCommand(program);
  });

  describe('batch from data string', () => {
    it('should execute get operations', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      const operations = [
        { op: 'get', type: 'page', id: 'page-123' },
        { op: 'get', type: 'database', id: 'db-123' },
      ];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('succeeded'));
    });

    it('should execute create page operation', async () => {
      mockClient.post.mockResolvedValue({ id: 'new-page', url: 'https://notion.so/new-page' });

      const operations = [{
        op: 'create',
        type: 'page',
        parent: 'db-123',
        data: {
          properties: {
            Name: { title: [{ text: { content: 'New Page' } }] },
          },
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { database_id: 'db-123' },
        properties: expect.any(Object),
      }));
    });

    it('should execute update operation', async () => {
      mockClient.patch.mockResolvedValue(mockPage);

      const operations = [{
        op: 'update',
        type: 'page',
        id: 'page-123',
        data: {
          properties: {
            Status: { status: { name: 'Done' } },
          },
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', expect.objectContaining({
        properties: expect.any(Object),
      }));
    });

    it('should execute delete operation for blocks', async () => {
      mockClient.delete.mockResolvedValue({});

      const operations = [{
        op: 'delete',
        type: 'block',
        id: 'block-123',
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.delete).toHaveBeenCalledWith('blocks/block-123');
    });

    it('should archive pages on delete operation', async () => {
      mockClient.patch.mockResolvedValue(mockPage);

      const operations = [{
        op: 'delete',
        type: 'page',
        id: 'page-123',
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/page-123', { archived: true });
    });

    it('should execute query operation', async () => {
      mockClient.post.mockResolvedValue({ results: [mockPage] });

      const operations = [{
        op: 'query',
        type: 'database',
        id: 'db-123',
        data: {
          filter: { property: 'Status', status: { equals: 'Done' } },
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.post).toHaveBeenCalledWith('databases/db-123/query', expect.objectContaining({
        filter: expect.any(Object),
      }));
    });

    it('should execute append blocks operation', async () => {
      mockClient.patch.mockResolvedValue({ results: [mockBlock] });

      const operations = [{
        op: 'append',
        type: 'block',
        id: 'page-123',
        data: {
          children: [
            { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Text' } }] } },
          ],
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', expect.objectContaining({
        children: expect.any(Array),
      }));
    });

    it('should handle mixed operations in sequence', async () => {
      mockClient.get.mockResolvedValue(mockPage);
      mockClient.post.mockResolvedValue({ id: 'new-page' });
      mockClient.patch.mockResolvedValue(mockPage);

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'create', type: 'page', parent: 'db-123', data: { properties: {} } },
        { op: 'update', type: 'page', id: 'page-2', data: {} },
      ];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.post).toHaveBeenCalledTimes(1);
      expect(mockClient.patch).toHaveBeenCalledTimes(1);
    });

    it('should handle single operation as object', async () => {
      mockClient.get.mockResolvedValue(mockPage);

      const operation = { op: 'get', type: 'page', id: 'page-123' };

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operation)]);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
    });
  });

  describe('batch from file', () => {
    it('should read operations from file', async () => {
      const operations = [
        { op: 'get', type: 'page', id: 'page-123' },
      ];
      mockFS.set('/tmp/batch.json', JSON.stringify(operations));
      mockClient.get.mockResolvedValue(mockPage);

      await program.parseAsync(['node', 'test', 'batch', '--file', '/tmp/batch.json']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/page-123');
    });

    it('should handle file read errors', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'batch', '--file', '/nonexistent.json'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', expect.stringContaining('ENOENT'));
    });

    it('should handle invalid JSON in file', async () => {
      mockFS.set('/tmp/invalid.json', '{invalid json}');

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--file', '/tmp/invalid.json'])
      ).rejects.toThrow();
    });
  });

  describe('dry run mode', () => {
    it('should preview operations without executing', async () => {
      const operations = [
        { op: 'get', type: 'page', id: 'page-123' },
        { op: 'update', type: 'page', id: 'page-456', data: {} },
      ];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations), '--dry-run']);

      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('get page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('update page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Total: 2 operations'));
    });
  });

  describe('error handling', () => {
    it('should continue on errors by default', async () => {
      mockClient.get
        .mockResolvedValueOnce(mockPage)
        .mockRejectedValueOnce(new Error('Page not found'))
        .mockResolvedValueOnce(mockPage);

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'get', type: 'page', id: 'invalid' },
        { op: 'get', type: 'page', id: 'page-3' },
      ];

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)])
      ).rejects.toThrow('process.exit(1)');

      expect(mockClient.get).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('succeeded'));
    });

    it('should stop on first error with --stop-on-error', async () => {
      mockClient.get
        .mockResolvedValueOnce(mockPage)
        .mockRejectedValueOnce(new Error('Page not found'));

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'get', type: 'page', id: 'invalid' },
        { op: 'get', type: 'page', id: 'page-3' },
      ];

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations), '--stop-on-error'])
      ).rejects.toThrow('process.exit(1)');

      expect(mockClient.get).toHaveBeenCalledTimes(2); // Stops after error
    });

    it('should handle unknown operations', async () => {
      const operations = [
        { op: 'invalid_op', type: 'page', id: 'page-123' } as any,
      ];

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)])
      ).rejects.toThrow('process.exit(1)');
    });

    it('should exit with error code if any operation failed', async () => {
      mockClient.get
        .mockResolvedValueOnce(mockPage)
        .mockRejectedValueOnce(new Error('Failed'));

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'get', type: 'page', id: 'invalid' },
      ];

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)])
      ).rejects.toThrow('process.exit(1)');
    });
  });

  describe('LLM output format', () => {
    it('should format output for LLMs with --llm flag', async () => {
      mockClient.get
        .mockResolvedValueOnce({ id: 'page-1', url: 'https://notion.so/page-1' })
        .mockResolvedValueOnce({ id: 'page-2', url: 'https://notion.so/page-2' });

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'get', type: 'page', id: 'page-2' },
      ];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations), '--llm']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Batch Results:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: page-1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('URL:'));
    });

    it('should show errors in LLM format', async () => {
      mockClient.get
        .mockResolvedValueOnce(mockPage)
        .mockRejectedValueOnce(new Error('Not found'));

      const operations = [
        { op: 'get', type: 'page', id: 'page-1' },
        { op: 'get', type: 'page', id: 'invalid' },
      ];

      await expect(
        program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations), '--llm'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('❌'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error: Not found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('⚠️'));
    });
  });

  describe('operation types', () => {
    it('should create page with page parent', async () => {
      mockClient.post.mockResolvedValue({ id: 'new-page' });

      const operations = [{
        op: 'create',
        type: 'page',
        parent: 'page-parent',
        data: {
          parent_type: 'page',
          properties: {},
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.post).toHaveBeenCalledWith('pages', expect.objectContaining({
        parent: { page_id: 'page-parent' },
      }));
    });

    it('should create database', async () => {
      mockClient.post.mockResolvedValue({ id: 'new-db' });

      const operations = [{
        op: 'create',
        type: 'database',
        parent: 'page-123',
        data: {
          title: [{ text: { content: 'New DB' } }],
          properties: {
            Name: { title: {} },
          },
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.post).toHaveBeenCalledWith('databases', expect.objectContaining({
        parent: { page_id: 'page-123' },
        title: expect.any(Array),
      }));
    });

    it('should update database', async () => {
      mockClient.patch.mockResolvedValue(mockDatabase);

      const operations = [{
        op: 'update',
        type: 'database',
        id: 'db-123',
        data: {
          title: [{ text: { content: 'Updated' } }],
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.patch).toHaveBeenCalledWith('databases/db-123', expect.any(Object));
    });

    it('should update block', async () => {
      mockClient.patch.mockResolvedValue(mockBlock);

      const operations = [{
        op: 'update',
        type: 'block',
        id: 'block-123',
        data: {
          paragraph: { rich_text: [{ text: { content: 'Updated' } }] },
        },
      }];

      await program.parseAsync(['node', 'test', 'batch', '--data', JSON.stringify(operations)]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/block-123', expect.any(Object));
    });
  });
});
