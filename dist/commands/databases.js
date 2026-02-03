import { getClient } from '../client.js';
import { formatOutput, formatDatabaseTitle, parseFilter } from '../utils/format.js';
export function registerDatabasesCommand(program) {
    const databases = program
        .command('database')
        .alias('databases')
        .alias('db')
        .description('Manage Notion databases');
    // Get database
    databases
        .command('get <database_id>')
        .description('Retrieve a database by ID')
        .option('-j, --json', 'Output raw JSON')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            const db = await client.get(`databases/${databaseId}`);
            if (options.json) {
                console.log(formatOutput(db));
            }
            else {
                console.log('Database:', formatDatabaseTitle(db));
                console.log('ID:', db.id);
                console.log('\nProperties:');
                const props = db.properties;
                for (const [name, prop] of Object.entries(props)) {
                    console.log(`  - ${name}: ${prop.type}`);
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Query database
    databases
        .command('query <database_id>')
        .description('Query a database')
        .option('-f, --filter <json>', 'Filter as JSON string')
        .option('--filter-prop <property>', 'Property to filter on')
        .option('--filter-type <type>', 'Filter type: equals, contains, etc.')
        .option('--filter-value <value>', 'Filter value')
        .option('-s, --sort <property>', 'Sort by property')
        .option('--sort-dir <direction>', 'Sort direction: asc, desc', 'desc')
        .option('-l, --limit <number>', 'Max results', '100')
        .option('--cursor <cursor>', 'Pagination cursor')
        .option('-j, --json', 'Output raw JSON')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            const body = {};
            // Handle filter
            if (options.filter) {
                body.filter = JSON.parse(options.filter);
            }
            else if (options.filterProp && options.filterType && options.filterValue) {
                body.filter = parseFilter(options.filterProp, options.filterType, options.filterValue);
            }
            // Handle sort
            if (options.sort) {
                body.sorts = [{
                        property: options.sort,
                        direction: options.sortDir === 'asc' ? 'ascending' : 'descending',
                    }];
            }
            if (options.limit)
                body.page_size = parseInt(options.limit, 10);
            if (options.cursor)
                body.start_cursor = options.cursor;
            const result = await client.post(`databases/${databaseId}/query`, body);
            if (options.json) {
                console.log(formatOutput(result));
                return;
            }
            const typedResult = result;
            console.log(`Found ${typedResult.results.length} items:\n`);
            for (const item of typedResult.results) {
                const title = getItemTitle(item);
                console.log(`📄 ${title}`);
                console.log(`   ID: ${item.id}`);
            }
            if (typedResult.has_more) {
                console.log(`\nMore results available. Use --cursor ${typedResult.next_cursor}`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Create database
    databases
        .command('create')
        .description('Create a new database')
        .requiredOption('--parent <page_id>', 'Parent page ID')
        .requiredOption('-t, --title <title>', 'Database title')
        .option('--inline', 'Create as inline database')
        .option('-p, --property <name:type...>', 'Add property (e.g., Status:select, Date:date)')
        .option('-j, --json', 'Output raw JSON')
        .action(async (options) => {
        try {
            const client = getClient();
            const properties = {
                Name: { title: {} }, // Default title property
            };
            // Parse additional properties
            if (options.property) {
                for (const prop of options.property) {
                    const [name, type] = prop.split(':');
                    if (name && type) {
                        properties[name] = { [type]: {} };
                    }
                }
            }
            const body = {
                parent: { page_id: options.parent },
                title: [{ type: 'text', text: { content: options.title } }],
                properties,
            };
            if (options.inline) {
                body.is_inline = true;
            }
            const db = await client.post('databases', body);
            if (options.json) {
                console.log(formatOutput(db));
            }
            else {
                console.log('✅ Database created');
                console.log('ID:', db.id);
                console.log('URL:', db.url);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Update database
    databases
        .command('update <database_id>')
        .description('Update database properties')
        .option('-t, --title <title>', 'New title')
        .option('--add-prop <name:type>', 'Add a property')
        .option('--remove-prop <name>', 'Remove a property')
        .option('-j, --json', 'Output raw JSON')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            const body = {};
            if (options.title) {
                body.title = [{ type: 'text', text: { content: options.title } }];
            }
            const properties = {};
            if (options.addProp) {
                const [name, type] = options.addProp.split(':');
                if (name && type) {
                    properties[name] = { [type]: {} };
                }
            }
            if (options.removeProp) {
                properties[options.removeProp] = null;
            }
            if (Object.keys(properties).length > 0) {
                body.properties = properties;
            }
            const db = await client.patch(`databases/${databaseId}`, body);
            if (options.json) {
                console.log(formatOutput(db));
            }
            else {
                console.log('✅ Database updated');
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
function getItemTitle(item) {
    for (const prop of Object.values(item.properties)) {
        const typedProp = prop;
        if (typedProp.type === 'title' && typedProp.title) {
            return typedProp.title.map(t => t.plain_text).join('') || 'Untitled';
        }
    }
    return 'Untitled';
}
//# sourceMappingURL=databases.js.map