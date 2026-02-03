/**
 * Import commands - import from Obsidian, CSV, Markdown
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';

interface FrontMatter {
  [key: string]: unknown;
}

interface Database {
  properties: Record<string, PropertySchema>;
}

interface PropertySchema {
  type: string;
  [key: string]: unknown;
}

// Parse YAML frontmatter from markdown content
function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    return { frontMatter: {}, body: content };
  }
  
  const yamlContent = match[1];
  const body = match[2];
  
  // Simple YAML parser (handles basic key: value and arrays)
  const frontMatter: FrontMatter = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  
  for (const line of yamlContent.split('\n')) {
    // Array item
    if (line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
      if (currentArray && currentKey) {
        currentArray.push(value);
      }
      continue;
    }
    
    // Key: value
    const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      // Save previous array if any
      if (currentKey && currentArray) {
        frontMatter[currentKey] = currentArray;
        currentArray = null;
      }
      
      const key = kvMatch[1].trim();
      let value: string | boolean | number = kvMatch[2].trim().replace(/^["']|["']$/g, '');
      
      if (value === '') {
        // Could be start of array
        currentKey = key;
        currentArray = [];
        continue;
      }
      
      // Type coercion
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
      
      frontMatter[key] = value;
      currentKey = key;
      currentArray = null;
    }
  }
  
  // Save final array if any
  if (currentKey && currentArray && currentArray.length > 0) {
    frontMatter[currentKey] = currentArray;
  }
  
  return { frontMatter, body };
}

// Convert markdown to Notion blocks
function markdownToBlocks(markdown: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip empty lines
    if (!line.trim()) {
      i++;
      continue;
    }
    
    // Headings
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: h1Match[1] } }] },
      });
      i++;
      continue;
    }
    
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: h2Match[1] } }] },
      });
      i++;
      continue;
    }
    
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: h3Match[1] } }] },
      });
      i++;
      continue;
    }
    
    // Bullet list
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: bulletMatch[1] } }] },
      });
      i++;
      continue;
    }
    
    // Numbered list
    const numMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numMatch) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: numMatch[1] } }] },
      });
      i++;
      continue;
    }
    
    // Checkbox / todo
    const todoMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: todoMatch[2] } }],
          checked: todoMatch[1].toLowerCase() === 'x',
        },
      });
      i++;
      continue;
    }
    
    // Quote
    const quoteMatch = line.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: quoteMatch[1] } }] },
      });
      i++;
      continue;
    }
    
    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'plain text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: lang,
        },
      });
      i++; // Skip closing ```
      continue;
    }
    
    // Divider
    if (line.match(/^---+$/)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i++;
      continue;
    }
    
    // Regular paragraph
    if (line.trim()) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      });
    }
    
    i++;
  }
  
  return blocks;
}

// Convert frontmatter to Notion properties
function frontMatterToProperties(
  frontMatter: FrontMatter,
  schema: Record<string, PropertySchema>,
  titlePropName: string
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(frontMatter)) {
    // Skip notion-specific metadata
    if (key === 'notion_id' || key === 'notion_url') continue;
    
    // Find matching property (case-insensitive, underscores to spaces)
    let propName: string | null = null;
    let propSchema: PropertySchema | null = null;
    
    const normalizedKey = key.toLowerCase().replace(/_/g, ' ');
    
    for (const [schemaName, schemaProp] of Object.entries(schema)) {
      if (schemaName.toLowerCase() === normalizedKey) {
        propName = schemaName;
        propSchema = schemaProp;
        break;
      }
    }
    
    if (!propName || !propSchema) continue;
    
    // Convert value based on property type
    switch (propSchema.type) {
      case 'title':
        properties[propName] = {
          title: [{ text: { content: String(value) } }],
        };
        break;
      
      case 'rich_text':
        properties[propName] = {
          rich_text: [{ text: { content: String(value) } }],
        };
        break;
      
      case 'number':
        properties[propName] = { number: Number(value) || null };
        break;
      
      case 'checkbox':
        properties[propName] = { checkbox: Boolean(value) };
        break;
      
      case 'select':
        properties[propName] = { select: { name: String(value) } };
        break;
      
      case 'multi_select':
        const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        properties[propName] = {
          multi_select: items.map(name => ({ name: String(name) })),
        };
        break;
      
      case 'status':
        properties[propName] = { status: { name: String(value) } };
        break;
      
      case 'date':
        if (value) {
          properties[propName] = { date: { start: String(value) } };
        }
        break;
      
      case 'url':
        properties[propName] = { url: String(value) || null };
        break;
      
      case 'email':
        properties[propName] = { email: String(value) || null };
        break;
    }
  }
  
  return properties;
}

// Find title property in schema
function findTitleProperty(schema: Record<string, PropertySchema>): string {
  for (const [name, prop] of Object.entries(schema)) {
    if (prop.type === 'title') {
      return name;
    }
  }
  return 'Name';
}

// Parse CSV line (handles quoted values)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command('import')
    .description('Import from Obsidian, CSV, or Markdown');

  // Import from Obsidian vault
  importCmd
    .command('obsidian <vault_path>')
    .description('Import markdown files from Obsidian vault')
    .requiredOption('--to <database_id>', 'Target database ID')
    .option('--folder <name>', 'Specific folder in vault to import')
    .option('--content', 'Also import page content (not just frontmatter)')
    .option('--dry-run', 'Show what would be imported without making changes')
    .option('--limit <number>', 'Max files to import')
    .action(async (vaultPath: string, options) => {
      try {
        const client = getClient();
        
        // Get database schema
        const db = await client.get(`databases/${options.to}`) as Database;
        const titleProp = findTitleProperty(db.properties);
        
        // Find markdown files
        const basePath = options.folder 
          ? path.join(vaultPath, options.folder)
          : vaultPath;
        
        if (!fs.existsSync(basePath)) {
          console.error(`Error: Path not found: ${basePath}`);
          process.exit(1);
        }
        
        const files: string[] = [];
        
        function scanDir(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else if (entry.name.endsWith('.md')) {
              files.push(fullPath);
            }
          }
        }
        
        scanDir(basePath);
        
        if (options.limit) {
          files.splice(parseInt(options.limit, 10));
        }
        
        console.log(`Found ${files.length} markdown files\n`);
        
        if (options.dryRun) {
          console.log('Files to import:');
          files.slice(0, 20).forEach(f => {
            const name = path.basename(f, '.md');
            console.log(`  - ${name}`);
          });
          if (files.length > 20) {
            console.log(`  ... and ${files.length - 20} more`);
          }
          console.log('\n🔍 Dry run - no changes made');
          return;
        }
        
        let imported = 0;
        let failed = 0;
        
        for (const file of files) {
          try {
            const content = fs.readFileSync(file, 'utf-8');
            const { frontMatter, body } = parseFrontMatter(content);
            
            // Get title from filename or frontmatter
            const title = (frontMatter.title as string) || path.basename(file, '.md');
            
            // Convert frontmatter to properties
            const properties = frontMatterToProperties(frontMatter, db.properties, titleProp);
            
            // Add title
            properties[titleProp] = {
              title: [{ text: { content: title } }],
            };
            
            // Create page
            const pageData: Record<string, unknown> = {
              parent: { database_id: options.to },
              properties,
            };
            
            // Add content if requested
            if (options.content && body.trim()) {
              pageData.children = markdownToBlocks(body).slice(0, 100); // Notion limit
            }
            
            await client.post('pages', pageData);
            imported++;
            process.stdout.write(`\r📥 Imported ${imported}/${files.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed to import ${path.basename(file)}: ${(error as Error).message}`);
          }
        }
        
        console.log(`\n\n✅ Imported ${imported} files${failed > 0 ? `, ${failed} failed` : ''}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Import from CSV
  importCmd
    .command('csv <file_path>')
    .description('Import from CSV file')
    .requiredOption('--to <database_id>', 'Target database ID')
    .option('--title-column <name>', 'Column to use as page title', 'Name')
    .option('--dry-run', 'Show what would be imported without making changes')
    .option('--limit <number>', 'Max rows to import')
    .action(async (filePath: string, options) => {
      try {
        const client = getClient();
        
        // Get database schema
        const db = await client.get(`databases/${options.to}`) as Database;
        const titleProp = findTitleProperty(db.properties);
        
        // Read CSV
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        
        if (lines.length < 2) {
          console.error('Error: CSV must have header row and at least one data row');
          process.exit(1);
        }
        
        const headers = parseCSVLine(lines[0]);
        let dataLines = lines.slice(1);
        
        if (options.limit) {
          dataLines = dataLines.slice(0, parseInt(options.limit, 10));
        }
        
        console.log(`Found ${dataLines.length} rows to import`);
        console.log(`Columns: ${headers.join(', ')}\n`);
        
        if (options.dryRun) {
          console.log('Preview (first 5 rows):');
          dataLines.slice(0, 5).forEach((line, i) => {
            const values = parseCSVLine(line);
            const titleIdx = headers.findIndex(h => h.toLowerCase() === options.titleColumn.toLowerCase());
            const title = titleIdx >= 0 ? values[titleIdx] : values[0];
            console.log(`  ${i + 1}. ${title}`);
          });
          console.log('\n🔍 Dry run - no changes made');
          return;
        }
        
        let imported = 0;
        let failed = 0;
        
        for (const line of dataLines) {
          try {
            const values = parseCSVLine(line);
            const properties: Record<string, unknown> = {};
            
            // Map CSV columns to Notion properties
            for (let i = 0; i < headers.length; i++) {
              const header = headers[i];
              const value = values[i] || '';
              
              // Find matching property
              let propName: string | null = null;
              let propSchema: PropertySchema | null = null;
              
              for (const [schemaName, schemaProp] of Object.entries(db.properties)) {
                if (schemaName.toLowerCase() === header.toLowerCase()) {
                  propName = schemaName;
                  propSchema = schemaProp;
                  break;
                }
              }
              
              if (!propName || !propSchema || !value) continue;
              
              // Convert based on type
              switch (propSchema.type) {
                case 'title':
                  properties[propName] = { title: [{ text: { content: value } }] };
                  break;
                case 'rich_text':
                  properties[propName] = { rich_text: [{ text: { content: value } }] };
                  break;
                case 'number':
                  properties[propName] = { number: parseFloat(value) || null };
                  break;
                case 'checkbox':
                  properties[propName] = { checkbox: value.toLowerCase() === 'true' };
                  break;
                case 'select':
                  properties[propName] = { select: { name: value } };
                  break;
                case 'multi_select':
                  properties[propName] = {
                    multi_select: value.split(',').map(v => ({ name: v.trim() })),
                  };
                  break;
                case 'status':
                  properties[propName] = { status: { name: value } };
                  break;
                case 'date':
                  properties[propName] = { date: { start: value } };
                  break;
                case 'url':
                  properties[propName] = { url: value };
                  break;
                case 'email':
                  properties[propName] = { email: value };
                  break;
              }
            }
            
            // Ensure title is set
            if (!properties[titleProp]) {
              const titleIdx = headers.findIndex(h => h.toLowerCase() === options.titleColumn.toLowerCase());
              const title = titleIdx >= 0 ? values[titleIdx] : values[0] || 'Untitled';
              properties[titleProp] = { title: [{ text: { content: title } }] };
            }
            
            await client.post('pages', {
              parent: { database_id: options.to },
              properties,
            });
            
            imported++;
            process.stdout.write(`\r📥 Imported ${imported}/${dataLines.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed: ${(error as Error).message}`);
          }
        }
        
        console.log(`\n\n✅ Imported ${imported} rows${failed > 0 ? `, ${failed} failed` : ''}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Import single markdown file to page
  importCmd
    .command('markdown <file_path>')
    .description('Import a markdown file as page content')
    .requiredOption('--to <page_id>', 'Target page ID (appends content)')
    .option('--replace', 'Replace existing content (deletes all blocks first)')
    .option('--dry-run', 'Show what would be imported')
    .action(async (filePath: string, options) => {
      try {
        const client = getClient();
        
        // Read file
        const content = fs.readFileSync(filePath, 'utf-8');
        const { body } = parseFrontMatter(content);
        
        // Convert to blocks
        const blocks = markdownToBlocks(body);
        
        console.log(`Parsed ${blocks.length} blocks from ${path.basename(filePath)}`);
        
        if (options.dryRun) {
          console.log('\nBlocks to create:');
          blocks.slice(0, 10).forEach((block, i) => {
            const type = block.type as string;
            console.log(`  ${i + 1}. ${type}`);
          });
          if (blocks.length > 10) {
            console.log(`  ... and ${blocks.length - 10} more`);
          }
          console.log('\n🔍 Dry run - no changes made');
          return;
        }
        
        // Delete existing blocks if replace mode
        if (options.replace) {
          console.log('Removing existing content...');
          const existing = await client.get(`blocks/${options.to}/children`) as {
            results: { id: string }[];
          };
          
          for (const block of existing.results) {
            await client.delete(`blocks/${block.id}`);
          }
        }
        
        // Append blocks (Notion has a limit of 100 per request)
        const chunks = [];
        for (let i = 0; i < blocks.length; i += 100) {
          chunks.push(blocks.slice(i, i + 100));
        }
        
        let added = 0;
        for (const chunk of chunks) {
          await client.patch(`blocks/${options.to}/children`, {
            children: chunk,
          });
          added += chunk.length;
          process.stdout.write(`\r📥 Added ${added}/${blocks.length} blocks...`);
        }
        
        console.log(`\n\n✅ Imported ${blocks.length} blocks to page`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
