/**
 * AI-native commands - summarize, extract, agent-prompt
 * Designed for AI agent consumption
 */
import { Command } from 'commander';
import { getClient } from '../client.js';

interface Block {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface RichText {
  plain_text: string;
}

interface Page {
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}

interface Database {
  id: string;
  title: { plain_text: string }[];
  description?: { plain_text: string }[];
  properties: Record<string, PropertySchema>;
}

interface PropertySchema {
  type: string;
  [key: string]: unknown;
}

interface SelectOption {
  name: string;
}

// Extract text from blocks
function extractBlockText(block: Block): string {
  const type = block.type;
  const data = block[type] as Record<string, unknown> | undefined;
  
  if (!data) return '';
  
  const richText = data.rich_text as RichText[] | undefined;
  const text = richText?.map(rt => rt.plain_text).join('') || '';
  
  switch (type) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `• ${text}`;
    case 'numbered_list_item':
      return `- ${text}`;
    case 'to_do':
      const checked = (data.checked as boolean) ? '✓' : '○';
      return `${checked} ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'code':
      return `[code: ${text.slice(0, 50)}...]`;
    case 'paragraph':
      return text;
    default:
      return text;
  }
}

// Fetch all blocks from a page
async function fetchAllBlocks(
  client: ReturnType<typeof getClient>,
  pageId: string
): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;
  
  do {
    const params = cursor ? `?start_cursor=${cursor}` : '';
    const result = await client.get(`blocks/${pageId}/children${params}`) as {
      results: Block[];
      has_more: boolean;
      next_cursor?: string;
    };
    
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  
  return blocks;
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

function getPropertyValue(prop: Record<string, unknown>): string | null {
  const type = prop.type as string;
  const data = prop[type];
  
  switch (type) {
    case 'title':
    case 'rich_text':
      return (data as RichText[])?.map(t => t.plain_text).join('') || null;
    case 'select':
    case 'status':
      return (data as { name?: string })?.name || null;
    case 'multi_select':
      return (data as { name: string }[])?.map(s => s.name).join(', ') || null;
    case 'date':
      const dateData = data as { start?: string; end?: string } | null;
      return dateData?.start || null;
    case 'number':
      return data != null ? String(data) : null;
    case 'checkbox':
      return data ? 'Yes' : 'No';
    case 'url':
    case 'email':
    case 'phone_number':
      return data as string || null;
    case 'people':
      return (data as { name?: string }[])?.map(p => p.name).filter(Boolean).join(', ') || null;
    default:
      return null;
  }
}

function timeSince(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

export function registerAICommand(program: Command): void {
  const ai = program
    .command('ai')
    .description('AI-native operations for agents');

  // Summarize page
  ai
    .command('summarize <page_id>')
    .alias('sum')
    .description('Generate a concise summary of a page')
    .option('--max-lines <number>', 'Max content lines to analyze', '50')
    .option('-j, --json', 'Output as JSON')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();
        
        // Get page
        const page = await client.get(`pages/${pageId}`) as Page;
        const title = getPageTitle(page);
        
        // Get blocks
        const blocks = await fetchAllBlocks(client, pageId);
        
        // Extract key info from properties
        const keyProps: Record<string, string> = {};
        for (const [name, value] of Object.entries(page.properties)) {
          const val = getPropertyValue(value as Record<string, unknown>);
          if (val && !['title'].includes((value as { type: string }).type)) {
            keyProps[name] = val;
          }
        }
        
        // Extract content summary
        const contentLines = blocks
          .map(b => extractBlockText(b))
          .filter(t => t.trim())
          .slice(0, parseInt(options.maxLines, 10));
        
        // Identify key elements
        const headings = contentLines.filter(l => l.startsWith('#'));
        const todos = contentLines.filter(l => l.startsWith('○') || l.startsWith('✓'));
        const completedTodos = todos.filter(l => l.startsWith('✓')).length;
        const pendingTodos = todos.filter(l => l.startsWith('○')).length;
        
        // Build summary
        const summary = {
          title,
          id: page.id,
          url: page.url,
          lastEdited: timeSince(page.last_edited_time),
          properties: keyProps,
          structure: {
            totalBlocks: blocks.length,
            headings: headings.length,
            todos: { completed: completedTodos, pending: pendingTodos },
          },
          sections: headings.slice(0, 5).map(h => h.replace(/^#+\s*/, '')),
          preview: contentLines.slice(0, 10).join('\n'),
        };
        
        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }
        
        // Human-readable output
        console.log(`# ${title}\n`);
        console.log(`**Last edited:** ${summary.lastEdited}`);
        console.log(`**Blocks:** ${blocks.length}`);
        
        if (Object.keys(keyProps).length > 0) {
          console.log('\n**Properties:**');
          for (const [k, v] of Object.entries(keyProps)) {
            console.log(`  - ${k}: ${v}`);
          }
        }
        
        if (pendingTodos > 0 || completedTodos > 0) {
          console.log(`\n**Todos:** ${completedTodos}/${completedTodos + pendingTodos} completed`);
        }
        
        if (headings.length > 0) {
          console.log('\n**Sections:**');
          headings.slice(0, 5).forEach(h => {
            console.log(`  ${h}`);
          });
        }
        
        console.log('\n**Preview:**');
        console.log(contentLines.slice(0, 5).map(l => `  ${l}`).join('\n'));
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Extract structured data
  ai
    .command('extract <page_id>')
    .description('Extract structured data from page content')
    .requiredOption('--schema <fields>', 'Comma-separated field names to extract')
    .option('--from-props', 'Extract from properties only (faster)')
    .action(async (pageId: string, options) => {
      try {
        const client = getClient();
        const fields = options.schema.split(',').map((f: string) => f.trim().toLowerCase());
        
        // Get page
        const page = await client.get(`pages/${pageId}`) as Page;
        
        const extracted: Record<string, string | null> = {};
        
        // Initialize all fields as null
        for (const field of fields) {
          extracted[field] = null;
        }
        
        // Extract from properties
        for (const [name, value] of Object.entries(page.properties)) {
          const normalizedName = name.toLowerCase();
          for (const field of fields) {
            if (normalizedName.includes(field) || field.includes(normalizedName)) {
              const val = getPropertyValue(value as Record<string, unknown>);
              if (val) {
                extracted[field] = val;
              }
            }
          }
        }
        
        // Extract from content if needed
        if (!options.fromProps) {
          const blocks = await fetchAllBlocks(client, pageId);
          const content = blocks.map(b => extractBlockText(b)).join('\n').toLowerCase();
          
          // Simple pattern matching for common fields
          for (const field of fields) {
            if (extracted[field]) continue; // Already found
            
            // Email pattern
            if (field.includes('email') || field.includes('correo')) {
              const emailMatch = content.match(/[\w.-]+@[\w.-]+\.\w+/);
              if (emailMatch) extracted[field] = emailMatch[0];
            }
            
            // Phone pattern
            if (field.includes('phone') || field.includes('tel') || field.includes('móvil')) {
              const phoneMatch = content.match(/[\d\s\-+()]{9,}/);
              if (phoneMatch) extracted[field] = phoneMatch[0].trim();
            }
            
            // URL pattern
            if (field.includes('url') || field.includes('web') || field.includes('link')) {
              const urlMatch = content.match(/https?:\/\/[\w.-]+[^\s]*/);
              if (urlMatch) extracted[field] = urlMatch[0];
            }
            
            // Date patterns
            if (field.includes('date') || field.includes('fecha')) {
              const dateMatch = content.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/);
              if (dateMatch) extracted[field] = dateMatch[0];
            }
            
            // Amount/price patterns
            if (field.includes('price') || field.includes('precio') || field.includes('amount') || field.includes('importe')) {
              const priceMatch = content.match(/[\d.,]+\s*€|€\s*[\d.,]+|\$\s*[\d.,]+|[\d.,]+\s*eur/i);
              if (priceMatch) extracted[field] = priceMatch[0];
            }
          }
        }
        
        console.log(JSON.stringify(extracted, null, 2));
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Generate agent prompt
  ai
    .command('prompt <database_id>')
    .alias('agent-prompt')
    .description('Generate an optimal prompt for an AI agent to work with this database')
    .option('--examples <number>', 'Number of example entries', '2')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        
        // Get database
        const db = await client.get(`databases/${databaseId}`) as Database;
        const title = getDbTitle(db);
        const description = db.description?.map(t => t.plain_text).join('') || '';
        
        // Get example entries
        const examples = await client.post(`databases/${databaseId}/query`, {
          page_size: parseInt(options.examples, 10),
        }) as { results: Page[] };
        
        // Analyze property usage
        const propInfo: Record<string, {
          type: string;
          options?: string[];
          required?: boolean;
          examples: string[];
        }> = {};
        
        for (const [name, schema] of Object.entries(db.properties)) {
          const info: typeof propInfo[string] = {
            type: schema.type,
            examples: [],
          };
          
          // Get options for select/status
          if (schema.type === 'select') {
            const opts = (schema.select as { options?: SelectOption[] })?.options || [];
            info.options = opts.map(o => o.name);
          } else if (schema.type === 'multi_select') {
            const opts = (schema.multi_select as { options?: SelectOption[] })?.options || [];
            info.options = opts.map(o => o.name);
          } else if (schema.type === 'status') {
            const opts = (schema.status as { options?: SelectOption[] })?.options || [];
            info.options = opts.map(o => o.name);
          }
          
          // Get example values from entries
          for (const entry of examples.results) {
            const prop = entry.properties[name];
            if (prop) {
              const val = getPropertyValue(prop as Record<string, unknown>);
              if (val && !info.examples.includes(val)) {
                info.examples.push(val);
              }
            }
          }
          
          propInfo[name] = info;
        }
        
        // Find title property
        let titleProp = 'Name';
        for (const [name, schema] of Object.entries(db.properties)) {
          if (schema.type === 'title') {
            titleProp = name;
            break;
          }
        }
        
        // Generate prompt
        console.log(`# Working with Notion Database: "${title}"\n`);
        
        if (description) {
          console.log(`> ${description}\n`);
        }
        
        console.log(`**Database ID:** \`${databaseId}\`\n`);
        
        console.log('## Properties\n');
        
        for (const [name, info] of Object.entries(propInfo)) {
          console.log(`### ${name} (${info.type})`);
          
          if (info.options && info.options.length > 0) {
            console.log(`**Valid values:** ${info.options.map(o => `"${o}"`).join(', ')}`);
            console.log(`⚠️ Use EXACTLY these values, not translations or variations.`);
          }
          
          if (info.examples.length > 0) {
            console.log(`**Examples:** ${info.examples.slice(0, 3).join(', ')}`);
          }
          
          console.log('');
        }
        
        console.log('## Common Operations\n');
        
        console.log('### Search entries');
        console.log('```bash');
        console.log(`notion search "query" --type page`);
        console.log(`notion db query ${databaseId.slice(0, 8)}... --limit 10`);
        console.log('```\n');
        
        console.log('### Create new entry');
        console.log('```bash');
        console.log(`notion page create --parent ${databaseId.slice(0, 8)}... --title "Entry title"`);
        
        // Add property examples
        const statusProp = Object.entries(propInfo).find(([, i]) => i.type === 'status');
        if (statusProp && statusProp[1].options) {
          console.log(`  --prop "${statusProp[0]}=${statusProp[1].options[0]}"`);
        }
        console.log('```\n');
        
        console.log('### Update entry');
        console.log('```bash');
        console.log(`notion page update <page_id> --prop "PropertyName=value"`);
        console.log('```\n');
        
        console.log('### Smart find');
        console.log('```bash');
        console.log(`notion find "descripción en lenguaje natural" -d ${databaseId.slice(0, 8)}...`);
        console.log('```\n');
        
        console.log('## Important Notes\n');
        console.log(`- Title property is called "${titleProp}" (not "Name" or "Title")`);
        
        if (propInfo['Status']?.options) {
          console.log(`- Status values are in Spanish: ${propInfo['Status'].options.slice(0, 3).join(', ')}`);
        }
        
        console.log('- Use `notion inspect schema` for full property details');
        console.log('- Use `--dry-run` on bulk operations before executing');
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Suggest command
  ai
    .command('suggest <database_id> <description>')
    .description('Suggest the right command based on natural language')
    .action(async (databaseId: string, description: string, _options) => {
      try {
        const client = getClient();
        const db = await client.get(`databases/${databaseId}`) as Database;
        const lowerDesc = description.toLowerCase();
        
        // Find relevant properties
        let statusProp = '';
        let dateProp = '';
        let peopleProp = '';
        
        for (const [name, schema] of Object.entries(db.properties)) {
          if (schema.type === 'status') statusProp = name;
          if (schema.type === 'date' && !dateProp) dateProp = name;
          if (schema.type === 'people' && !peopleProp) peopleProp = name;
        }
        
        console.log('# Suggested commands\n');
        
        // Filter patterns
        if (lowerDesc.includes('done') || lowerDesc.includes('hecho') || lowerDesc.includes('completado')) {
          console.log('## Find completed items');
          console.log('```bash');
          console.log(`notion find "hecho" -d ${databaseId}`);
          console.log('# or with explicit filter:');
          console.log(`notion db query ${databaseId} --filter-prop "${statusProp}" --filter-type equals --filter-value "Hecho" --filter-prop-type status`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('pending') || lowerDesc.includes('pendiente') || lowerDesc.includes('todo')) {
          console.log('## Find pending items');
          console.log('```bash');
          console.log(`notion find "pendiente" -d ${databaseId}`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('overdue') || lowerDesc.includes('vencid') || lowerDesc.includes('atrasad')) {
          console.log('## Find overdue items');
          console.log('```bash');
          console.log(`notion find "vencidas" -d ${databaseId}`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('unassigned') || lowerDesc.includes('sin asignar')) {
          console.log('## Find unassigned items');
          console.log('```bash');
          console.log(`notion find "sin asignar" -d ${databaseId}`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('crear') || lowerDesc.includes('create') || lowerDesc.includes('añadir') || lowerDesc.includes('add')) {
          console.log('## Create new entry');
          console.log('```bash');
          console.log(`notion page create --parent ${databaseId} --title "Título aquí"`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('actualizar') || lowerDesc.includes('update') || lowerDesc.includes('cambiar')) {
          console.log('## Update entries');
          console.log('```bash');
          console.log(`# Single entry:`);
          console.log(`notion page update <page_id> --prop "Status=Hecho"`);
          console.log(`# Multiple entries:`);
          console.log(`notion bulk update ${databaseId} --where "Status=Por empezar" --set "Status=En marcha" --dry-run`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('archivar') || lowerDesc.includes('archive') || lowerDesc.includes('borrar') || lowerDesc.includes('delete')) {
          console.log('## Archive entries');
          console.log('```bash');
          console.log(`notion bulk archive ${databaseId} --where "Status=Hecho" --dry-run`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('estadísticas') || lowerDesc.includes('stats') || lowerDesc.includes('resumen')) {
          console.log('## Get statistics');
          console.log('```bash');
          console.log(`notion stats overview ${databaseId}`);
          console.log(`notion stats timeline ${databaseId} --days 7`);
          console.log('```\n');
        }
        
        if (lowerDesc.includes('export') || lowerDesc.includes('backup')) {
          console.log('## Export/Backup');
          console.log('```bash');
          console.log(`notion export db ${databaseId} --vault ~/backup --folder notion-export`);
          console.log('```\n');
        }
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
