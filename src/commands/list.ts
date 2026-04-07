/**
 * List command -- show cached databases from workspace.json
 *
 * No API calls. Reads the local workspace cache populated by `notion sync`.
 */
import { Command } from 'commander';
import { formatOutput } from '../utils/format.js';
import { listKnownDatabases, readWorkspace } from '../utils/workspace-resolver.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List cached databases (run "notion sync" first)')
    .option('-j, --json', 'Output as JSON')
    .option('--ids-only', 'Output only database IDs, one per line')
    .option('--names-only', 'Output only database names, one per line')
    .action((options) => {
      const state = readWorkspace();
      if (!state) {
        console.error('No workspace cache found. Run "notion sync" first.');
        process.exit(1);
      }

      const databases = listKnownDatabases(state);
      if (databases.length === 0) {
        console.error('Workspace cache is empty. Run "notion sync" to index your databases.');
        process.exit(1);
      }

      if (options.json) {
        console.log(formatOutput(databases));
        return;
      }

      if (options.idsOnly) {
        for (const db of databases) console.log(db.id);
        return;
      }

      if (options.namesOnly) {
        for (const db of databases) console.log(db.title);
        return;
      }

      // Human-readable table
      console.log(`Databases in workspace (${databases.length}):\n`);

      for (const db of databases) {
        const role = db.role ? db.role.padEnd(12) : ''.padEnd(12);
        const title = db.title.padEnd(30);
        const idShort = db.id.slice(0, 8) + '...';
        const tag = db.source === 'registry' ? '' : ` [${db.source}]`;
        console.log(`  ${role} ${title} ${idShort}${tag}`);
      }

      const syncedAt = state.syncedAt;
      if (syncedAt) {
        console.log(`\nLast synced: ${new Date(syncedAt).toLocaleString()}`);
      }
    });
}
