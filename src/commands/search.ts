/**
 * Search command - search pages and databases
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, formatDatabaseTitle } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { getParentDatabaseId } from '../utils/notion-helpers.js';

interface SearchItem {
  object: 'page' | 'database' | 'data_source';
  id: string;
  title?: Array<{ plain_text: string }>;
  properties?: Record<string, unknown>;
  parent?: { type: string; database_id?: string; data_source_id?: string; page_id?: string };
  url?: string;
}

interface SearchResult {
  object: string;
  results: SearchItem[];
  has_more: boolean;
  next_cursor: string | null;
}

function getItemTitle(item: SearchItem): string {
  if (item.object === 'page') return formatPageTitle(item);
  return formatDatabaseTitle(item);
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search [query]')
    .description('Search pages and databases')
    .option('-t, --type <type>', 'Filter by type: page, database', '')
    .option('-s, --sort <direction>', 'Sort by last_edited_time: asc, desc', '')
    .option('-l, --limit <number>', 'Max results to return', '10')
    .option('--cursor <cursor>', 'Pagination cursor for next page')
    .option('--db <database_id>', 'Filter results to pages in this database')
    .option('--exact', 'Only show exact title matches')
    .option('--first', 'Return only the first result (exit 1 if none)')
    .option('--llm', 'Compact LLM-friendly output')
    .option('-j, --json', 'Output raw JSON')
    .option('--ids-only', 'Output only IDs, one per line')
    .action(withErrorHandler(async (query: string | undefined, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};
      if (query) body.query = query;
      if (options.type) {
        const apiType = options.type === 'database' ? 'data_source' : options.type;
        body.filter = { property: 'object', value: apiType };
      }
      if (options.sort) {
        body.sort = {
          direction: options.sort,
          timestamp: 'last_edited_time',
        };
      }
      const needsPostFilter = options.db || options.exact;
      const requestLimit = parseInt(options.limit || '10', 10);
      body.page_size = needsPostFilter ? 100 : requestLimit;
      if (options.cursor) body.start_cursor = options.cursor;

      // When post-filtering (--db, --exact), paginate until we have enough
      // matches or exhaust the cursor. Without post-filters, single request.
      let items: SearchItem[] = [];
      let lastHasMore = false;
      let lastCursor: string | null = null;

      let cursor: string | undefined = options.cursor;
      do {
        if (cursor) body.start_cursor = cursor;
        const result = await client.post<SearchResult>('search', body);

        let batch = result.results;

        if (options.db) {
          batch = batch.filter(item => {
            if (!item.parent) return false;
            const parentId = getParentDatabaseId(item.parent as any);
            return parentId === options.db;
          });
        }

        if (options.exact && query) {
          const lowerQuery = query.toLowerCase();
          batch = batch.filter(item => getItemTitle(item).toLowerCase() === lowerQuery);
        }

        items.push(...batch);
        lastHasMore = result.has_more;
        lastCursor = result.next_cursor;

        // Stop conditions: enough results, no more pages, or no post-filter
        if (!needsPostFilter) break;
        if (options.first && items.length >= 1) break;
        if (items.length >= requestLimit) break;
        cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
      } while (cursor);

      // Trim to requested limit
      if (!options.first && items.length > requestLimit) {
        items = items.slice(0, requestLimit);
      }

      // --first: return one result or exit 1
      if (options.first) {
        if (items.length === 0) {
          if (!options.json && !options.llm) console.error('No matching result found.');
          process.exit(1);
        }
        items = [items[0]];
      }

      if (options.json) {
        console.log(formatOutput(options.first ? items[0] : { results: items, has_more: lastHasMore, next_cursor: lastCursor }));
        return;
      }

      if (options.idsOnly) {
        for (const item of items) {
          console.log(item.id);
        }
        return;
      }

      if (items.length === 0) {
        console.log('No results found.');
        return;
      }

      // --llm: compact output
      if (options.llm) {
        for (const item of items) {
          const title = getItemTitle(item);
          const type = item.object === 'page' ? 'page' : 'db';
          console.log(`[${type}] ${item.id} ${title}`);
        }
        if (lastHasMore && !options.first) {
          console.log(`(more results available)`);
        }
        return;
      }

      for (const item of items) {
        const isPage = item.object === 'page';
        const icon = isPage ? '📄' : '🗄️';
        const title = getItemTitle(item);
        console.log(`${icon} ${title}`);
        console.log(`   ID: ${item.id}`);
        if (item.url) console.log(`   URL: ${item.url}`);
        console.log('');
      }

      if (lastHasMore && !options.first) {
        console.log(`More results available. Use --cursor ${lastCursor}`);
      }
    }));
}
