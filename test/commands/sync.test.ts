import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import type { RegistryEntry } from '../../src/utils/workspace-resolver';

/**
 * `notion sync` searches for `object: data_source`, so every result's `id` is a
 * *data_source* id. The registry it writes maps names → *database* ids: that is
 * what `resolveDatabaseInput` hands to the database resolver (which starts at
 * `GET databases/{id}`) and what page creation sends as `parent.database_id`.
 * Storing the data_source id there 404s every name-based lookup (issue #60).
 */
function dataSourceResult(
  dataSourceId: string,
  title: string,
  databaseId?: string,
) {
  return {
    object: 'data_source',
    id: dataSourceId,
    title: [{ type: 'text', text: { content: title }, plain_text: title }],
    url: `https://www.notion.so/${(databaseId ?? dataSourceId).replace(/-/g, '')}`,
    ...(databaseId
      ? { parent: { type: 'database_id', database_id: databaseId } }
      : {}),
  };
}

describe('Sync Command', () => {
  let program: Command;
  let mockClient: any;
  let writeWorkspaceRegistry: ReturnType<typeof vi.fn>;

  const written = (): RegistryEntry[] => writeWorkspaceRegistry.mock.calls[0][0];

  beforeEach(async () => {
    vi.resetModules();

    mockClient = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    writeWorkspaceRegistry = vi.fn();
    vi.doMock('../../src/utils/workspace-resolver', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/utils/workspace-resolver')>()),
      writeWorkspaceRegistry,
    }));

    vi.doMock('../../src/utils/people-resolver', () => ({
      fishGuests: vi.fn().mockResolvedValue([]),
    }));

    const { registerSyncCommand } = await import('../../src/commands/sync');
    program = new Command();
    registerSyncCommand(program);
  });

  it('stores the parent database id, not the data_source id', async () => {
    mockClient.post.mockResolvedValue({
      results: [
        dataSourceResult(
          'f15da849-8e87-409e-a107-73ef066694ca',
          'LTUse Team Board',
          '9ccdc578-6545-44d9-aca2-0c690524a9ff',
        ),
      ],
      has_more: false,
    });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(written()).toEqual([
      expect.objectContaining({
        id: '9ccdc578-6545-44d9-aca2-0c690524a9ff',
        title: 'LTUse Team Board',
      }),
    ]);
  });

  it('records one entry per database when a database has several data sources', async () => {
    mockClient.post.mockResolvedValue({
      results: [
        dataSourceResult('ds-1', 'Board (Tasks)', 'db-1'),
        dataSourceResult('ds-2', 'Board (Archive)', 'db-1'),
        dataSourceResult('ds-3', 'Other', 'db-2'),
      ],
      has_more: false,
    });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(written().map(e => e.id)).toEqual(['db-1', 'db-2']);
  });

  it('keeps the titled data source when an untitled one comes first', async () => {
    // Real workspaces return untitled data sources (linked views, empty
    // sources) alongside the named one, in either order.
    mockClient.post.mockResolvedValue({
      results: [
        { ...dataSourceResult('ds-untitled', '', 'db-1'), title: [] },
        dataSourceResult('ds-named', 'Inventario hardware', 'db-1'),
      ],
      has_more: false,
    });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(written()).toEqual([
      expect.objectContaining({ id: 'db-1', title: 'Inventario hardware' }),
    ]);
  });

  it('keeps a single Untitled entry when every data source is untitled', async () => {
    mockClient.post.mockResolvedValue({
      results: [
        { ...dataSourceResult('ds-a', '', 'db-1'), title: [] },
        { ...dataSourceResult('ds-b', '', 'db-1'), title: [] },
      ],
      has_more: false,
    });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(written()).toEqual([
      expect.objectContaining({ id: 'db-1', title: 'Untitled' }),
    ]);
  });

  it('falls back to the data_source id when the result has no parent database', async () => {
    mockClient.post.mockResolvedValue({
      results: [dataSourceResult('ds-orphan', 'Orphan')],
      has_more: false,
    });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(written()[0].id).toBe('ds-orphan');
  });

  it('follows pagination across pages of search results', async () => {
    mockClient.post
      .mockResolvedValueOnce({
        results: [dataSourceResult('ds-1', 'First', 'db-1')],
        has_more: true,
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        results: [dataSourceResult('ds-2', 'Second', 'db-2')],
        has_more: false,
      });

    await program.parseAsync(['node', 'test', 'sync']);

    expect(mockClient.post).toHaveBeenNthCalledWith(2, 'search', {
      filter: { property: 'object', value: 'data_source' },
      page_size: 100,
      start_cursor: 'cursor-2',
    });
    expect(written().map(e => e.id)).toEqual(['db-1', 'db-2']);
  });
});
