/**
 * Export commands - export pages and databases to Markdown/Obsidian
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  richTextToMarkdown,
} from '../utils/markdown.js';
import { blocksToMarkdownAsync } from '../utils/notion-helpers.js';
import type { RichText, Block, Page } from '../types/notion.js';

function getPageTitle(page: Page): string {
  const props = page.properties;
  
  for (const [, value] of Object.entries(props)) {
    const prop = value as { type: string; title?: RichText[] };
    if (prop.type === 'title' && prop.title) {
      return richTextToMarkdown(prop.title);
    }
  }
  
  return 'Untitled';
}

function propertyToValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string;
  const data = prop[type];
  
  switch (type) {
    case 'title':
    case 'rich_text':
      return richTextToMarkdown(data as RichText[]);
    
    case 'number':
      return data;
    
    case 'select':
      return (data as { name?: string })?.name || null;
    
    case 'multi_select':
      return (data as { name: string }[])?.map(s => s.name) || [];
    
    case 'status':
      return (data as { name?: string })?.name || null;
    
    case 'date':
      const dateData = data as { start?: string; end?: string } | null;
      if (!dateData) return null;
      return dateData.end ? `${dateData.start} - ${dateData.end}` : dateData.start;
    
    case 'checkbox':
      return data;
    
    case 'url':
    case 'email':
    case 'phone_number':
      return data;
    
    case 'people':
      return (data as { name?: string }[])?.map(p => p.name).filter(Boolean) || [];
    
    case 'files':
      return (data as { name?: string; file?: { url: string }; external?: { url: string } }[])?.map(f => 
        f.file?.url || f.external?.url || f.name
      ) || [];
    
    case 'relation':
      return (data as { id: string }[])?.map(r => r.id) || [];
    
    case 'formula':
      const formula = data as { type: string; string?: string; number?: number; boolean?: boolean; date?: { start: string } };
      switch (formula?.type) {
        case 'string': return formula.string;
        case 'number': return formula.number;
        case 'boolean': return formula.boolean;
        case 'date': return formula.date?.start;
        default: return null;
      }
    
    case 'rollup':
      const rollup = data as { type: string; array?: unknown[]; number?: number; date?: { start: string } };
      switch (rollup?.type) {
        case 'array': return rollup.array;
        case 'number': return rollup.number;
        case 'date': return rollup.date?.start;
        default: return null;
      }
    
    case 'created_time':
    case 'last_edited_time':
      return data;
    
    case 'created_by':
    case 'last_edited_by':
      return (data as { name?: string })?.name || null;
    
    default:
      return null;
  }
}

function generateFrontmatter(page: Page, includeId = true): string {
  const lines: string[] = ['---'];
  
  if (includeId) {
    lines.push(`notion_id: "${page.id}"`);
  }
  
  if (page.url) {
    lines.push(`notion_url: "${page.url}"`);
  }
  
  if (page.created_time) {
    lines.push(`created: ${page.created_time.split('T')[0]}`);
  }
  
  if (page.last_edited_time) {
    lines.push(`updated: ${page.last_edited_time.split('T')[0]}`);
  }
  
  // Add all properties
  for (const [name, value] of Object.entries(page.properties)) {
    const prop = value as Record<string, unknown>;
    if (prop.type === 'title') continue; // Title is the filename
    
    const val = propertyToValue(prop);
    if (val === null || val === undefined || val === '') continue;
    
    // Sanitize property name for YAML
    const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${safeName}:`);
      val.forEach(v => lines.push(`  - "${String(v).replace(/"/g, '\\"')}"`));
    } else if (typeof val === 'string') {
      lines.push(`${safeName}: "${val.replace(/"/g, '\\"')}"`);
    } else if (typeof val === 'boolean') {
      lines.push(`${safeName}: ${val}`);
    } else if (typeof val === 'number') {
      lines.push(`${safeName}: ${val}`);
    }
  }
  
  lines.push('---\n');
  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200); // Limit length
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export pages and databases to Markdown/Obsidian');

  // Export single page
  exportCmd
    .command('page <page_id>')
    .description('Export a page to Markdown')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--obsidian', 'Include Obsidian-compatible frontmatter')
    .option('--no-content', 'Export only frontmatter, no content')
    .option('--no-frontmatter', 'Export only content, no frontmatter')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();
        
        // Fetch page
        const page = await client.get(`pages/${pageId}`) as Page;
        const title = getPageTitle(page);
        
        let output = '';
        
        // Add frontmatter
        if (options.frontmatter !== false && options.obsidian) {
          output += generateFrontmatter(page);
        }
        
        // Add title
        output += `# ${title}\n\n`;
        
        // Add content
        if (options.content !== false) {
          const content = await blocksToMarkdownAsync(client, pageId);
          output += content;
        }
        
        // Output
        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.log(`✅ Exported to ${options.output}`);
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Export database to Obsidian vault
  exportCmd
    .command('database <database_id>')
    .alias('db')
    .description('Export database entries to Obsidian vault')
    .requiredOption('--vault <path>', 'Obsidian vault path')
    .option('--folder <name>', 'Subfolder in vault', '')
    .option('--content', 'Also export page content (slower)')
    .option('--limit <number>', 'Max entries to export')
    .option('--filter <json>', 'Filter as JSON')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        
        // Determine output folder
        const vaultPath = path.resolve(options.vault);
        const outputFolder = options.folder 
          ? path.join(vaultPath, options.folder)
          : vaultPath;
        
        // Create folder if needed
        if (!fs.existsSync(outputFolder)) {
          fs.mkdirSync(outputFolder, { recursive: true });
        }
        
        // Query database
        const body: Record<string, unknown> = {};
        if (options.limit) body.page_size = parseInt(options.limit, 10);
        if (options.filter) body.filter = JSON.parse(options.filter);
        
        let cursor: string | undefined;
        let exported = 0;
        
        do {
          if (cursor) body.start_cursor = cursor;
          
          const result = await client.post(`databases/${databaseId}/query`, body) as {
            results: Page[];
            has_more: boolean;
            next_cursor?: string;
          };
          
          for (const page of result.results) {
            const title = getPageTitle(page);
            const filename = sanitizeFilename(title) + '.md';
            const filepath = path.join(outputFolder, filename);
            
            let content = generateFrontmatter(page);
            content += `# ${title}\n\n`;
            
            if (options.content) {
              try {
                const pageContent = await blocksToMarkdownAsync(client, page.id);
                content += pageContent;
              } catch {
                content += `<!-- Failed to fetch content -->\n`;
              }
            }
            
            fs.writeFileSync(filepath, content);
            exported++;
            process.stdout.write(`\r📄 Exported ${exported} pages...`);
          }
          
          cursor = result.has_more ? result.next_cursor : undefined;
          
          // Respect limit
          if (options.limit && exported >= parseInt(options.limit, 10)) {
            cursor = undefined;
          }
        } while (cursor);
        
        console.log(`\n✅ Exported ${exported} pages to ${outputFolder}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
