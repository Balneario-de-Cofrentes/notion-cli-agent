/**
 * Pages commands - get, create, update, archive pages
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, parseProperties } from '../utils/format.js';

export function registerPagesCommand(program: Command): void {
  const pages = program
    .command('page')
    .alias('pages')
    .alias('p')
    .description('Manage Notion pages');

  // Get page
  pages
    .command('get <page_id>')
    .description('Retrieve a page by ID')
    .option('-j, --json', 'Output raw JSON')
    .option('--content', 'Also fetch page content (blocks)')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();
        const page = await client.get(`pages/${pageId}`);

        if (options.content) {
          const blocks = await client.get(`blocks/${pageId}/children`);
          if (options.json) {
            console.log(formatOutput({ page, blocks }));
          } else {
            console.log('Page:', formatPageTitle(page));
            console.log('ID:', (page as { id: string }).id);
            console.log('\nContent:');
            console.log(formatOutput(blocks));
          }
        } else {
          console.log(options.json ? formatOutput(page) : formatPageTitle(page));
          if (!options.json) {
            console.log('ID:', (page as { id: string }).id);
            console.log('\nProperties:');
            console.log(formatOutput((page as { properties: unknown }).properties));
          }
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Create page
  pages
    .command('create')
    .description('Create a new page')
    .requiredOption('--parent <id>', 'Parent page ID or database ID')
    .option('--parent-type <type>', 'Parent type: page, database', 'database')
    .option('-t, --title <title>', 'Page title')
    .option('--title-prop <name>', 'Name of title property (auto-detected if not set)')
    .option('-p, --prop <key=value...>', 'Set property (can be used multiple times)')
    .option('-c, --content <text>', 'Initial page content (paragraph)')
    .option('-j, --json', 'Output raw JSON')
    .action(async (options) => {
      try {
        const client = getClient();

        const parent = options.parentType === 'page'
          ? { page_id: options.parent }
          : { database_id: options.parent };

        const properties: Record<string, unknown> = {};
        
        // Handle title - auto-detect title property name from database schema
        if (options.title) {
          let titlePropName = options.titleProp;
          
          // If not specified and parent is database, fetch schema to find title property
          if (!titlePropName && options.parentType === 'database') {
            try {
              const db = await client.get(`databases/${options.parent}`) as {
                properties: Record<string, { type: string }>;
              };
              // Find the property with type "title"
              for (const [name, prop] of Object.entries(db.properties)) {
                if (prop.type === 'title') {
                  titlePropName = name;
                  break;
                }
              }
            } catch {
              // Fall back to common defaults
            }
          }
          
          // Use detected name or fall back to common names
          titlePropName = titlePropName || 'Name';
          properties[titlePropName] = {
            title: [{ text: { content: options.title } }],
          };
        }

        // Handle additional properties
        if (options.prop) {
          const parsed = parseProperties(options.prop);
          Object.assign(properties, parsed);
        }

        const body: Record<string, unknown> = { parent, properties };

        // Add initial content if provided
        if (options.content) {
          body.children = [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: options.content } }],
            },
          }];
        }

        const page = await client.post('pages', body);

        if (options.json) {
          console.log(formatOutput(page));
        } else {
          console.log('✅ Page created');
          console.log('ID:', (page as { id: string }).id);
          console.log('URL:', (page as { url: string }).url);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Update page
  pages
    .command('update <page_id>')
    .description('Update page properties')
    .option('-p, --prop <key=value...>', 'Set property (can be used multiple times)')
    .option('--archive', 'Archive the page')
    .option('--unarchive', 'Unarchive the page')
    .option('-j, --json', 'Output raw JSON')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();

        const body: Record<string, unknown> = {};

        if (options.prop) {
          body.properties = parseProperties(options.prop);
        }

        if (options.archive) {
          body.archived = true;
        } else if (options.unarchive) {
          body.archived = false;
        }

        const page = await client.patch(`pages/${pageId}`, body);

        if (options.json) {
          console.log(formatOutput(page));
        } else {
          console.log('✅ Page updated');
          console.log('ID:', (page as { id: string }).id);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Archive page (convenience)
  pages
    .command('archive <page_id>')
    .description('Archive a page')
    .action(async (pageId: string) => {
      try {
        const client = getClient();
        await client.patch(`pages/${pageId}`, { archived: true });
        console.log('✅ Page archived');
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Get page property
  pages
    .command('property <page_id> <property_id>')
    .description('Get a specific page property (for paginated properties like rollups)')
    .option('-j, --json', 'Output raw JSON')
    .action(async (pageId: string, propertyId: string, options) => {
      try {
        const client = getClient();
        const property = await client.get(`pages/${pageId}/properties/${propertyId}`);
        console.log(options.json ? formatOutput(property) : property);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
