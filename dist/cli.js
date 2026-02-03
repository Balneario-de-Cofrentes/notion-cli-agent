#!/usr/bin/env node
/**
 * Notion CLI - Full-featured command line interface for Notion API
 *
 * Usage:
 *   notion search "my query"
 *   notion page get <page_id>
 *   notion page create --parent <db_id> --title "New Page"
 *   notion db query <db_id> --filter-prop Status --filter-type equals --filter-value Done
 *   notion block append <page_id> --text "Hello world"
 *   notion comment create --page <page_id> --text "Great work!"
 *   notion user me
 */
import { Command } from 'commander';
import { initClient } from './client.js';
import { registerSearchCommand } from './commands/search.js';
import { registerPagesCommand } from './commands/pages.js';
import { registerDatabasesCommand } from './commands/databases.js';
import { registerBlocksCommand } from './commands/blocks.js';
import { registerCommentsCommand } from './commands/comments.js';
import { registerUsersCommand } from './commands/users.js';
const program = new Command();
program
    .name('notion')
    .description('Full-featured CLI for Notion API')
    .version('0.1.0')
    .option('--token <token>', 'Notion API token (or set NOTION_TOKEN env var)')
    .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    try {
        initClient(opts.token);
    }
    catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
});
// Register all commands
registerSearchCommand(program);
registerPagesCommand(program);
registerDatabasesCommand(program);
registerBlocksCommand(program);
registerCommentsCommand(program);
registerUsersCommand(program);
// Raw API command for advanced users
program
    .command('api <method> <path>')
    .description('Make a raw API request')
    .option('-d, --data <json>', 'Request body as JSON')
    .option('-q, --query <params>', 'Query parameters as key=value,key=value')
    .action(async (method, path, options) => {
    try {
        const { getClient } = await import('./client.js');
        const client = getClient();
        let body;
        if (options.data) {
            body = JSON.parse(options.data);
        }
        let query;
        if (options.query) {
            query = {};
            for (const pair of options.query.split(',')) {
                const [key, value] = pair.split('=');
                if (key && value)
                    query[key] = value;
            }
        }
        const result = await client.request(path, {
            method: method.toUpperCase(),
            body,
            query,
        });
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
});
// Parse and execute
program.parse();
//# sourceMappingURL=cli.js.map