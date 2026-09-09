/**
 * Sync command -- fetch all accessible databases and cache locally
 *
 * Stores a registry in ~/.config/notion/workspace.json for fast
 * database-name-to-UUID resolution across all commands.
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { getDbTitle } from '../utils/notion-helpers.js';
import { writeWorkspaceRegistry, getWorkspacePath } from '../utils/workspace-resolver.js';
import { fishGuests } from '../utils/people-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import type { RegistryEntry } from '../utils/workspace-resolver.js';
import type { Database } from '../types/notion.js';

/** What `getDbTitle` returns for a data source with no title. */
const UNTITLED = 'Untitled';

/**
 * A `data_source` search hit. Its `id` is the data_source id; the id of the
 * database that owns it lives in `parent.database_id`.
 */
type DataSourceHit = Database & {
  url?: string;
  parent?: { type?: string; database_id?: string };
};

interface SearchResult {
  results: DataSourceHit[];
  has_more: boolean;
  next_cursor?: string;
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync workspace databases for name-based lookups')
    .option('-j, --json', 'Output as JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const entries = new Map<string, RegistryEntry>();
      let cursor: string | undefined;
      const now = new Date().toISOString();

      do {
        const body: Record<string, unknown> = {
          filter: { property: 'object', value: 'data_source' },
          page_size: 100,
        };
        if (cursor) body.start_cursor = cursor;

        const result = await client.post('search', body) as SearchResult;

        for (const ds of result.results) {
          // The registry maps names to *database* ids: that is what the
          // database resolver starts from and what page creation sends as
          // `parent.database_id`. Storing the data_source id here 404s every
          // name-based lookup (#60).
          const id = ds.parent?.database_id ?? ds.id;
          const title = getDbTitle(ds);

          // A multi-source database yields one hit per data source. Keep the
          // first titled one — untitled sources (linked views, empty sources)
          // must not shadow the named one, whichever order they arrive in.
          const existing = entries.get(id);
          if (existing && (existing.title !== UNTITLED || title === UNTITLED)) continue;

          entries.set(id, { id, title, url: ds.url, syncedAt: now });
        }

        cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
      } while (cursor);

      const registry = [...entries.values()];
      writeWorkspaceRegistry(registry);

      // Guests aren't in the user list; fish their ids from page authorship so
      // people properties can later be assigned by email/name. Non-fatal.
      let guests: Array<{ id: string; name: string; email: string }> = [];
      try {
        guests = await fishGuests(client);
      } catch {
        // ignore — sync's primary job is the database registry
      }

      if (options.json) {
        console.log(formatOutput({ databases: registry, guests }));
        return;
      }

      console.log(`Synced ${registry.length} database(s) to ${getWorkspacePath()}\n`);
      if (guests.length > 0) {
        console.log(`Resolved ${guests.length} guest user(s) not visible in "notion user list".\n`);
      }
      for (const entry of registry) {
        console.log(`  ${entry.title.padEnd(30)} ${entry.id.slice(0, 8)}...`);
      }
      console.log(`\nYou can now use database names instead of UUIDs:`);
      console.log(`  notion db query "${registry[0]?.title || 'My Database'}"`);
      console.log(`  notion list`);
    }));
}
