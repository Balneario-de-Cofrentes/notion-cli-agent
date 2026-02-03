/**
 * Template commands - save and reuse page templates
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface Page {
  id: string;
  properties: Record<string, unknown>;
}

const TEMPLATES_DIR = path.join(os.homedir(), '.notion-cli', 'templates');

// Ensure templates directory exists
function ensureTemplatesDir(): void {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

// Clean block for template storage (remove IDs, timestamps)
function cleanBlockForTemplate(block: Block): Record<string, unknown> {
  const { id, created_time, last_edited_time, created_by, last_edited_by, parent, ...rest } = block;
  
  // Clean nested content
  const blockType = rest.type as string;
  if (rest[blockType] && typeof rest[blockType] === 'object') {
    const content = rest[blockType] as Record<string, unknown>;
    // Remove IDs from rich_text items
    if (content.rich_text && Array.isArray(content.rich_text)) {
      content.rich_text = content.rich_text.map((rt: Record<string, unknown>) => {
        const { id, ...cleanRt } = rt;
        return cleanRt;
      });
    }
  }
  
  return { object: 'block', ...rest };
}

// Fetch all blocks recursively
async function fetchBlocksRecursive(
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
    
    for (const block of result.results) {
      blocks.push(block);
      
      // Recursively fetch children
      if (block.has_children) {
        const children = await fetchBlocksRecursive(client, block.id);
        (block as Record<string, unknown>).children = children;
      }
    }
    
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  
  return blocks;
}

// Clean blocks array for template
function cleanBlocksForTemplate(blocks: Block[]): Record<string, unknown>[] {
  return blocks.map(block => {
    const clean = cleanBlockForTemplate(block);
    
    if ((block as Record<string, unknown>).children) {
      (clean as Record<string, unknown>).children = cleanBlocksForTemplate(
        (block as Record<string, unknown>).children as Block[]
      );
    }
    
    return clean;
  });
}

export function registerTemplateCommand(program: Command): void {
  const template = program
    .command('template')
    .description('Manage page templates');

  // List templates
  template
    .command('list')
    .alias('ls')
    .description('List saved templates')
    .action(() => {
      ensureTemplatesDir();
      
      const files = fs.readdirSync(TEMPLATES_DIR)
        .filter(f => f.endsWith('.json'));
      
      if (files.length === 0) {
        console.log('No templates saved yet.');
        console.log('\nSave a template with: notion template save <page_id> --name "my-template"');
        return;
      }
      
      console.log('Saved templates:\n');
      
      for (const file of files) {
        const name = path.basename(file, '.json');
        const filePath = path.join(TEMPLATES_DIR, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const blockCount = content.blocks?.length || 0;
        const desc = content.description || '';
        
        console.log(`📄 ${name}`);
        console.log(`   Blocks: ${blockCount}`);
        if (desc) console.log(`   Description: ${desc}`);
        console.log('');
      }
    });

  // Save template from page
  template
    .command('save <page_id>')
    .description('Save a page as a template')
    .requiredOption('-n, --name <name>', 'Template name')
    .option('-d, --description <text>', 'Template description')
    .option('--overwrite', 'Overwrite if template exists')
    .action(async (pageId: string, options) => {
      try {
        ensureTemplatesDir();
        
        const templatePath = path.join(TEMPLATES_DIR, `${options.name}.json`);
        
        if (fs.existsSync(templatePath) && !options.overwrite) {
          console.error(`Template "${options.name}" already exists. Use --overwrite to replace.`);
          process.exit(1);
        }
        
        const client = getClient();
        
        console.log('Fetching page structure...');
        
        // Get page
        const page = await client.get(`pages/${pageId}`) as Page;
        
        // Get all blocks recursively
        const blocks = await fetchBlocksRecursive(client, pageId);
        
        console.log(`Found ${blocks.length} top-level blocks`);
        
        // Clean blocks for storage
        const cleanBlocks = cleanBlocksForTemplate(blocks);
        
        // Save template
        const templateData = {
          name: options.name,
          description: options.description || '',
          sourcePageId: pageId,
          createdAt: new Date().toISOString(),
          blocks: cleanBlocks,
          // Store property structure (but not values) for reference
          propertyTypes: Object.fromEntries(
            Object.entries(page.properties).map(([name, prop]) => [
              name,
              (prop as { type: string }).type,
            ])
          ),
        };
        
        fs.writeFileSync(templatePath, JSON.stringify(templateData, null, 2));
        
        console.log(`\n✅ Template saved: ${options.name}`);
        console.log(`   Location: ${templatePath}`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Use template
  template
    .command('use <template_name>')
    .description('Create a new page from a template')
    .requiredOption('--parent <id>', 'Parent page or database ID')
    .option('--parent-type <type>', 'Parent type: page or database', 'database')
    .option('-t, --title <title>', 'Page title')
    .option('-p, --prop <key=value...>', 'Set property values')
    .action(async (templateName: string, options) => {
      try {
        ensureTemplatesDir();
        
        const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
        
        if (!fs.existsSync(templatePath)) {
          console.error(`Template "${templateName}" not found.`);
          console.log('\nAvailable templates:');
          const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
          files.forEach(f => console.log(`  - ${path.basename(f, '.json')}`));
          process.exit(1);
        }
        
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
        
        const client = getClient();
        
        // Build parent
        const parent = options.parentType === 'page'
          ? { page_id: options.parent }
          : { database_id: options.parent };
        
        // Build properties
        const properties: Record<string, unknown> = {};
        
        // Set title if provided
        if (options.title) {
          // Try to find title property name from template or use 'Name'
          let titleProp = 'Name';
          if (template.propertyTypes) {
            for (const [name, type] of Object.entries(template.propertyTypes)) {
              if (type === 'title') {
                titleProp = name;
                break;
              }
            }
          }
          
          // If database, get actual title prop name
          if (options.parentType === 'database') {
            try {
              const db = await client.get(`databases/${options.parent}`) as {
                properties: Record<string, { type: string }>;
              };
              for (const [name, prop] of Object.entries(db.properties)) {
                if (prop.type === 'title') {
                  titleProp = name;
                  break;
                }
              }
            } catch {
              // Use default
            }
          }
          
          properties[titleProp] = {
            title: [{ text: { content: options.title } }],
          };
        }
        
        // Add custom properties
        if (options.prop) {
          for (const propStr of options.prop) {
            const [key, ...valueParts] = propStr.split('=');
            const value = valueParts.join('=');
            
            // Simple property setting - could be enhanced
            properties[key] = { rich_text: [{ text: { content: value } }] };
          }
        }
        
        // Prepare blocks (remove children for initial creation, we'll add them after)
        const prepareBlocks = (blocks: Record<string, unknown>[]): Record<string, unknown>[] => {
          return blocks.map(block => {
            const { children, ...rest } = block;
            return rest;
          }).slice(0, 100); // Notion limit
        };
        
        console.log('Creating page from template...');
        
        // Create page with first batch of blocks
        const pageData: Record<string, unknown> = {
          parent,
          properties,
          children: prepareBlocks(template.blocks),
        };
        
        const page = await client.post('pages', pageData) as { id: string; url: string };
        
        console.log(`\n✅ Page created from template "${templateName}"`);
        console.log(`   ID: ${page.id}`);
        console.log(`   URL: ${page.url}`);
        
        // Note: Nested blocks would need additional API calls to add children
        // This is left as a future enhancement
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Delete template
  template
    .command('delete <template_name>')
    .alias('rm')
    .description('Delete a saved template')
    .action((templateName: string) => {
      ensureTemplatesDir();
      
      const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
      
      if (!fs.existsSync(templatePath)) {
        console.error(`Template "${templateName}" not found.`);
        process.exit(1);
      }
      
      fs.unlinkSync(templatePath);
      console.log(`✅ Template "${templateName}" deleted`);
    });

  // Show template details
  template
    .command('show <template_name>')
    .description('Show template details')
    .option('-j, --json', 'Output raw JSON')
    .action((templateName: string, options) => {
      ensureTemplatesDir();
      
      const templatePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
      
      if (!fs.existsSync(templatePath)) {
        console.error(`Template "${templateName}" not found.`);
        process.exit(1);
      }
      
      const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
      
      if (options.json) {
        console.log(JSON.stringify(template, null, 2));
        return;
      }
      
      console.log(`📄 Template: ${template.name}\n`);
      if (template.description) {
        console.log(`Description: ${template.description}`);
      }
      console.log(`Created: ${template.createdAt}`);
      console.log(`Source: ${template.sourcePageId}`);
      console.log(`Blocks: ${template.blocks?.length || 0}`);
      
      if (template.propertyTypes) {
        console.log('\nProperty types:');
        for (const [name, type] of Object.entries(template.propertyTypes)) {
          console.log(`  - ${name}: ${type}`);
        }
      }
      
      console.log('\nBlock structure:');
      const showBlocks = (blocks: Record<string, unknown>[], indent = 0) => {
        const pad = '  '.repeat(indent);
        for (const block of blocks.slice(0, 10)) {
          console.log(`${pad}- ${block.type}`);
          if (block.children && Array.isArray(block.children)) {
            showBlocks(block.children as Record<string, unknown>[], indent + 1);
          }
        }
        if (blocks.length > 10) {
          console.log(`${pad}... and ${blocks.length - 10} more`);
        }
      };
      showBlocks(template.blocks || []);
    });
}
