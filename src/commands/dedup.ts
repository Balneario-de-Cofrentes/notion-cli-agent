/**
 * Dedup command — find and clean duplicate pages in a database
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { getPageTitle, buildTrashPayload } from '../utils/notion-helpers.js';
import { queryAllPages } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import type { Page } from '../types/notion.js';

// ─── Title normalization ────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

const FUZZY_SUFFIXES = /\s*(\(copy\)|\(copia\)|\(\d+\)|\bcopy\b|- ?(old|draft|copia|viejo|borrador|copy|bak|backup))\s*$/i;

function normalizeTitleFuzzy(title: string): string {
  let normalized = normalizeTitle(title);
  // Strip common copy/draft suffixes repeatedly
  let prev = '';
  while (prev !== normalized) {
    prev = normalized;
    normalized = normalized.replace(FUZZY_SUFFIXES, '').trim();
  }
  return normalized;
}

// ─── Duplicate grouping ─────────────────────────────────────────────────────

interface DedupEntry {
  page: Page;
  title: string;
  blockCount?: number;
}

interface DedupGroup {
  normalizedTitle: string;
  displayTitle: string;
  entries: DedupEntry[];
}

function groupByTitle(pages: Page[], fuzzy: boolean): DedupGroup[] {
  const groups = new Map<string, DedupGroup>();

  for (const page of pages) {
    const title = getPageTitle(page);
    const key = fuzzy ? normalizeTitleFuzzy(title) : normalizeTitle(title);

    if (!key || key === 'untitled') continue;

    if (!groups.has(key)) {
      groups.set(key, { normalizedTitle: key, displayTitle: title, entries: [] });
    }
    groups.get(key)!.entries.push({ page, title });
  }

  // Only return groups with duplicates, sorted by group size descending
  return Array.from(groups.values())
    .filter(g => g.entries.length > 1)
    .sort((a, b) => b.entries.length - a.entries.length);
}

// ─── Strategy: pick which page to keep ──────────────────────────────────────

type DedupStrategy = 'keep-largest' | 'keep-newest' | 'keep-oldest';

function pickKeeper(entries: DedupEntry[], strategy: DedupStrategy): DedupEntry {
  switch (strategy) {
    case 'keep-newest':
      return entries.reduce((best, e) =>
        new Date(e.page.last_edited_time) > new Date(best.page.last_edited_time) ? e : best
      );
    case 'keep-oldest':
      return entries.reduce((best, e) =>
        new Date(e.page.created_time) < new Date(best.page.created_time) ? e : best
      );
    case 'keep-largest':
    default:
      // Prefer page with most blocks, then most recent edit
      return entries.reduce((best, e) => {
        if ((e.blockCount ?? 0) > (best.blockCount ?? 0)) return e;
        if ((e.blockCount ?? 0) === (best.blockCount ?? 0) &&
            new Date(e.page.last_edited_time) > new Date(best.page.last_edited_time)) return e;
        return best;
      });
  }
}

// ─── Command registration ───────────────────────────────────────────────────

export function registerDedupCommand(program: Command): void {
  program
    .command('dedup <database_id>')
    .description('Find and clean duplicate pages in a database')
    .option('--fuzzy', 'Include near-duplicates (strips copy/draft suffixes)')
    .option('--fix', 'Archive duplicates (dry-run by default, use --yes to execute)')
    .option('--strategy <strategy>', 'Which page to keep: keep-largest, keep-newest, keep-oldest', 'keep-largest')
    .option('--yes', 'Execute archival without confirmation')
    .option('-l, --limit <number>', 'Max pages to scan')
    .option('--llm', 'Compact LLM-friendly output')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();

      // Fetch all pages
      const pages = await queryAllPages(client, databaseId, {
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        onProgress: (n) => process.stdout.write(`\rScanning: ${n} pages...`),
      });
      if (pages.length > 0) process.stdout.write('\r');

      // Group by title
      const groups = groupByTitle(pages, !!options.fuzzy);

      if (groups.length === 0) {
        console.log('No duplicates found.');
        return;
      }

      const totalDuplicates = groups.reduce((sum, g) => sum + g.entries.length - 1, 0);

      // For keep-largest strategy, fetch block counts for duplicate group members
      if (options.strategy === 'keep-largest') {
        for (const group of groups) {
          for (const entry of group.entries) {
            try {
              const children = await client.get(`blocks/${entry.page.id}/children`, { page_size: 100 }) as { results: unknown[] };
              entry.blockCount = children.results.length;
            } catch {
              entry.blockCount = 0;
            }
          }
        }
      }

      // Pre-compute keeper for each group (avoids redundant calls across output modes)
      const strategy = options.strategy as DedupStrategy;
      const keepers = new Map<DedupGroup, DedupEntry>();
      for (const group of groups) {
        keepers.set(group, pickKeeper(group.entries, strategy));
      }

      // JSON output
      if (options.json) {
        const output = groups.map(g => ({
          title: g.displayTitle,
          count: g.entries.length,
          pages: g.entries.map(e => ({
            id: e.page.id,
            title: e.title,
            created: e.page.created_time,
            edited: e.page.last_edited_time,
            blocks: e.blockCount,
          })),
        }));
        console.log(formatOutput(output));
        return;
      }

      // LLM output
      if (options.llm) {
        console.log(`${groups.length} duplicate groups, ${totalDuplicates} duplicates:\n`);
        for (const group of groups) {
          const keeper = keepers.get(group)!;
          for (const entry of group.entries) {
            const mark = entry === keeper ? 'KEEP' : 'DUP';
            console.log(`[${mark}] ${entry.page.id} ${entry.title}`);
          }
        }
        return;
      }

      // Standard output
      console.log(`Found ${totalDuplicates} duplicate(s) in ${groups.length} group(s):\n`);

      for (const group of groups) {
        const keeper = keepers.get(group)!;
        console.log(`"${group.displayTitle}" (${group.entries.length} copies)`);

        for (const entry of group.entries) {
          const created = entry.page.created_time.split('T')[0];
          const edited = entry.page.last_edited_time.split('T')[0];
          const blocks = entry.blockCount !== undefined ? `  ${entry.blockCount} blocks` : '';
          const mark = entry === keeper ? '  (keep)' : '';
          console.log(`  ${entry.page.id}  created ${created}  edited ${edited}${blocks}${mark}`);
        }
        console.log('');
      }

      // Fix mode
      if (options.fix) {
        const toArchive: Page[] = [];
        for (const group of groups) {
          const keeper = keepers.get(group)!;
          for (const entry of group.entries) {
            if (entry !== keeper) toArchive.push(entry.page);
          }
        }

        if (!options.yes) {
          console.log(`Would archive ${toArchive.length} page(s). Use --yes to execute.`);
          return;
        }

        // Execute archival
        let archived = 0;
        let failed = 0;
        for (const page of toArchive) {
          try {
            await client.patch(`pages/${page.id}`, buildTrashPayload(true));
            archived++;
            process.stdout.write(`\r🗑️ Archived ${archived}/${toArchive.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed to archive ${page.id}: ${(error as Error).message}`);
          }
        }
        console.log(`\n\n✅ Archived ${archived} duplicate(s)${failed > 0 ? `, ${failed} failed` : ''}`);
      }
    }));
}
