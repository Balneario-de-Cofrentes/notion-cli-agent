/**
 * Inspect commands - workspace introspection for AI agents
 * Helps agents understand the structure of a Notion workspace
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';

interface Database {
  id: string;
  title: { plain_text: string }[];
  description?: { plain_text: string }[];
  properties: Record<string, PropertySchema>;
  url?: string;
}

interface PropertySchema {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

interface StatusGroup {
  id: string;
  name: string;
  option_ids: string[];
}

function getDbTitle(db: Database): string {
  return db.title?.map(t => t.plain_text).join('') || 'Untitled';
}

function getDbDescription(db: Database): string {
  return db.description?.map(t => t.plain_text).join('') || '';
}

function formatPropertyType(prop: PropertySchema): string {
  const type = prop.type;
  const data = prop[type] as Record<string, unknown> | undefined;
  
  switch (type) {
    case 'select':
    case 'multi_select': {
      const options = (data?.options as SelectOption[]) || [];
      if (options.length === 0) return type;
      const optionNames = options.map(o => o.name).slice(0, 5);
      const more = options.length > 5 ? ` +${options.length - 5} more` : '';
      return `${type} [${optionNames.join(', ')}${more}]`;
    }
    
    case 'status': {
      const options = (data?.options as SelectOption[]) || [];
      const groups = (data?.groups as StatusGroup[]) || [];
      if (options.length === 0) return type;
      
      // Group options by their group
      const groupedOptions: string[] = [];
      for (const group of groups) {
        const groupOptions = options
          .filter(o => group.option_ids.includes(o.id))
          .map(o => o.name);
        if (groupOptions.length > 0) {
          groupedOptions.push(`${group.name}: ${groupOptions.join(', ')}`);
        }
      }
      return `status {${groupedOptions.join(' | ')}}`;
    }
    
    case 'relation': {
      const relatedDb = (data?.database_id as string) || 'unknown';
      return `relation → ${relatedDb.slice(0, 8)}...`;
    }
    
    case 'rollup': {
      const rollupProp = (data?.rollup_property_name as string) || '';
      const relationProp = (data?.relation_property_name as string) || '';
      return `rollup(${relationProp}.${rollupProp})`;
    }
    
    case 'formula': {
      return 'formula';
    }
    
    default:
      return type;
  }
}

export function registerInspectCommand(program: Command): void {
  const inspect = program
    .command('inspect')
    .description('Inspect workspace structure (for AI agents)');

  // List all accessible databases
  inspect
    .command('workspace')
    .alias('ws')
    .description('List all accessible databases with their schemas')
    .option('-l, --limit <number>', 'Max databases to show', '20')
    .option('-j, --json', 'Output raw JSON')
    .option('--compact', 'Compact output (names only)')
    .action(async (options) => {
      try {
        const client = getClient();
        
        // Search for all databases
        const result = await client.post('search', {
          filter: { property: 'object', value: 'database' },
          page_size: parseInt(options.limit, 10),
        }) as { results: Database[] };
        
        if (options.json) {
          console.log(formatOutput(result.results));
          return;
        }
        
        console.log(`Found ${result.results.length} accessible database(s):\n`);
        
        for (const db of result.results) {
          const title = getDbTitle(db);
          const desc = getDbDescription(db);
          
          if (options.compact) {
            console.log(`📊 ${title} (${db.id.slice(0, 8)}...)`);
            continue;
          }
          
          console.log(`📊 ${title}`);
          console.log(`   ID: ${db.id}`);
          if (desc) console.log(`   Description: ${desc}`);
          
          // List properties
          const props = Object.entries(db.properties)
            .filter(([, p]) => p.type !== 'title') // Skip title, it's obvious
            .slice(0, 8);
          
          if (props.length > 0) {
            console.log('   Properties:');
            for (const [name, prop] of props) {
              console.log(`     - ${name}: ${formatPropertyType(prop)}`);
            }
            
            const totalProps = Object.keys(db.properties).length;
            if (totalProps > 9) {
              console.log(`     ... and ${totalProps - 9} more`);
            }
          }
          console.log('');
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Get detailed schema for a database
  inspect
    .command('schema <database_id>')
    .description('Get detailed schema for a database')
    .option('-j, --json', 'Output raw JSON')
    .option('--llm', 'Output optimized for LLM consumption')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        const db = await client.get(`databases/${databaseId}`) as Database;
        
        if (options.json) {
          console.log(formatOutput(db));
          return;
        }
        
        const title = getDbTitle(db);
        const desc = getDbDescription(db);
        
        if (options.llm) {
          // Compact LLM-friendly format
          console.log(`# Database: ${title}\n`);
          console.log(`ID: ${db.id}`);
          if (desc) console.log(`Description: ${desc}`);
          console.log(`\n## Properties\n`);
          
          for (const [name, prop] of Object.entries(db.properties)) {
            const typeInfo = formatPropertyType(prop);
            console.log(`- **${name}** (${typeInfo})`);
            
            // Add options for select/status
            if (prop.type === 'select' || prop.type === 'multi_select') {
              const data = prop[prop.type] as { options?: SelectOption[] };
              const opts = data?.options || [];
              if (opts.length > 0) {
                console.log(`  Options: ${opts.map(o => `"${o.name}"`).join(', ')}`);
              }
            } else if (prop.type === 'status') {
              const data = prop.status as { options?: SelectOption[]; groups?: StatusGroup[] };
              const opts = data?.options || [];
              const groups = data?.groups || [];
              
              for (const group of groups) {
                const groupOpts = opts.filter(o => group.option_ids.includes(o.id));
                if (groupOpts.length > 0) {
                  console.log(`  ${group.name}: ${groupOpts.map(o => `"${o.name}"`).join(', ')}`);
                }
              }
            }
          }
          
          console.log(`\n## Usage Examples\n`);
          console.log('```bash');
          console.log(`# Query this database`);
          console.log(`notion db query ${databaseId.slice(0, 8)}... --limit 10`);
          console.log('');
          console.log(`# Create a new entry`);
          console.log(`notion page create --parent ${databaseId.slice(0, 8)}... --title "New Item"`);
          console.log('```');
          return;
        }
        
        // Standard detailed output
        console.log(`📊 Database: ${title}`);
        console.log(`ID: ${db.id}`);
        if (db.url) console.log(`URL: ${db.url}`);
        if (desc) console.log(`Description: ${desc}`);
        console.log('\nProperties:\n');
        
        for (const [name, prop] of Object.entries(db.properties)) {
          console.log(`  ${name}`);
          console.log(`    Type: ${prop.type}`);
          console.log(`    ID: ${prop.id}`);
          
          // Show options for select/multi_select
          if (prop.type === 'select' || prop.type === 'multi_select') {
            const data = prop[prop.type] as { options?: SelectOption[] };
            const opts = data?.options || [];
            if (opts.length > 0) {
              console.log(`    Options: ${opts.map(o => o.name).join(', ')}`);
            }
          }
          
          // Show status options grouped
          if (prop.type === 'status') {
            const data = prop.status as { options?: SelectOption[]; groups?: StatusGroup[] };
            const opts = data?.options || [];
            const groups = data?.groups || [];
            
            console.log('    Status groups:');
            for (const group of groups) {
              const groupOpts = opts.filter(o => group.option_ids.includes(o.id));
              if (groupOpts.length > 0) {
                console.log(`      ${group.name}: ${groupOpts.map(o => o.name).join(', ')}`);
              }
            }
          }
          
          // Show relation info
          if (prop.type === 'relation') {
            const data = prop.relation as { database_id?: string };
            if (data?.database_id) {
              console.log(`    Related database: ${data.database_id}`);
            }
          }
          
          console.log('');
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Generate context for LLM
  inspect
    .command('context <database_id>')
    .description('Generate LLM-friendly context for a database')
    .option('--examples <number>', 'Number of example entries to include', '3')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        
        // Get database schema
        const db = await client.get(`databases/${databaseId}`) as Database;
        const title = getDbTitle(db);
        const desc = getDbDescription(db);
        
        // Get example entries
        const examples = await client.post(`databases/${databaseId}/query`, {
          page_size: parseInt(options.examples, 10),
        }) as { results: { id: string; properties: Record<string, unknown> }[] };
        
        // Generate context
        console.log(`# Notion Database Context: ${title}\n`);
        
        if (desc) {
          console.log(`> ${desc}\n`);
        }
        
        console.log(`**Database ID:** \`${databaseId}\`\n`);
        
        // Schema summary
        console.log(`## Schema\n`);
        console.log('| Property | Type | Values |');
        console.log('|----------|------|--------|');
        
        for (const [name, prop] of Object.entries(db.properties)) {
          let values = '-';
          
          if (prop.type === 'select' || prop.type === 'multi_select') {
            const data = prop[prop.type] as { options?: SelectOption[] };
            const opts = data?.options || [];
            if (opts.length > 0) {
              values = opts.slice(0, 5).map(o => o.name).join(', ');
              if (opts.length > 5) values += '...';
            }
          } else if (prop.type === 'status') {
            const data = prop.status as { options?: SelectOption[] };
            const opts = data?.options || [];
            if (opts.length > 0) {
              values = opts.map(o => o.name).join(', ');
            }
          }
          
          console.log(`| ${name} | ${prop.type} | ${values} |`);
        }
        
        // Example entries
        if (examples.results.length > 0) {
          console.log(`\n## Example Entries\n`);
          
          for (let i = 0; i < examples.results.length; i++) {
            const entry = examples.results[i];
            console.log(`### Entry ${i + 1}`);
            console.log(`ID: ${entry.id}\n`);
            
            for (const [name, value] of Object.entries(entry.properties)) {
              const prop = value as { type: string; [key: string]: unknown };
              const data = prop[prop.type];
              
              let displayValue = '-';
              
              switch (prop.type) {
                case 'title':
                case 'rich_text': {
                  const texts = data as { plain_text: string }[];
                  displayValue = texts?.map(t => t.plain_text).join('') || '-';
                  break;
                }
                case 'select':
                case 'status': {
                  displayValue = (data as { name?: string })?.name || '-';
                  break;
                }
                case 'multi_select': {
                  const items = data as { name: string }[];
                  displayValue = items?.map(i => i.name).join(', ') || '-';
                  break;
                }
                case 'number':
                case 'checkbox':
                  displayValue = String(data ?? '-');
                  break;
                case 'date': {
                  const dateData = data as { start?: string } | null;
                  displayValue = dateData?.start || '-';
                  break;
                }
                case 'url':
                case 'email':
                case 'phone_number':
                  displayValue = String(data || '-');
                  break;
              }
              
              if (displayValue && displayValue !== '-') {
                console.log(`- **${name}:** ${displayValue}`);
              }
            }
            console.log('');
          }
        }
        
        // Usage hints
        console.log(`## Quick Commands\n`);
        console.log('```bash');
        console.log(`# Query all entries`);
        console.log(`notion db query ${databaseId}`);
        console.log('');
        console.log(`# Filter by status (if applicable)`);
        console.log(`notion db query ${databaseId} --filter-prop "Status" --filter-type equals --filter-value "Done" --filter-prop-type status`);
        console.log('');
        console.log(`# Create new entry`);
        console.log(`notion page create --parent ${databaseId} --title "New Entry"`);
        console.log('```');
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
