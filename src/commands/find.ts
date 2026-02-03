/**
 * Find command - smart queries with natural language-ish syntax
 * Translates human-readable queries to Notion filters
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';

interface Page {
  id: string;
  url?: string;
  properties: Record<string, unknown>;
  created_time?: string;
  last_edited_time?: string;
}

interface Database {
  id: string;
  properties: Record<string, PropertySchema>;
}

interface PropertySchema {
  type: string;
  [key: string]: unknown;
}

interface SelectOption {
  name: string;
}

interface StatusData {
  options?: SelectOption[];
}

// Parse natural language query into filter components
function parseQuery(query: string): {
  statusFilter?: string;
  assigneeFilter?: string;
  dateFilter?: { type: string; value?: string };
  textSearch?: string;
  tagFilter?: string[];
  priorityFilter?: string;
} {
  const result: ReturnType<typeof parseQuery> = {};
  const lowerQuery = query.toLowerCase();
  
  // Status patterns
  const statusPatterns: Record<string, string[]> = {
    'done': ['done', 'completed', 'finished', 'hecho', 'terminado', 'completado'],
    'in progress': ['in progress', 'doing', 'working', 'en marcha', 'en progreso', 'haciendo'],
    'todo': ['todo', 'to do', 'pending', 'not started', 'por hacer', 'pendiente', 'por empezar'],
    'blocked': ['blocked', 'stuck', 'bloqueado'],
    'review': ['review', 'reviewing', 'en revisión', 'por revisar'],
    'archived': ['archived', 'archivado'],
  };
  
  for (const [status, patterns] of Object.entries(statusPatterns)) {
    if (patterns.some(p => lowerQuery.includes(p))) {
      result.statusFilter = status;
      break;
    }
  }
  
  // Unassigned pattern
  if (lowerQuery.includes('unassigned') || lowerQuery.includes('sin asignar') || 
      lowerQuery.includes('no assignee') || lowerQuery.includes('sin asignar')) {
    result.assigneeFilter = 'empty';
  }
  
  // Date patterns
  if (lowerQuery.includes('overdue') || lowerQuery.includes('vencid') || 
      lowerQuery.includes('past due') || lowerQuery.includes('atrasad')) {
    result.dateFilter = { type: 'before', value: new Date().toISOString().split('T')[0] };
  } else if (lowerQuery.includes('today') || lowerQuery.includes('hoy')) {
    result.dateFilter = { type: 'equals', value: new Date().toISOString().split('T')[0] };
  } else if (lowerQuery.includes('this week') || lowerQuery.includes('esta semana')) {
    result.dateFilter = { type: 'this_week' };
  } else if (lowerQuery.includes('modified today') || lowerQuery.includes('modificad') && lowerQuery.includes('hoy')) {
    result.dateFilter = { type: 'last_edited_today' };
  } else if (lowerQuery.includes('created today') || lowerQuery.includes('cread') && lowerQuery.includes('hoy')) {
    result.dateFilter = { type: 'created_today' };
  }
  
  // Priority patterns
  const priorityPatterns: Record<string, string[]> = {
    'high': ['high priority', 'urgent', 'alta', 'urgente', 'importante'],
    'medium': ['medium priority', 'normal', 'media'],
    'low': ['low priority', 'baja'],
  };
  
  for (const [priority, patterns] of Object.entries(priorityPatterns)) {
    if (patterns.some(p => lowerQuery.includes(p))) {
      result.priorityFilter = priority;
      break;
    }
  }
  
  // Tag patterns (words after "tagged" or "with tag")
  const tagMatch = query.match(/(?:tagged?|with tags?|etiqueta)\s+["']?([^"']+)["']?/i);
  if (tagMatch) {
    result.tagFilter = tagMatch[1].split(/[,\s]+/).filter(Boolean);
  }
  
  return result;
}

// Find the best matching property in the schema
function findProperty(
  properties: Record<string, PropertySchema>,
  types: string[],
  nameHints: string[]
): string | null {
  // First try exact name matches
  for (const hint of nameHints) {
    const lowerHint = hint.toLowerCase();
    for (const [name, prop] of Object.entries(properties)) {
      if (name.toLowerCase() === lowerHint && types.includes(prop.type)) {
        return name;
      }
    }
  }
  
  // Then try partial matches
  for (const hint of nameHints) {
    const lowerHint = hint.toLowerCase();
    for (const [name, prop] of Object.entries(properties)) {
      if (name.toLowerCase().includes(lowerHint) && types.includes(prop.type)) {
        return name;
      }
    }
  }
  
  // Finally just find first property of matching type
  for (const [name, prop] of Object.entries(properties)) {
    if (types.includes(prop.type)) {
      return name;
    }
  }
  
  return null;
}

// Find best matching status value
function findStatusValue(
  properties: Record<string, PropertySchema>,
  statusPropName: string,
  targetStatus: string
): string | null {
  const prop = properties[statusPropName];
  if (!prop || (prop.type !== 'status' && prop.type !== 'select')) {
    return null;
  }
  
  const data = prop[prop.type] as StatusData;
  const options = data?.options || [];
  
  const lowerTarget = targetStatus.toLowerCase();
  
  // Try exact match first
  for (const opt of options) {
    if (opt.name.toLowerCase() === lowerTarget) {
      return opt.name;
    }
  }
  
  // Try partial match
  for (const opt of options) {
    if (opt.name.toLowerCase().includes(lowerTarget) || 
        lowerTarget.includes(opt.name.toLowerCase())) {
      return opt.name;
    }
  }
  
  // Map common terms
  const statusMappings: Record<string, string[]> = {
    'done': ['done', 'complete', 'finished', 'hecho', 'terminado'],
    'in progress': ['progress', 'doing', 'working', 'marcha', 'curso'],
    'todo': ['todo', 'start', 'pending', 'empezar', 'pendiente'],
  };
  
  for (const [, variants] of Object.entries(statusMappings)) {
    if (variants.some(v => lowerTarget.includes(v))) {
      for (const opt of options) {
        if (variants.some(v => opt.name.toLowerCase().includes(v))) {
          return opt.name;
        }
      }
    }
  }
  
  return null;
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

export function registerFindCommand(program: Command): void {
  program
    .command('find <query>')
    .description('Smart query with natural language (e.g., "overdue tasks unassigned")')
    .requiredOption('-d, --database <id>', 'Database ID to search')
    .option('-l, --limit <number>', 'Max results', '20')
    .option('--explain', 'Show the generated filter without executing')
    .option('-j, --json', 'Output raw JSON')
    .option('--llm', 'LLM-friendly output')
    .action(async (query: string, options) => {
      try {
        const client = getClient();
        
        // Get database schema first
        const db = await client.get(`databases/${options.database}`) as Database;
        const schema = db.properties;
        
        // Parse the query
        const parsed = parseQuery(query);
        
        // Build filter
        const filters: Record<string, unknown>[] = [];
        
        // Status filter
        if (parsed.statusFilter) {
          const statusProp = findProperty(schema, ['status', 'select'], 
            ['status', 'estado', 'state']);
          if (statusProp) {
            const statusValue = findStatusValue(schema, statusProp, parsed.statusFilter);
            if (statusValue) {
              const propType = schema[statusProp].type;
              filters.push({
                property: statusProp,
                [propType]: { equals: statusValue },
              });
            }
          }
        }
        
        // Assignee filter
        if (parsed.assigneeFilter === 'empty') {
          const assigneeProp = findProperty(schema, ['people'], 
            ['assignee', 'asignado', 'owner', 'responsible', 'assigned']);
          if (assigneeProp) {
            filters.push({
              property: assigneeProp,
              people: { is_empty: true },
            });
          }
        }
        
        // Date filter (deadline/due)
        if (parsed.dateFilter) {
          const dateProp = findProperty(schema, ['date'], 
            ['deadline', 'due', 'fecha', 'date', 'vencimiento', 'due date']);
          
          if (dateProp && parsed.dateFilter.type !== 'last_edited_today' && 
              parsed.dateFilter.type !== 'created_today') {
            if (parsed.dateFilter.type === 'this_week') {
              filters.push({
                property: dateProp,
                date: { this_week: {} },
              });
            } else if (parsed.dateFilter.value) {
              filters.push({
                property: dateProp,
                date: { [parsed.dateFilter.type]: parsed.dateFilter.value },
              });
            }
          }
          
          // Handle last_edited filter (uses timestamp property)
          if (parsed.dateFilter.type === 'last_edited_today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            filters.push({
              timestamp: 'last_edited_time',
              last_edited_time: { on_or_after: today.toISOString() },
            });
          }
          
          if (parsed.dateFilter.type === 'created_today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            filters.push({
              timestamp: 'created_time',
              created_time: { on_or_after: today.toISOString() },
            });
          }
        }
        
        // Priority filter
        if (parsed.priorityFilter) {
          const priorityProp = findProperty(schema, ['select'], 
            ['priority', 'prioridad', 'importance', 'importancia']);
          if (priorityProp) {
            // Find matching priority value
            const propData = schema[priorityProp].select as StatusData;
            const options = propData?.options || [];
            const match = options.find(o => 
              o.name.toLowerCase().includes(parsed.priorityFilter!.toLowerCase())
            );
            if (match) {
              filters.push({
                property: priorityProp,
                select: { equals: match.name },
              });
            }
          }
        }
        
        // Build final filter
        const filter = filters.length > 1 
          ? { and: filters }
          : filters.length === 1 
            ? filters[0]
            : undefined;
        
        // Explain mode
        if (options.explain) {
          console.log('🔍 Parsed query:', JSON.stringify(parsed, null, 2));
          console.log('\n📋 Generated filter:', JSON.stringify(filter, null, 2));
          console.log('\n💡 To execute manually:');
          console.log(`notion db query ${options.database} --filter '${JSON.stringify(filter)}'`);
          return;
        }
        
        // Execute query
        const body: Record<string, unknown> = {
          page_size: parseInt(options.limit, 10),
        };
        if (filter) body.filter = filter;
        
        const result = await client.post(`databases/${options.database}/query`, body) as {
          results: Page[];
          has_more: boolean;
        };
        
        // Output
        if (options.json) {
          console.log(formatOutput(result));
          return;
        }
        
        if (options.llm) {
          console.log(`## Found ${result.results.length} results for: "${query}"\n`);
          if (filter) {
            console.log(`Filter applied: \`${JSON.stringify(filter)}\`\n`);
          }
          
          result.results.forEach((page, i) => {
            const title = getPageTitle(page);
            console.log(`${i + 1}. **${title}**`);
            console.log(`   ID: ${page.id}`);
            if (page.url) console.log(`   URL: ${page.url}`);
          });
          
          if (result.has_more) {
            console.log(`\n*More results available*`);
          }
          return;
        }
        
        // Standard output
        console.log(`Found ${result.results.length} results for: "${query}"\n`);
        
        if (result.results.length === 0) {
          console.log('No matching entries found.');
          return;
        }
        
        for (const page of result.results) {
          const title = getPageTitle(page);
          console.log(`📄 ${title}`);
          console.log(`   ID: ${page.id}`);
          if (page.url) console.log(`   URL: ${page.url}`);
          console.log('');
        }
        
        if (result.has_more) {
          console.log(`More results available. Use --limit to fetch more.`);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
