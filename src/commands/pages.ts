/**
 * Pages commands - get, create, update, archive, read, write, edit pages
 */
import { Command } from 'commander';
import * as fs from 'fs';
import { getClient } from '../client.js';
import { formatOutput, formatPageTitle, parseProperties } from '../utils/format.js';
import { markdownToBlocks } from '../utils/markdown.js';
import { blocksToMarkdownAsync, fetchAllBlocks, getPageTitle, isParentDatabase, getParentDatabaseId, resolvePropertyName, buildClearPayload, buildTrashPayload, buildBlockPosition } from '../utils/notion-helpers.js';
import { getDatabaseSchema } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
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
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();
      const page = await client.get(`pages/${pageId}`);

      if (options.content) {
        const blocks = await fetchAllBlocks(client, pageId);
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
    }));

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
    .option('--icon <emoji>', 'Set page icon (emoji character, e.g. 📝)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const parent = options.parentType === 'page'
          ? { page_id: options.parent }
          : { database_id: options.parent };

        const properties: Record<string, unknown> = {};

        // Fetch database schema once if parent is a database and we need it
        // (for title auto-detection or property type resolution)
        let db: { properties: Record<string, { type: string }> } | null = null;
        const needsSchema = options.parentType === 'database' && (
          (options.title && !options.titleProp) || options.prop
        );
        if (needsSchema) {
          try {
            db = await getDatabaseSchema(client, options.parent) as {
              properties: Record<string, { type: string }>;
            };
          } catch {
            // Fall back to heuristic parsing / common defaults
          }
        }

        // Handle title - auto-detect title property name from database schema
        if (options.title) {
          let titlePropName = options.titleProp;

          // If not specified and parent is database, use schema to find title property
          if (!titlePropName && db) {
            for (const [name, prop] of Object.entries(db.properties)) {
              if (prop.type === 'title') {
                titlePropName = name;
                break;
              }
            }
          }

          // Use detected name or fall back based on parent type
          // Non-DB pages (page/workspace parent) use 'title'; DB pages default to 'Name'
          titlePropName = titlePropName || (options.parentType === 'page' ? 'title' : 'Name');
          properties[titlePropName] = {
            title: [{ text: { content: options.title } }],
          };
        }

        // Handle additional properties
        if (options.prop) {
          // Build a property-name → type map from the database schema
          const schemaTypes: Record<string, string> | undefined = db
            ? Object.fromEntries(
                Object.entries(db.properties).map(([name, prop]) => [name, prop.type])
              )
            : undefined;
          const parsed = parseProperties(options.prop, schemaTypes);
          Object.assign(properties, parsed);
        }

        const body: Record<string, unknown> = { parent, properties };

        if (options.icon) {
          body.icon = { type: 'emoji', emoji: options.icon };
        }

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
    }));

  // Update page
  pages
    .command('update <page_id>')
    .description('Update page properties')
    .option('-t, --title <title>', 'Rename the page title')
    .option('--title-prop <name>', 'Name of title property (auto-detected if not set)')
    .option('-p, --prop <key=value...>', 'Set property (can be used multiple times)')
    .option('--clear-prop <name...>', 'Clear a property (type-aware, e.g., --clear-prop "Assignee")')
    .option('--archive', 'Archive the page')
    .option('--unarchive', 'Unarchive the page')
    .option('--icon <emoji>', 'Set page icon (emoji character, e.g. 📝)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, options) => {
      const client = getClient();

      const body: Record<string, unknown> = {};
      const properties: Record<string, unknown> = {};

      if (options.title) {
        let titlePropName = options.titleProp;

          // parentType: 'database' | 'page' | null (null = unknown, page fetch failed)
          let detectedParentType: 'database' | 'page' | null = null;
          if (!titlePropName) {
            try {
              const page = await client.get(`pages/${pageId}`) as Page;
              const parentDbId = getParentDatabaseId(page.parent);
              if (isParentDatabase(page.parent) && parentDbId) {
                detectedParentType = 'database';
                const db = await getDatabaseSchema(client, parentDbId) as {
                  properties: Record<string, { type: string }>;
                };
                for (const [name, prop] of Object.entries(db.properties)) {
                  if (prop.type === 'title') {
                    titlePropName = name;
                    break;
                  }
                }
              } else {
                detectedParentType = 'page';
              }
            } catch {
              // Fall back to common default
            }
          }

          // Non-DB pages use 'title'; DB pages default to 'Name'; unknown (fetch failed) → 'title'
          // Note: if fetch failed entirely we can't know parent type — 'title' is Notion's universal key
          titlePropName = titlePropName || (detectedParentType === 'database' ? 'Name' : 'title');
          properties[titlePropName] = {
            title: [{ text: { content: options.title } }],
          };
        }

        // Fetch schema if we need it for --prop or --clear-prop
        let db: { properties: Record<string, { type: string }> } | null = null;
        if (options.prop || (options.clearProp && options.clearProp.length > 0)) {
          try {
            const pg = await client.get(`pages/${pageId}`) as Page;
            const parentDbId = getParentDatabaseId(pg.parent);
            if (parentDbId) {
              db = await getDatabaseSchema(client, parentDbId) as {
                properties: Record<string, { type: string }>;
              };
            }
          } catch {
            // If we can't fetch schema, fall back to heuristic parsing
          }
        }

        if (options.prop) {
          // Build a property-name → type map from the database schema
          const schemaTypes: Record<string, string> | undefined = db
            ? Object.fromEntries(
                Object.entries(db.properties).map(([name, prop]) => [name, prop.type])
              )
            : undefined;
          const parsed = parseProperties(options.prop, schemaTypes);
          Object.assign(properties, parsed);
        }

        // Handle --clear-prop: fetch schema to determine property type
        if (options.clearProp && options.clearProp.length > 0) {
          if (!db) {
            console.error('Error: --clear-prop requires a database-backed page');
            process.exit(1);
          }
          for (const rawName of options.clearProp) {
            const resolved = resolvePropertyName(db.properties, rawName);
            if (!resolved) {
              console.error(`Error: Property "${rawName}" not found in database schema`);
              process.exit(1);
            }
            const propSchema = db.properties[resolved];
            properties[resolved] = buildClearPayload(propSchema.type);
          }
        }

        if (Object.keys(properties).length > 0) {
          body.properties = properties;
        }

        if (options.archive) {
          Object.assign(body, buildTrashPayload(true));
        } else if (options.unarchive) {
          Object.assign(body, buildTrashPayload(false));
        }

        if (options.icon) {
          body.icon = { type: 'emoji', emoji: options.icon };
        }

        const page = await client.patch(`pages/${pageId}`, body);

        if (options.json) {
          console.log(formatOutput(page));
        } else {
          console.log('✅ Page updated');
          console.log('ID:', (page as { id: string }).id);
        }
    }));

  // Archive page (convenience)
  pages
    .command('archive <page_id>')
    .description('Archive a page')
    .action(withErrorHandler(async (pageId: string) => {
      const client = getClient();
      await client.patch(`pages/${pageId}`, buildTrashPayload(true));
      console.log('✅ Page archived');
    }));

  // Get page property
  pages
    .command('property <page_id> <property_id>')
    .description('Get a specific page property (for paginated properties like rollups)')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, propertyId: string, options) => {
      const client = getClient();
      const property = await client.get(`pages/${pageId}/properties/${propertyId}`);
      console.log(options.json ? formatOutput(property) : property);
    }));

  // Read page content as Markdown
  pages
    .command('read <page_id>')
    .description('Read page content as Markdown (outputs to stdout)')
    .option('-j, --json', 'Output raw JSON blocks instead of Markdown')
    .option('--no-title', 'Omit the page title heading')
    .option('-o, --output <path>', 'Write to file instead of stdout')
    .action(withErrorHandler(async (pageId: string, options) => {
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
    }));

  // Write Markdown content to a page
  pages
    .command('write <page_id>')
    .description('Write Markdown content to a page (from file or stdin)')
    .option('-f, --file <path>', 'Read Markdown from file')
    .option('--replace', 'Replace existing content (deletes all blocks first). Default is append')
    .option('--dry-run', 'Show what would be written without making changes')
    .action(withErrorHandler(async (pageId: string, options) => {
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
          if (existing.length > 0) {
            console.error(
              `Warning: --replace will permanently delete ${existing.length} existing block(s). ` +
              `This operation is not atomic — if the subsequent write fails, deleted content cannot be recovered automatically.`
            );
            // Keep a reference for error recovery attempt
            const backup = existing.map(b => b.id);
            try {
              for (const block of existing) {
                await client.delete(`blocks/${block.id}`);
              }
              console.error(`Removed ${existing.length} existing blocks`);
            } catch (deleteError) {
              console.error(`Error during block deletion: ${(deleteError as Error).message}`);
              console.error(`Partial deletion may have occurred. Block IDs that were targeted:\n${backup.join('\n')}`);
              process.exit(1);
            }
          }
        }

        // Append blocks in chunks of 100 (Notion API limit)
        let added = 0;
        try {
          for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await client.patch(`blocks/${pageId}/children`, {
              children: chunk,
            });
            added += chunk.length;
          }
        } catch (writeError) {
          console.error(`Error writing blocks (written so far: ${added}/${blocks.length}): ${(writeError as Error).message}`);
          process.exit(1);
        }

        console.error(`Written ${added} blocks to page`);
    }));

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
    .action(withErrorHandler(async (pageId: string, options) => {
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

        // Execute: delete blocks (not atomic — partial failure leaves page in intermediate state)
        if (blocksToDelete.length > 0) {
          console.error(
            `Deleting ${blocksToDelete.length} block(s)... ` +
            `(note: not atomic — partial failure will leave the page in an intermediate state)`
          );
        }
        for (const block of blocksToDelete) {
          await client.delete(`blocks/${block.id}`);
        }

        // Execute: insert new blocks
        if (newBlocks.length > 0) {
          // Insert in chunks of 100
          for (let i = 0; i < newBlocks.length; i += 100) {
            const chunk = newBlocks.slice(i, i + 100);
            const body: Record<string, unknown> = {
              children: chunk,
              ...buildBlockPosition(afterBlockId),
            };
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
    }));
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
