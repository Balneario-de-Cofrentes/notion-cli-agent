/**
 * Backup command - full database backup to local files
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';

interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface Page {
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
  parent: { type: string; database_id?: string };
}

interface Database {
  id: string;
  title: { plain_text: string }[];
  properties: Record<string, unknown>;
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

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

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

async function fetchBlocksRecursive(
  client: ReturnType<typeof getClient>,
  blockId: string
): Promise<Block[]> {
  const blocks = await fetchAllBlocks(client, blockId);
  
  for (const block of blocks) {
    if (block.has_children) {
      const children = await fetchBlocksRecursive(client, block.id);
      (block as Record<string, unknown>).children = children;
    }
  }
  
  return blocks;
}

export function registerBackupCommand(program: Command): void {
  program
    .command('backup <database_id>')
    .description('Create a full backup of a database')
    .requiredOption('-o, --output <path>', 'Output directory')
    .option('--content', 'Also backup page content (blocks)')
    .option('--format <type>', 'Output format: json or markdown', 'json')
    .option('--incremental', 'Only backup entries modified since last backup')
    .option('--limit <number>', 'Max entries to backup')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        const outputDir = path.resolve(options.output);
        
        // Create output directory
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Get database info
        console.log('Fetching database schema...');
        const db = await client.get(`databases/${databaseId}`) as Database;
        const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
        
        // Save schema
        const schemaPath = path.join(outputDir, 'schema.json');
        fs.writeFileSync(schemaPath, JSON.stringify(db, null, 2));
        console.log(`✅ Schema saved to ${schemaPath}`);
        
        // Check for incremental backup
        let lastBackupTime: Date | null = null;
        const metaPath = path.join(outputDir, '.backup-meta.json');
        
        if (options.incremental && fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          lastBackupTime = new Date(meta.lastBackup);
          console.log(`📅 Incremental backup since ${lastBackupTime.toISOString()}`);
        }
        
        // Query entries
        const entries: Page[] = [];
        let cursor: string | undefined;
        
        const queryBody: Record<string, unknown> = {
          page_size: 100,
          sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        };
        
        if (lastBackupTime) {
          queryBody.filter = {
            timestamp: 'last_edited_time',
            last_edited_time: { after: lastBackupTime.toISOString() },
          };
        }
        
        do {
          if (cursor) queryBody.start_cursor = cursor;
          
          const result = await client.post(`databases/${databaseId}/query`, queryBody) as {
            results: Page[];
            has_more: boolean;
            next_cursor?: string;
          };
          
          entries.push(...result.results);
          cursor = result.has_more ? result.next_cursor : undefined;
          
          process.stdout.write(`\rFetching entries: ${entries.length}...`);
          
          if (options.limit && entries.length >= parseInt(options.limit, 10)) {
            entries.splice(parseInt(options.limit, 10));
            break;
          }
        } while (cursor);
        
        console.log(`\rFound ${entries.length} entries to backup.      \n`);
        
        if (entries.length === 0) {
          console.log('No entries to backup.');
          return;
        }
        
        // Create pages directory
        const pagesDir = path.join(outputDir, 'pages');
        if (!fs.existsSync(pagesDir)) {
          fs.mkdirSync(pagesDir, { recursive: true });
        }
        
        // Backup each entry
        let backed = 0;
        let totalSize = 0;
        
        for (const entry of entries) {
          const title = getPageTitle(entry);
          const filename = `${sanitizeFilename(title)}_${entry.id.slice(0, 8)}`;
          
          const pageData: Record<string, unknown> = {
            id: entry.id,
            url: entry.url,
            created_time: entry.created_time,
            last_edited_time: entry.last_edited_time,
            properties: entry.properties,
          };
          
          // Fetch content if requested
          if (options.content) {
            try {
              const blocks = await fetchBlocksRecursive(client, entry.id);
              pageData.content = blocks;
            } catch (error) {
              pageData.content_error = (error as Error).message;
            }
          }
          
          // Save based on format
          if (options.format === 'markdown') {
            const mdContent = generateMarkdown(entry, pageData.content as Block[] | undefined);
            const filePath = path.join(pagesDir, `${filename}.md`);
            fs.writeFileSync(filePath, mdContent);
            totalSize += mdContent.length;
          } else {
            const jsonContent = JSON.stringify(pageData, null, 2);
            const filePath = path.join(pagesDir, `${filename}.json`);
            fs.writeFileSync(filePath, jsonContent);
            totalSize += jsonContent.length;
          }
          
          backed++;
          process.stdout.write(`\r💾 Backed up ${backed}/${entries.length}...`);
        }
        
        // Save index
        const index = entries.map(e => ({
          id: e.id,
          title: getPageTitle(e),
          last_edited: e.last_edited_time,
        }));
        
        const indexPath = path.join(outputDir, 'index.json');
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
        
        // Save metadata
        const meta = {
          databaseId,
          databaseTitle: dbTitle,
          lastBackup: new Date().toISOString(),
          entriesCount: entries.length,
          format: options.format,
          includesContent: !!options.content,
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        
        // Summary
        const sizeMb = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`\n\n✅ Backup complete!`);
        console.log(`   Database: ${dbTitle}`);
        console.log(`   Entries: ${backed}`);
        console.log(`   Size: ${sizeMb} MB`);
        console.log(`   Location: ${outputDir}`);
        
        if (options.incremental) {
          console.log(`   Mode: Incremental (since ${lastBackupTime?.toISOString() || 'beginning'})`);
        }
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}

function generateMarkdown(page: Page, blocks?: Block[]): string {
  const title = getPageTitle(page);
  let md = '';
  
  // Frontmatter
  md += '---\n';
  md += `notion_id: "${page.id}"\n`;
  if (page.url) md += `notion_url: "${page.url}"\n`;
  md += `created: ${page.created_time.split('T')[0]}\n`;
  md += `updated: ${page.last_edited_time.split('T')[0]}\n`;
  
  // Properties
  for (const [name, value] of Object.entries(page.properties)) {
    const prop = value as { type: string; [key: string]: unknown };
    if (prop.type === 'title') continue;
    
    const val = extractPropertyValue(prop);
    if (val !== null && val !== '') {
      const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (Array.isArray(val)) {
        md += `${safeName}:\n`;
        val.forEach(v => md += `  - "${v}"\n`);
      } else if (typeof val === 'string') {
        md += `${safeName}: "${val.replace(/"/g, '\\"')}"\n`;
      } else {
        md += `${safeName}: ${val}\n`;
      }
    }
  }
  
  md += '---\n\n';
  md += `# ${title}\n\n`;
  
  // Content
  if (blocks) {
    md += blocksToMarkdown(blocks);
  }
  
  return md;
}

function extractPropertyValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string;
  const data = prop[type];
  
  switch (type) {
    case 'title':
    case 'rich_text':
      return (data as { plain_text: string }[])?.map(t => t.plain_text).join('') || null;
    case 'select':
    case 'status':
      return (data as { name?: string })?.name || null;
    case 'multi_select':
      return (data as { name: string }[])?.map(s => s.name) || [];
    case 'date':
      return (data as { start?: string })?.start || null;
    case 'number':
      return data;
    case 'checkbox':
      return data;
    case 'url':
    case 'email':
    case 'phone_number':
      return data || null;
    case 'people':
      return (data as { name?: string }[])?.map(p => p.name).filter(Boolean) || [];
    default:
      return null;
  }
}

function blocksToMarkdown(blocks: Block[], indent = 0): string {
  let md = '';
  const pad = '  '.repeat(indent);
  
  for (const block of blocks) {
    const type = block.type;
    const data = block[type] as Record<string, unknown> | undefined;
    
    if (!data) continue;
    
    const richText = data.rich_text as { plain_text: string }[] | undefined;
    const text = richText?.map(rt => rt.plain_text).join('') || '';
    
    switch (type) {
      case 'paragraph':
        if (text) md += `${pad}${text}\n\n`;
        break;
      case 'heading_1':
        md += `${pad}# ${text}\n\n`;
        break;
      case 'heading_2':
        md += `${pad}## ${text}\n\n`;
        break;
      case 'heading_3':
        md += `${pad}### ${text}\n\n`;
        break;
      case 'bulleted_list_item':
        md += `${pad}- ${text}\n`;
        break;
      case 'numbered_list_item':
        md += `${pad}1. ${text}\n`;
        break;
      case 'to_do':
        const checked = (data.checked as boolean) ? 'x' : ' ';
        md += `${pad}- [${checked}] ${text}\n`;
        break;
      case 'quote':
        md += `${pad}> ${text}\n\n`;
        break;
      case 'code':
        const lang = (data.language as string) || '';
        md += `${pad}\`\`\`${lang}\n${pad}${text}\n${pad}\`\`\`\n\n`;
        break;
      case 'divider':
        md += `${pad}---\n\n`;
        break;
    }
    
    // Handle children
    const children = (block as Record<string, unknown>).children as Block[] | undefined;
    if (children && children.length > 0) {
      md += blocksToMarkdown(children, indent + 1);
    }
  }
  
  return md;
}
