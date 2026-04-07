import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockDatabase, mockPage, createPaginatedResult, setupDatabaseResolution } from '../fixtures/notion-data';

describe('Inspect Command', () => {
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
    const { registerInspectCommand } = await import('../../src/commands/inspect');
    program = new Command();
    registerInspectCommand(program);
  });

  describe('inspect workspace', () => {
    it('should list all accessible databases', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([
        mockDatabase,
        { ...mockDatabase, id: 'db-456', title: [{ plain_text: 'Second Database' }] },
      ]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(mockClient.post).toHaveBeenCalledWith('search', expect.objectContaining({
        filter: { property: 'object', value: 'data_source' },
        page_size: 20,
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 accessible database(s)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Second Database'));
    });

    it('should respect --limit option', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockDatabase]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace', '--limit', '5']);

      expect(mockClient.post).toHaveBeenCalledWith('search', expect.objectContaining({
        page_size: 5,
      }));
    });

    it('should show compact output with --compact', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockDatabase]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace', '--compact']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('db-123'));
    });

    it('should output JSON with --json', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockDatabase]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"id": "db-123"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"properties"'));
    });

    it('should show count in output', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([
        mockDatabase,
        { ...mockDatabase, id: 'db-456' },
      ]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 accessible database(s)'));
    });

    it('should handle no databases found', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 0 accessible database(s)'));
    });

    it('should show [multi-source] tag for databases with data_sources', async () => {
      const multiSourceDb = {
        ...mockDatabase,
        id: 'db-multi',
        title: [{ plain_text: 'Multi Source DB' }],
        data_sources: [
          { id: 'ds-aaa', name: 'Source A' },
          { id: 'ds-bbb', name: 'Source B' },
        ],
      };
      mockClient.post.mockResolvedValue(createPaginatedResult([multiSourceDb]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[multi-source]'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ds-aaa'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ds-bbb'));
    });

    it('should show [multi-source] tag in compact mode', async () => {
      const multiSourceDb = {
        ...mockDatabase,
        id: 'db-multi',
        title: [{ plain_text: 'Multi Source DB' }],
        data_sources: [{ id: 'ds-aaa', name: 'Source A' }, { id: 'ds-bbb', name: 'Source B' }],
      };
      mockClient.post.mockResolvedValue(createPaginatedResult([multiSourceDb]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace', '--compact']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[multi-source]'));
    });

    it('should continue listing when a database has no properties', async () => {
      const dbWithNoProps = {
        object: 'database',
        id: 'db-noprops',
        title: [{ plain_text: 'Broken DB' }],
        properties: undefined,
      };
      const normalDb = { ...mockDatabase, id: 'db-normal', title: [{ plain_text: 'Normal DB' }] };
      mockClient.post.mockResolvedValue(createPaginatedResult([dbWithNoProps, normalDb]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Normal DB'));
    });

    it('should warn and continue when per-database processing throws', async () => {
      const badDb = {
        object: 'database',
        id: 'db-bad',
        title: [{ plain_text: 'Bad DB' }],
        get properties() { throw new Error('Unexpected error'); },
      };
      const goodDb = { ...mockDatabase, id: 'db-good', title: [{ plain_text: 'Good DB' }] };
      mockClient.post.mockResolvedValue(createPaginatedResult([badDb, goodDb]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('db-bad'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Good DB'));
    });

    it('should not show multi-source indicators for normal databases', async () => {
      mockClient.post.mockResolvedValue(createPaginatedResult([mockDatabase]));

      await program.parseAsync(['node', 'test', 'inspect', 'workspace']);

      const logCalls = (console.log as any).mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('[multi-source]');
      expect(logCalls).not.toContain('Data sources:');
    });
  });

  describe('inspect schema', () => {
    it('should show detailed schema for database', async () => {
      setupDatabaseResolution(mockClient);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-456');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Database: Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Properties:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Name'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status'));
    });

    it('should output JSON with --json', async () => {
      setupDatabaseResolution(mockClient);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"id": "ds-456"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"properties"'));
    });

    it('should format LLM-friendly output with --llm', async () => {
      setupDatabaseResolution(mockClient);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123', '--llm']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Database:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: ds-456'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Properties'));
    });

    it('should show select options', async () => {
      const dbWithSelect = {
        ...mockDatabase,
        properties: {
          Priority: {
            id: 'priority',
            name: 'Priority',
            type: 'select',
            select: {
              options: [
                { id: 'opt-1', name: 'High', color: 'red' },
                { id: 'opt-2', name: 'Medium', color: 'yellow' },
                { id: 'opt-3', name: 'Low', color: 'green' },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithSelect);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Priority'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('High'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Medium'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Low'));
    });

    it('should show multi_select options', async () => {
      const dbWithMultiSelect = {
        ...mockDatabase,
        properties: {
          Tags: {
            id: 'tags',
            name: 'Tags',
            type: 'multi_select',
            multi_select: {
              options: [
                { id: 'tag-1', name: 'Important', color: 'red' },
                { id: 'tag-2', name: 'Urgent', color: 'orange' },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithMultiSelect);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tags'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Important'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Urgent'));
    });

    it('should show status options with groups', async () => {
      const dbWithStatus = {
        ...mockDatabase,
        properties: {
          Status: {
            id: 'status',
            name: 'Status',
            type: 'status',
            status: {
              options: [
                { id: 'stat-1', name: 'Not Started', color: 'gray' },
                { id: 'stat-2', name: 'In Progress', color: 'blue' },
                { id: 'stat-3', name: 'Done', color: 'green' },
              ],
              groups: [
                { id: 'grp-1', name: 'To Do', option_ids: ['stat-1'] },
                { id: 'grp-2', name: 'In Progress', option_ids: ['stat-2'] },
                { id: 'grp-3', name: 'Complete', option_ids: ['stat-3'] },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithStatus);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Status groups:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('To Do: Not Started'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('In Progress: In Progress'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Complete: Done'));
    });

    it('should show relation info', async () => {
      const dbWithRelation = {
        ...mockDatabase,
        properties: {
          Project: {
            id: 'project',
            name: 'Project',
            type: 'relation',
            relation: {
              database_id: 'db-projects',
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithRelation);

      await program.parseAsync(['node', 'test', 'inspect', 'schema', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Project'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Related database: db-projects'));
    });

    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'inspect', 'schema', 'bad-db-000'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });

  describe('inspect context', () => {
    it('should generate LLM-friendly context for database', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(mockClient.get).toHaveBeenCalledWith('databases/db-123');
      expect(mockClient.get).toHaveBeenCalledWith('data_sources/ds-456');
      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', expect.objectContaining({
        page_size: 3,
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Notion Database Context'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test Database'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Schema'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Example Entries'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Quick Commands'));
    });

    it('should respect --examples option', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123', '--examples', '5']);

      expect(mockClient.post).toHaveBeenCalledWith('data_sources/ds-456/query', expect.objectContaining({
        page_size: 5,
      }));
    });

    it('should show database description if available', async () => {
      const dbWithDescription = {
        ...mockDatabase,
        description: [{ plain_text: 'This is a test database' }],
      };
      setupDatabaseResolution(mockClient, dbWithDescription);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This is a test database'));
    });

    it('should show schema table with property types', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('| Property | Type | Values |'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('|----------|------|--------|'));
    });

    it('should show select options in schema table', async () => {
      const dbWithSelect = {
        ...mockDatabase,
        properties: {
          Priority: {
            id: 'priority',
            name: 'Priority',
            type: 'select',
            select: {
              options: [
                { id: 'opt-1', name: 'High', color: 'red' },
                { id: 'opt-2', name: 'Medium', color: 'yellow' },
                { id: 'opt-3', name: 'Low', color: 'green' },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithSelect);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Priority'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('High, Medium, Low'));
    });

    it('should truncate long option lists', async () => {
      const dbWithManyOptions = {
        ...mockDatabase,
        properties: {
          Tags: {
            id: 'tags',
            name: 'Tags',
            type: 'multi_select',
            multi_select: {
              options: [
                { id: 'opt-1', name: 'Tag1', color: 'red' },
                { id: 'opt-2', name: 'Tag2', color: 'blue' },
                { id: 'opt-3', name: 'Tag3', color: 'green' },
                { id: 'opt-4', name: 'Tag4', color: 'yellow' },
                { id: 'opt-5', name: 'Tag5', color: 'orange' },
                { id: 'opt-6', name: 'Tag6', color: 'purple' },
              ],
            },
          },
        },
      };
      setupDatabaseResolution(mockClient, dbWithManyOptions);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Tag1, Tag2, Tag3, Tag4, Tag5...'));
    });

    it('should show example entry properties', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('### Entry 1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: page-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('**Name:**'));
    });

    it('should format different property types in examples', async () => {
      const complexPage = {
        ...mockPage,
        properties: {
          Title: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Test Title' }],
          },
          Status: {
            type: 'status',
            status: { name: 'Done' },
          },
          Tags: {
            type: 'multi_select',
            multi_select: [{ name: 'Important' }, { name: 'Urgent' }],
          },
          Number: {
            type: 'number',
            number: 42,
          },
          Checkbox: {
            type: 'checkbox',
            checkbox: true,
          },
          Date: {
            type: 'date',
            date: { start: '2026-02-15' },
          },
          URL: {
            type: 'url',
            url: 'https://example.com',
          },
        },
      };
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([complexPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test Title'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Done'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Important, Urgent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('42'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('true'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2026-02-15'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('https://example.com'));
    });

    it('should show quick command examples', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([mockPage]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('notion db query db-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('notion page create --parent db-123'));
    });

    it('should handle empty example results', async () => {
      setupDatabaseResolution(mockClient);
      mockClient.post.mockResolvedValue(createPaginatedResult([]));

      await program.parseAsync(['node', 'test', 'inspect', 'context', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('# Notion Database Context'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Schema'));
      // Should still show quick commands even without examples
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Quick Commands'));
    });

    it('should handle context errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'inspect', 'context', 'bad-db-000'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });
});
