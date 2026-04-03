/**
 * Databases commands - get, create, update, query databases
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput, formatDatabaseTitle, parseFilter } from '../utils/format.js';
import { getDatabaseSchema, queryDatabase, updateDatabase } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { getPageTitle } from '../utils/notion-helpers.js';
import type { Database, PaginatedResponse, Page } from '../types/notion.js';

export function registerDatabasesCommand(program: Command): void {
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
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();
      const db = await getDatabaseSchema(client, databaseId) as Database & Record<string, unknown>;

      if (options.json) {
        console.log(formatOutput(db));
      } else {
        console.log('Database:', formatDatabaseTitle(db));
        console.log('ID:', db.id);
        console.log('\nProperties:');
        for (const [name, prop] of Object.entries(db.properties)) {
          console.log(`  - ${name}: ${prop.type}`);
        }
      }
    }));

  // Query database
  databases
    .command('query <database_id>')
    .description('Query a database')
    .option('-f, --filter <json>', 'Filter as JSON string (repeatable)', (v: string, a: string[]) => [...a, v], [] as string[])
    .option('--filter-prop <property>', 'Property to filter on (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-type <type>', 'Filter type: equals, contains, etc. (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-value <value>', 'Filter value (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('--filter-prop-type <propType>', 'Property type: select, status, text, number, date, checkbox (repeatable)', (v, a: string[]) => [...a, v], [] as string[])
    .option('-s, --sort <property>', 'Sort by property')
    .option('--sort-dir <direction>', 'Sort direction: asc, desc', 'desc')
    .option('--title <value>', 'Filter by exact title (auto-detects title property)')
    .option('-l, --limit <number>', 'Max results', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--llm', 'Compact LLM-friendly output')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};

      // Handle --title shortcut (auto-detects title property from schema)
      if (options.title) {
        const db = await getDatabaseSchema(client, databaseId);
        const titlePropName = Object.entries(db.properties)
          .find(([, p]) => p.type === 'title')?.[0] || 'Name';
        body.filter = {
          property: titlePropName,
          title: { equals: options.title },
        };
      }

      // Handle filter
      if (!body.filter && options.filter && options.filter.length > 0) {
        const filters = options.filter.map((f: string) => JSON.parse(f));
        body.filter = filters.length > 1 ? { and: filters } : filters[0];
      } else if (!body.filter && options.filterProp.length > 0) {
        const props: string[] = options.filterProp;
        const types: string[] = options.filterType;
        const values: string[] = options.filterValue;
        const propTypes: string[] = options.filterPropType;

        if (props.length !== types.length || props.length !== values.length) {
          console.error('Error: --filter-prop, --filter-type, and --filter-value must be provided the same number of times');
          process.exit(1);
        }

        if (propTypes.length !== 0 && propTypes.length !== props.length) {
          console.error('Error: --filter-prop-type must be provided either for all filter groups or for none');
          process.exit(1);
        }

        const filters = props.map((prop, i) =>
          parseFilter(prop, types[i], values[i], propTypes[i])
        );

        body.filter = filters.length > 1 ? { and: filters } : filters[0];
      }

      // Handle sort
      if (options.sort) {
        body.sorts = [{
          property: options.sort,
          direction: options.sortDir === 'asc' ? 'ascending' : 'descending',
        }];
      }

      if (options.limit) body.page_size = parseInt(options.limit, 10);
      if (options.cursor) body.start_cursor = options.cursor;

      const result = await queryDatabase<PaginatedResponse<{ id: string; properties: Record<string, unknown> }>>(client, databaseId, body);

      if (options.json) {
        console.log(formatOutput(result));
        return;
      }

      // --llm: compact output
      if (options.llm) {
        for (const item of result.results) {
          const title = getItemTitle(item);
          console.log(`${item.id} ${title}`);
        }
        if (result.has_more) {
          console.log(`(more results, cursor: ${result.next_cursor})`);
        }
        return;
      }

      console.log(`Found ${result.results.length} items:\n`);

      for (const item of result.results) {
        const title = getItemTitle(item);
        console.log(`📄 ${title}`);
        console.log(`   ID: ${item.id}`);
      }

      if (result.has_more) {
        console.log(`\nMore results available. Use --cursor ${result.next_cursor}`);
      }
    }));

  // Create database
  databases
    .command('create')
    .description('Create a new database')
    .requiredOption('--parent <page_id>', 'Parent page ID')
    .requiredOption('-t, --title <title>', 'Database title')
    .option('--inline', 'Create as inline database')
    .option('-p, --property <name:type...>', 'Add property (e.g., Status:select, Date:date)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const properties: Record<string, { type?: string; title?: object; [key: string]: unknown }> = {
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

      const body: Record<string, unknown> = {
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
      } else {
        console.log('✅ Database created');
        console.log('ID:', (db as { id: string }).id);
        console.log('URL:', (db as { url: string }).url);
      }
    }));

  // Update database
  databases
    .command('update <database_id>')
    .description('Update database properties')
    .option('-t, --title <title>', 'New title')
    .option('--add-prop <name:type>', 'Add a property')
    .option('--remove-prop <name>', 'Remove a property')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (databaseId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};

      if (options.title) {
        body.title = [{ type: 'text', text: { content: options.title } }];
      }

      const properties: Record<string, unknown> = {};

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

      const db = await updateDatabase(client, databaseId, body);

      if (options.json) {
        console.log(formatOutput(db));
      } else {
        console.log('✅ Database updated');
      }
    }));
}

function getItemTitle(item: { properties: Record<string, unknown> }): string {
  for (const prop of Object.values(item.properties)) {
    const typedProp = prop as { type: string; title?: Array<{ plain_text: string }> };
    if (typedProp.type === 'title' && typedProp.title) {
      return typedProp.title.map(t => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}
