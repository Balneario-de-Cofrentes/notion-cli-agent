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
import { withErrorHandler } from '../utils/command-handler.js';
import type { RegistryEntry } from '../utils/workspace-resolver.js';
import type { Database } from '../types/notion.js';

interface SearchResult {
  results: Array<Database & { url?: string }>;
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

      const entries: RegistryEntry[] = [];
      let cursor: string | undefined;
      const now = new Date().toISOString();

      do {
        const body: Record<string, unknown> = {
          filter: { property: 'object', value: 'data_source' },
          page_size: 100,
        };
        if (cursor) body.start_cursor = cursor;

        const result = await client.post('search', body) as SearchResult;

        for (const db of result.results) {
          entries.push({
            id: db.id,
            title: getDbTitle(db),
            url: db.url,
            syncedAt: now,
          });
        }

        cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
      } while (cursor);

      writeWorkspaceRegistry(entries);

      if (options.json) {
        console.log(formatOutput(entries));
        return;
      }

      console.log(`Synced ${entries.length} database(s) to ${getWorkspacePath()}\n`);
      for (const entry of entries) {
        console.log(`  ${entry.title.padEnd(30)} ${entry.id.slice(0, 8)}...`);
      }
      console.log(`\nYou can now use database names instead of UUIDs:`);
      console.log(`  notion db query "${entries[0]?.title || 'My Database'}"`);
      console.log(`  notion list`);
    }));
}
