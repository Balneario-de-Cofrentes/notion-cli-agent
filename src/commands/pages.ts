/**
 * Pages commands - get, create, update, archive, read, write, edit pages
 */
import { Command } from 'commander';
import * as fs from 'fs';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, parseProperties } from '../utils/format.js';
import { markdownToBlocks } from '../utils/markdown.js';
import { blocksToMarkdownAsync, fetchAllBlocks, getPageTitle } from '../utils/notion-helpers.js';
import type { Page } from '../types/notion.js';

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

  // Read page content as Markdown
  pages
    .command('read <page_id>')
    .description('Read page content as Markdown (outputs to stdout)')
    .option('-j, --json', 'Output raw JSON blocks instead of Markdown')
    .option('--no-title', 'Omit the page title heading')
    .option('-o, --output <path>', 'Write to file instead of stdout')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();

        if (options.json) {
          // Raw JSON mode — return all blocks
          const blocks = await fetchAllBlocks(client, pageId);
          const output = formatOutput(blocks);
          if (options.output) {
            fs.writeFileSync(options.output, output);
            console.error(`Written to ${options.output}`);
          } else {
            console.log(output);
          }
          return;
        }

        let output = '';

        // Include title by default
        if (options.title !== false) {
          const page = await client.get(`pages/${pageId}`) as Page;
          const title = getPageTitle(page);
          output += `# ${title}\n\n`;
        }

        // Convert blocks to markdown
        const content = await blocksToMarkdownAsync(client, pageId);
        output += content;

        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.error(`Written to ${options.output}`);
        } else {
          process.stdout.write(output);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Write Markdown content to a page
  pages
    .command('write <page_id>')
    .description('Write Markdown content to a page (from file or stdin)')
    .option('-f, --file <path>', 'Read Markdown from file')
    .option('--replace', 'Replace existing content (deletes all blocks first). Default is append')
    .option('--dry-run', 'Show what would be written without making changes')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();

        // Read markdown from file or stdin
        let markdown: string;
        if (options.file) {
          if (!fs.existsSync(options.file)) {
            console.error(`Error: File not found: ${options.file}`);
            process.exit(1);
          }
          markdown = fs.readFileSync(options.file, 'utf-8');
        } else {
          // Read from stdin
          markdown = await readStdin();
        }

        if (!markdown.trim()) {
          console.error('Error: No content provided. Use --file or pipe content via stdin.');
          process.exit(1);
        }

        // Convert to blocks
        const blocks = markdownToBlocks(markdown);

        if (options.dryRun) {
          console.log(`Parsed ${blocks.length} blocks:`);
          blocks.slice(0, 15).forEach((block, i) => {
            console.log(`  ${i + 1}. ${block.type}`);
          });
          if (blocks.length > 15) {
            console.log(`  ... and ${blocks.length - 15} more`);
          }
          console.log('\nDry run - no changes made');
          return;
        }

        // Delete existing blocks if --replace
        if (options.replace) {
          const existing = await fetchAllBlocks(client, pageId);
          for (const block of existing) {
            await client.delete(`blocks/${block.id}`);
          }
          if (existing.length > 0) {
            console.error(`Removed ${existing.length} existing blocks`);
          }
        }

        // Append blocks in chunks of 100 (Notion API limit)
        let added = 0;
        for (let i = 0; i < blocks.length; i += 100) {
          const chunk = blocks.slice(i, i + 100);
          await client.patch(`blocks/${pageId}/children`, {
            children: chunk,
          });
          added += chunk.length;
        }

        console.error(`Written ${added} blocks to page`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Surgical page editing
  pages
    .command('edit <page_id>')
    .description('Surgical block-level editing: delete, insert, or replace blocks at a position')
    .option('--after <block_id>', 'Position: insert after this block ID')
    .option('--at <index>', 'Position: operate at this block index (0-based)')
    .option('--delete <count>', 'Delete <count> blocks starting at position', parseInt)
    .option('-f, --file <path>', 'Read replacement Markdown from file')
    .option('-m, --markdown <text>', 'Replacement Markdown text (inline)')
    .option('--dry-run', 'Show what would change without making changes')
    .option('-j, --json', 'Output raw JSON')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();

        // Fetch all current blocks
        const allBlocks = await fetchAllBlocks(client, pageId);

        // Resolve position
        let afterBlockId: string | undefined;
        let deleteStartIndex: number;

        if (options.after) {
          // Find the block index for --after
          const idx = allBlocks.findIndex(b => b.id === options.after || b.id.replace(/-/g, '') === options.after.replace(/-/g, ''));
          if (idx === -1) {
            console.error(`Error: Block not found: ${options.after}`);
            console.error(`Available blocks (${allBlocks.length}):`);
            allBlocks.slice(0, 10).forEach((b, i) => {
              console.error(`  ${i}: ${b.id} (${b.type})`);
            });
            process.exit(1);
          }
          afterBlockId = allBlocks[idx].id;
          deleteStartIndex = idx + 1;
        } else if (options.at !== undefined) {
          const atIndex = parseInt(options.at, 10);
          if (atIndex < 0 || atIndex > allBlocks.length) {
            console.error(`Error: Index ${atIndex} out of range (0-${allBlocks.length})`);
            process.exit(1);
          }
          if (atIndex > 0) {
            afterBlockId = allBlocks[atIndex - 1].id;
          }
          deleteStartIndex = atIndex;
        } else {
          console.error('Error: Specify a position with --after <block_id> or --at <index>');
          process.exit(1);
          return;
        }

        // Determine blocks to delete
        const deleteCount = options.delete || 0;
        const blocksToDelete = allBlocks.slice(deleteStartIndex, deleteStartIndex + deleteCount);

        // Parse replacement content
        let newBlocks: { object: string; type: string; [key: string]: unknown }[] = [];
        if (options.file) {
          if (!fs.existsSync(options.file)) {
            console.error(`Error: File not found: ${options.file}`);
            process.exit(1);
          }
          const md = fs.readFileSync(options.file, 'utf-8');
          newBlocks = markdownToBlocks(md);
        } else if (options.markdown) {
          newBlocks = markdownToBlocks(options.markdown);
        }

        // Dry run
        if (options.dryRun) {
          console.log('Edit plan:');
          if (blocksToDelete.length > 0) {
            console.log(`  Delete ${blocksToDelete.length} block(s):`);
            blocksToDelete.forEach((b, i) => {
              console.log(`    ${deleteStartIndex + i}: ${b.id} (${b.type})`);
            });
          }
          if (newBlocks.length > 0) {
            console.log(`  Insert ${newBlocks.length} block(s)${afterBlockId ? ` after ${afterBlockId}` : ' at start'}:`);
            newBlocks.slice(0, 10).forEach((b, i) => {
              console.log(`    ${i}: ${b.type}`);
            });
            if (newBlocks.length > 10) {
              console.log(`    ... and ${newBlocks.length - 10} more`);
            }
          }
          if (blocksToDelete.length === 0 && newBlocks.length === 0) {
            console.log('  No changes to make');
          }
          console.log('\nDry run - no changes made');
          return;
        }

        // Nothing to do — warn and exit
        if (blocksToDelete.length === 0 && newBlocks.length === 0) {
          console.error('Warning: nothing to do — specify --delete and/or --file/--markdown');
          return;
        }

        // Execute: delete blocks
        for (const block of blocksToDelete) {
          await client.delete(`blocks/${block.id}`);
        }

        // Execute: insert new blocks
        if (newBlocks.length > 0) {
          // Insert in chunks of 100
          for (let i = 0; i < newBlocks.length; i += 100) {
            const chunk = newBlocks.slice(i, i + 100);
            const body: Record<string, unknown> = { children: chunk };
            if (afterBlockId) {
              body.after = afterBlockId;
            }
            const result = await client.patch(`blocks/${pageId}/children`, body) as {
              results: { id: string }[];
            };
            // Update afterBlockId to the last inserted block for the next chunk
            if (result.results && result.results.length > 0) {
              afterBlockId = result.results[result.results.length - 1].id;
            }
          }
        }

        const summary = [];
        if (blocksToDelete.length > 0) summary.push(`deleted ${blocksToDelete.length}`);
        if (newBlocks.length > 0) summary.push(`inserted ${newBlocks.length}`);

        if (options.json) {
          console.log(formatOutput({
            deleted: blocksToDelete.length,
            inserted: newBlocks.length,
            deleted_ids: blocksToDelete.map(b => b.id),
          }));
        } else {
          console.log(`Done: ${summary.join(', ')} block(s)`);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read all data from stdin. Returns empty string if stdin is a TTY (no pipe).
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    // If stdin is a TTY (no pipe), return empty immediately
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
