/**
 * Duplicate commands - clone pages and database structures
 */
import { Command } from 'commander';
import { getClient } from '../client.js';

interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface Page {
  id: string;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, unknown>;
  url?: string;
}

interface Database {
  id: string;
  title: { plain_text: string }[];
  properties: Record<string, PropertySchema>;
}

interface PropertySchema {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

// Clean block for duplication (remove IDs, etc.)
function cleanBlockForDuplication(block: Block): Record<string, unknown> {
  const { id, created_time, last_edited_time, created_by, last_edited_by, parent, has_children, ...rest } = block;
  
  // Clean rich_text arrays
  const blockType = rest.type as string;
  if (rest[blockType] && typeof rest[blockType] === 'object') {
    const content = { ...(rest[blockType] as Record<string, unknown>) };
    if (content.rich_text && Array.isArray(content.rich_text)) {
      content.rich_text = content.rich_text.map((rt: Record<string, unknown>) => {
        const { id, ...cleanRt } = rt;
        return cleanRt;
      });
    }
    rest[blockType] = content;
  }
  
  return { object: 'block', ...rest };
}

// Fetch all blocks from a page
async function fetchAllBlocks(
  client: ReturnType<typeof getClient>,
  blockId: string
): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  
  do {
    const params = cursor ? `?start_cursor=${cursor}` : '';
    const result = await client.get(`blocks/${blockId}/children${params}`) as {
      results: Block[];
      has_more: boolean;
      next_cursor?: string;
    };
    
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  
  return blocks;
}

// Recursively duplicate blocks (handles children)
async function duplicateBlocksRecursive(
  client: ReturnType<typeof getClient>,
  sourceBlocks: Block[],
  targetParentId: string
): Promise<number> {
  let count = 0;
  
  // Notion allows max 100 blocks per request
  const chunks: Block[][] = [];
  for (let i = 0; i < sourceBlocks.length; i += 100) {
    chunks.push(sourceBlocks.slice(i, i + 100));
  }
  
  for (const chunk of chunks) {
    const cleanBlocks = chunk.map(b => cleanBlockForDuplication(b));
    
    const result = await client.patch(`blocks/${targetParentId}/children`, {
      children: cleanBlocks,
    }) as { results: { id: string }[] };
    
    count += result.results.length;
    
    // Handle children recursively
    for (let i = 0; i < chunk.length; i++) {
      const sourceBlock = chunk[i];
      const targetBlock = result.results[i];
      
      if (sourceBlock.has_children && targetBlock) {
        const children = await fetchAllBlocks(client, sourceBlock.id);
        if (children.length > 0) {
          const childCount = await duplicateBlocksRecursive(client, children, targetBlock.id);
          count += childCount;
        }
      }
    }
  }
  
  return count;
}

function getPageTitle(page: Page): string {
  for (const value of Object.values(page.properties)) {
    const prop = value as { type: string; title?: { plain_text: string }[] };
    if (prop.type === 'title' && prop.title) {
      return prop.title.map(t => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

function getDbTitle(db: Database): string {
  return db.title?.map(t => t.plain_text).join('') || 'Untitled';
}

export function registerDuplicateCommand(program: Command): void {
  const duplicate = program
    .command('duplicate')
    .alias('dup')
    .description('Duplicate pages and database structures');

  // Duplicate page
  duplicate
    .command('page <page_id>')
    .description('Duplicate a page with its content')
    .option('--to <parent_id>', 'Target parent (page or database ID)')
    .option('--parent-type <type>', 'Parent type: page or database', 'database')
    .option('-t, --title <title>', 'New page title (default: "Copy of ...")')
    .option('--no-content', 'Copy only properties, not content blocks')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();
        
        // Get source page
        console.log('Fetching source page...');
        const sourcePage = await client.get(`pages/${pageId}`) as Page;
        const sourceTitle = getPageTitle(sourcePage);
        
        // Determine parent
        let parent: { database_id: string } | { page_id: string };
        
        if (options.to) {
          parent = options.parentType === 'page'
            ? { page_id: options.to }
            : { database_id: options.to };
        } else {
          // Use same parent as source
          if (sourcePage.parent.type === 'database_id') {
            parent = { database_id: sourcePage.parent.database_id! };
          } else {
            parent = { page_id: sourcePage.parent.page_id! };
          }
        }
        
        // Prepare new title
        const newTitle = options.title || `Copy of ${sourceTitle}`;
        
        // Clone properties (with new title)
        const newProperties: Record<string, unknown> = {};
        
        for (const [name, value] of Object.entries(sourcePage.properties)) {
          const prop = value as { type: string; [key: string]: unknown };
          
          if (prop.type === 'title') {
            // Set new title
            newProperties[name] = {
              title: [{ text: { content: newTitle } }],
            };
          } else if (
            // Skip computed/readonly properties
            prop.type !== 'created_time' &&
            prop.type !== 'created_by' &&
            prop.type !== 'last_edited_time' &&
            prop.type !== 'last_edited_by' &&
            prop.type !== 'formula' &&
            prop.type !== 'rollup'
          ) {
            newProperties[name] = { [prop.type]: prop[prop.type] };
          }
        }
        
        // Create new page
        console.log('Creating new page...');
        const newPage = await client.post('pages', {
          parent,
          properties: newProperties,
        }) as Page;
        
        let blockCount = 0;
        
        // Copy content if requested
        if (options.content !== false) {
          console.log('Copying content blocks...');
          const sourceBlocks = await fetchAllBlocks(client, pageId);
          
          if (sourceBlocks.length > 0) {
            blockCount = await duplicateBlocksRecursive(client, sourceBlocks, newPage.id);
          }
        }
        
        console.log(`\n✅ Page duplicated`);
        console.log(`   Original: ${sourceTitle}`);
        console.log(`   New: ${newTitle}`);
        console.log(`   ID: ${newPage.id}`);
        if (newPage.url) console.log(`   URL: ${newPage.url}`);
        if (blockCount > 0) console.log(`   Copied ${blockCount} blocks`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Clone database structure (schema only)
  duplicate
    .command('schema <database_id>')
    .alias('db-structure')
    .description('Clone database structure (schema only, no data)')
    .requiredOption('--to <page_id>', 'Target parent page ID')
    .option('-t, --title <title>', 'New database title')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        
        // Get source database
        console.log('Fetching source database schema...');
        const sourceDb = await client.get(`databases/${databaseId}`) as Database;
        const sourceTitle = getDbTitle(sourceDb);
        
        // Prepare new title
        const newTitle = options.title || `Copy of ${sourceTitle}`;
        
        // Clone properties (excluding computed ones)
        const newProperties: Record<string, unknown> = {};
        
        for (const [name, schema] of Object.entries(sourceDb.properties)) {
          // Skip formula and rollup as they depend on other DBs
          if (
            schema.type === 'formula' ||
            schema.type === 'rollup' ||
            schema.type === 'created_time' ||
            schema.type === 'created_by' ||
            schema.type === 'last_edited_time' ||
            schema.type === 'last_edited_by'
          ) {
            continue;
          }
          
          // Skip relations to other DBs (would need special handling)
          if (schema.type === 'relation') {
            console.log(`   ⚠️ Skipping relation property: ${name}`);
            continue;
          }
          
          // Clone property
          const propConfig: Record<string, unknown> = {};
          
          switch (schema.type) {
            case 'title':
              propConfig.title = {};
              break;
            case 'rich_text':
              propConfig.rich_text = {};
              break;
            case 'number':
              propConfig.number = { format: (schema.number as { format?: string })?.format || 'number' };
              break;
            case 'select':
              propConfig.select = { options: (schema.select as { options?: unknown[] })?.options || [] };
              break;
            case 'multi_select':
              propConfig.multi_select = { options: (schema.multi_select as { options?: unknown[] })?.options || [] };
              break;
            case 'status':
              propConfig.status = {
                options: (schema.status as { options?: unknown[] })?.options || [],
                groups: (schema.status as { groups?: unknown[] })?.groups || [],
              };
              break;
            case 'date':
              propConfig.date = {};
              break;
            case 'people':
              propConfig.people = {};
              break;
            case 'files':
              propConfig.files = {};
              break;
            case 'checkbox':
              propConfig.checkbox = {};
              break;
            case 'url':
              propConfig.url = {};
              break;
            case 'email':
              propConfig.email = {};
              break;
            case 'phone_number':
              propConfig.phone_number = {};
              break;
            default:
              console.log(`   ⚠️ Skipping unsupported property type: ${name} (${schema.type})`);
              continue;
          }
          
          newProperties[name] = propConfig;
        }
        
        // Create new database
        console.log('Creating new database...');
        const newDb = await client.post('databases', {
          parent: { page_id: options.to },
          title: [{ text: { content: newTitle } }],
          properties: newProperties,
        }) as Database & { url?: string };
        
        console.log(`\n✅ Database schema cloned`);
        console.log(`   Original: ${sourceTitle}`);
        console.log(`   New: ${newTitle}`);
        console.log(`   ID: ${newDb.id}`);
        if (newDb.url) console.log(`   URL: ${newDb.url}`);
        console.log(`   Properties: ${Object.keys(newProperties).length}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Full database clone (structure + data)
  duplicate
    .command('database <database_id>')
    .alias('db')
    .description('Clone entire database (schema + all entries)')
    .requiredOption('--to <page_id>', 'Target parent page ID')
    .option('-t, --title <title>', 'New database title')
    .option('--content', 'Also copy page content (slower)')
    .option('--limit <number>', 'Max entries to copy')
    .option('--dry-run', 'Show what would be cloned')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        
        // Get source database
        console.log('Fetching source database...');
        const sourceDb = await client.get(`databases/${databaseId}`) as Database;
        const sourceTitle = getDbTitle(sourceDb);
        
        // Query all entries
        const entries: Page[] = [];
        let cursor: string | undefined;
        
        do {
          const body: Record<string, unknown> = { page_size: 100 };
          if (cursor) body.start_cursor = cursor;
          if (options.limit && entries.length >= parseInt(options.limit, 10)) break;
          
          const result = await client.post(`databases/${databaseId}/query`, body) as {
            results: Page[];
            has_more: boolean;
            next_cursor?: string;
          };
          
          entries.push(...result.results);
          cursor = result.has_more ? result.next_cursor : undefined;
          
          process.stdout.write(`\rFetching entries: ${entries.length}...`);
        } while (cursor);
        
        if (options.limit) {
          entries.splice(parseInt(options.limit, 10));
        }
        
        console.log(`\rFound ${entries.length} entries to clone.      `);
        
        if (options.dryRun) {
          console.log('\n🔍 Dry run - would clone:');
          console.log(`   Database: ${sourceTitle}`);
          console.log(`   Entries: ${entries.length}`);
          console.log(`   Target: page ${options.to}`);
          return;
        }
        
        // Clone schema first
        console.log('\nCloning database schema...');
        
        const newTitle = options.title || `Copy of ${sourceTitle}`;
        const newProperties: Record<string, unknown> = {};
        
        for (const [name, schema] of Object.entries(sourceDb.properties)) {
          if (['formula', 'rollup', 'relation', 'created_time', 'created_by', 
               'last_edited_time', 'last_edited_by'].includes(schema.type)) {
            continue;
          }
          
          const propConfig: Record<string, unknown> = {};
          
          switch (schema.type) {
            case 'title': propConfig.title = {}; break;
            case 'rich_text': propConfig.rich_text = {}; break;
            case 'number': propConfig.number = { format: (schema.number as { format?: string })?.format || 'number' }; break;
            case 'select': propConfig.select = { options: (schema.select as { options?: unknown[] })?.options || [] }; break;
            case 'multi_select': propConfig.multi_select = { options: (schema.multi_select as { options?: unknown[] })?.options || [] }; break;
            case 'status': propConfig.status = { options: (schema.status as { options?: unknown[] })?.options || [], groups: (schema.status as { groups?: unknown[] })?.groups || [] }; break;
            case 'date': propConfig.date = {}; break;
            case 'people': propConfig.people = {}; break;
            case 'files': propConfig.files = {}; break;
            case 'checkbox': propConfig.checkbox = {}; break;
            case 'url': propConfig.url = {}; break;
            case 'email': propConfig.email = {}; break;
            case 'phone_number': propConfig.phone_number = {}; break;
            default: continue;
          }
          
          newProperties[name] = propConfig;
        }
        
        const newDb = await client.post('databases', {
          parent: { page_id: options.to },
          title: [{ text: { content: newTitle } }],
          properties: newProperties,
        }) as Database;
        
        console.log(`Created database: ${newDb.id}`);
        
        // Clone entries
        console.log('Cloning entries...');
        let cloned = 0;
        let failed = 0;
        
        for (const entry of entries) {
          try {
            // Prepare properties
            const entryProps: Record<string, unknown> = {};
            
            for (const [name, value] of Object.entries(entry.properties)) {
              const prop = value as { type: string; [key: string]: unknown };
              
              if (['formula', 'rollup', 'relation', 'created_time', 'created_by',
                   'last_edited_time', 'last_edited_by'].includes(prop.type)) {
                continue;
              }
              
              // Check if property exists in new schema
              if (!newProperties[name]) continue;
              
              entryProps[name] = { [prop.type]: prop[prop.type] };
            }
            
            // Create page
            const pageData: Record<string, unknown> = {
              parent: { database_id: newDb.id },
              properties: entryProps,
            };
            
            const newPage = await client.post('pages', pageData) as Page;
            
            // Copy content if requested
            if (options.content) {
              const blocks = await fetchAllBlocks(client, entry.id);
              if (blocks.length > 0) {
                await duplicateBlocksRecursive(client, blocks, newPage.id);
              }
            }
            
            cloned++;
            process.stdout.write(`\r📄 Cloned ${cloned}/${entries.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed: ${(error as Error).message}`);
          }
        }
        
        console.log(`\n\n✅ Database cloned`);
        console.log(`   Entries: ${cloned} cloned${failed > 0 ? `, ${failed} failed` : ''}`);
        console.log(`   New database ID: ${newDb.id}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
