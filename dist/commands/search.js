import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, formatDatabaseTitle } from '../utils/format.js';
export function registerSearchCommand(program) {
    program
        .command('search [query]')
        .description('Search pages and databases')
        .option('-t, --type <type>', 'Filter by type: page, database', '')
        .option('-s, --sort <direction>', 'Sort by last_edited_time: asc, desc', '')
        .option('-l, --limit <number>', 'Max results to return', '10')
        .option('--cursor <cursor>', 'Pagination cursor for next page')
        .option('-j, --json', 'Output raw JSON')
        .action(async (query, options) => {
        try {
            const client = getClient();
            const body = {};
            if (query)
                body.query = query;
            if (options.type)
                body.filter = { property: 'object', value: options.type };
            if (options.sort) {
                body.sort = {
                    direction: options.sort,
                    timestamp: 'last_edited_time',
                };
            }
            if (options.limit)
                body.page_size = parseInt(options.limit, 10);
            if (options.cursor)
                body.start_cursor = options.cursor;
            const result = await client.post('search', body);
            if (options.json) {
                console.log(formatOutput(result));
                return;
            }
            // Pretty print results
            if (result.results.length === 0) {
                console.log('No results found.');
                return;
            }
            for (const item of result.results) {
                const icon = item.object === 'page' ? '📄' : '🗄️';
                const title = item.object === 'page'
                    ? formatPageTitle(item)
                    : formatDatabaseTitle(item);
                console.log(`${icon} ${title}`);
                console.log(`   ID: ${item.id}`);
                if (item.url)
                    console.log(`   URL: ${item.url}`);
                console.log('');
            }
            if (result.has_more) {
                console.log(`More results available. Use --cursor ${result.next_cursor}`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=search.js.map