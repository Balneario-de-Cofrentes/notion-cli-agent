/**
 * Validate and lint commands - data integrity checks
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';

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
  properties: Record<string, PropertySchema>;
}

interface PropertySchema {
  type: string;
  [key: string]: unknown;
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  pageId?: string;
  pageTitle?: string;
  property?: string;
  suggestion?: string;
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

function getPropertyValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string;
  return prop[type];
}

function isPropertyEmpty(prop: Record<string, unknown>): boolean {
  const type = prop.type as string;
  const value = prop[type];
  
  if (value === null || value === undefined) return true;
  
  switch (type) {
    case 'title':
    case 'rich_text':
      return !Array.isArray(value) || value.length === 0 || 
             !(value as { plain_text: string }[])[0]?.plain_text;
    case 'select':
    case 'status':
      return !(value as { name?: string })?.name;
    case 'multi_select':
    case 'people':
    case 'files':
    case 'relation':
      return !Array.isArray(value) || value.length === 0;
    case 'date':
      return !(value as { start?: string })?.start;
    case 'number':
      return value === null;
    case 'checkbox':
      return false; // Checkbox is never "empty"
    case 'url':
    case 'email':
    case 'phone_number':
      return !value;
    default:
      return !value;
  }
}

export function registerValidateCommand(program: Command): void {
  const validate = program
    .command('validate')
    .description('Validate database integrity and find issues');

  // Full validation
  validate
    .command('check <database_id>')
    .alias('run')
    .description('Run full validation on a database')
    .option('--required <props>', 'Comma-separated list of required properties')
    .option('--check-dates', 'Check for overdue items')
    .option('--check-stale <days>', 'Flag items not updated in N days')
    .option('-j, --json', 'Output as JSON')
    .option('--fix', 'Show fix suggestions')
    .action(async (databaseId: string, options) => {
      try {
        const client = getClient();
        const issues: ValidationIssue[] = [];
        
        // Get database schema
        const db = await client.get(`databases/${databaseId}`) as Database;
        const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
        
        console.log(`🔍 Validating database: ${dbTitle}\n`);
        
        // Determine required properties
        const requiredProps = options.required 
          ? options.required.split(',').map((p: string) => p.trim())
          : [];
        
        // Find status and date properties
        let statusProp = '';
        let dateProp = '';
        
        for (const [name, schema] of Object.entries(db.properties)) {
          if (schema.type === 'status') statusProp = name;
          if (schema.type === 'date' && name.toLowerCase().includes('deadline')) {
            dateProp = name;
          }
        }
        
        // Query all entries
        const entries: Page[] = [];
        let cursor: string | undefined;
        
        do {
          const body: Record<string, unknown> = { page_size: 100 };
          if (cursor) body.start_cursor = cursor;
          
          const result = await client.post(`databases/${databaseId}/query`, body) as {
            results: Page[];
            has_more: boolean;
            next_cursor?: string;
          };
          
          entries.push(...result.results);
          cursor = result.has_more ? result.next_cursor : undefined;
          
          process.stdout.write(`\rFetching: ${entries.length} entries...`);
        } while (cursor);
        
        console.log(`\rAnalyzing ${entries.length} entries...      \n`);
        
        const now = new Date();
        const staleThreshold = options.checkStale 
          ? new Date(now.getTime() - parseInt(options.checkStale, 10) * 24 * 60 * 60 * 1000)
          : null;
        
        // Validate each entry
        for (const entry of entries) {
          const title = getPageTitle(entry);
          
          // Check for empty title
          const titleProp = Object.entries(entry.properties)
            .find(([, p]) => (p as { type: string }).type === 'title');
          
          if (titleProp && isPropertyEmpty(titleProp[1] as Record<string, unknown>)) {
            issues.push({
              severity: 'error',
              type: 'empty_title',
              message: 'Entry has no title',
              pageId: entry.id,
              pageTitle: '(untitled)',
            });
          }
          
          // Check required properties
          for (const propName of requiredProps) {
            const prop = entry.properties[propName];
            if (!prop || isPropertyEmpty(prop as Record<string, unknown>)) {
              issues.push({
                severity: 'warning',
                type: 'missing_required',
                message: `Missing required property: ${propName}`,
                pageId: entry.id,
                pageTitle: title,
                property: propName,
              });
            }
          }
          
          // Check for overdue items
          if (options.checkDates && dateProp && statusProp) {
            const dateValue = entry.properties[dateProp] as { date?: { start?: string } };
            const statusValue = entry.properties[statusProp] as { status?: { name?: string } };
            
            if (dateValue?.date?.start && statusValue?.status?.name) {
              const deadline = new Date(dateValue.date.start);
              const status = statusValue.status.name.toLowerCase();
              
              // Not completed and past deadline
              if (deadline < now && !['hecho', 'done', 'completed', 'archivado'].some(s => status.includes(s))) {
                issues.push({
                  severity: 'warning',
                  type: 'overdue',
                  message: `Overdue: deadline was ${dateValue.date.start}`,
                  pageId: entry.id,
                  pageTitle: title,
                  suggestion: `notion page update ${entry.id} --prop "${statusProp}=Archivado"`,
                });
              }
            }
          }
          
          // Check for stale items
          if (staleThreshold) {
            const lastEdited = new Date(entry.last_edited_time);
            const statusValue = entry.properties[statusProp] as { status?: { name?: string } } | undefined;
            const status = statusValue?.status?.name?.toLowerCase() || '';
            
            // In progress but not updated
            if (lastEdited < staleThreshold && 
                ['en marcha', 'in progress', 'doing'].some(s => status.includes(s))) {
              const daysSince = Math.floor((now.getTime() - lastEdited.getTime()) / (1000 * 60 * 60 * 24));
              issues.push({
                severity: 'info',
                type: 'stale',
                message: `Not updated in ${daysSince} days (status: ${statusValue?.status?.name})`,
                pageId: entry.id,
                pageTitle: title,
              });
            }
          }
        }
        
        // Output results
        if (options.json) {
          console.log(formatOutput({
            database: dbTitle,
            totalEntries: entries.length,
            issues,
            summary: {
              errors: issues.filter(i => i.severity === 'error').length,
              warnings: issues.filter(i => i.severity === 'warning').length,
              info: issues.filter(i => i.severity === 'info').length,
            },
          }));
          return;
        }
        
        // Group by type
        const byType: Record<string, ValidationIssue[]> = {};
        for (const issue of issues) {
          if (!byType[issue.type]) byType[issue.type] = [];
          byType[issue.type].push(issue);
        }
        
        if (issues.length === 0) {
          console.log('✅ No issues found!\n');
        } else {
          const errors = issues.filter(i => i.severity === 'error').length;
          const warnings = issues.filter(i => i.severity === 'warning').length;
          const infos = issues.filter(i => i.severity === 'info').length;
          
          console.log(`Found ${issues.length} issues: ${errors} errors, ${warnings} warnings, ${infos} info\n`);
          
          for (const [type, typeIssues] of Object.entries(byType)) {
            const icon = typeIssues[0].severity === 'error' ? '❌' :
                        typeIssues[0].severity === 'warning' ? '⚠️' : 'ℹ️';
            
            console.log(`${icon} ${type.replace(/_/g, ' ').toUpperCase()} (${typeIssues.length})`);
            
            // Show first 5
            for (const issue of typeIssues.slice(0, 5)) {
              console.log(`   - ${issue.pageTitle}: ${issue.message}`);
              if (options.fix && issue.suggestion) {
                console.log(`     Fix: ${issue.suggestion}`);
              }
            }
            
            if (typeIssues.length > 5) {
              console.log(`   ... and ${typeIssues.length - 5} more`);
            }
            console.log('');
          }
        }
        
        // Health score
        const healthScore = Math.max(0, 100 - (issues.filter(i => i.severity === 'error').length * 10) - 
                                           (issues.filter(i => i.severity === 'warning').length * 3));
        
        console.log(`\n📊 Health Score: ${healthScore}/100`);
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Quick lint
  validate
    .command('lint <database_id>')
    .description('Quick lint check for common issues')
    .action(async (databaseId: string) => {
      try {
        const client = getClient();
        
        // Get database
        const db = await client.get(`databases/${databaseId}`) as Database;
        const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
        
        console.log(`🔍 Linting: ${dbTitle}\n`);
        
        // Quick queries for common issues
        const checks: { name: string; filter: Record<string, unknown>; severity: string }[] = [];
        
        // Find properties
        let titleProp = '';
        let statusProp = '';
        
        for (const [name, schema] of Object.entries(db.properties)) {
          if (schema.type === 'title') titleProp = name;
          if (schema.type === 'status') statusProp = name;
        }
        
        // Check for entries without title
        if (titleProp) {
          checks.push({
            name: 'Empty titles',
            filter: { property: titleProp, title: { is_empty: true } },
            severity: 'error',
          });
        }
        
        // Check for old "in progress" items
        if (statusProp) {
          const statusData = db.properties[statusProp].status as { options?: { name: string }[] };
          const inProgressStatus = statusData?.options?.find(o => 
            o.name.toLowerCase().includes('marcha') || o.name.toLowerCase().includes('progress')
          );
          
          if (inProgressStatus) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            checks.push({
              name: `"${inProgressStatus.name}" for >30 days`,
              filter: {
                and: [
                  { property: statusProp, status: { equals: inProgressStatus.name } },
                  { timestamp: 'last_edited_time', last_edited_time: { before: thirtyDaysAgo.toISOString() } },
                ],
              },
              severity: 'warning',
            });
          }
        }
        
        // Run checks
        let totalIssues = 0;
        
        for (const check of checks) {
          try {
            const result = await client.post(`databases/${databaseId}/query`, {
              filter: check.filter,
              page_size: 1,
            }) as { results: Page[] };
            
            // Get actual count with a second query
            const countResult = await client.post(`databases/${databaseId}/query`, {
              filter: check.filter,
              page_size: 100,
            }) as { results: Page[] };
            
            const count = countResult.results.length;
            
            if (count > 0) {
              const icon = check.severity === 'error' ? '❌' : '⚠️';
              console.log(`${icon} ${check.name}: ${count} found`);
              totalIssues += count;
            } else {
              console.log(`✅ ${check.name}: OK`);
            }
          } catch {
            console.log(`⏭️ ${check.name}: skipped (filter not supported)`);
          }
        }
        
        console.log(`\nTotal issues: ${totalIssues}`);
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Health check
  validate
    .command('health <database_id>')
    .description('Get a health score for the database')
    .action(async (databaseId: string) => {
      try {
        const client = getClient();
        
        const db = await client.get(`databases/${databaseId}`) as Database;
        const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
        
        // Query recent entries
        const result = await client.post(`databases/${databaseId}/query`, {
          page_size: 100,
          sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        }) as { results: Page[] };
        
        const entries = result.results;
        
        // Calculate metrics
        const now = new Date();
        const recentlyEdited = entries.filter(e => {
          const edited = new Date(e.last_edited_time);
          const daysSince = (now.getTime() - edited.getTime()) / (1000 * 60 * 60 * 24);
          return daysSince <= 7;
        }).length;
        
        let completionRate = 0;
        let statusProp = '';
        
        for (const [name, schema] of Object.entries(db.properties)) {
          if (schema.type === 'status') {
            statusProp = name;
            break;
          }
        }
        
        if (statusProp) {
          const completed = entries.filter(e => {
            const status = e.properties[statusProp] as { status?: { name?: string } };
            const name = status?.status?.name?.toLowerCase() || '';
            return ['hecho', 'done', 'completed'].some(s => name.includes(s));
          }).length;
          
          completionRate = entries.length > 0 ? Math.round((completed / entries.length) * 100) : 0;
        }
        
        // Property fill rates
        const fillRates: Record<string, number> = {};
        
        for (const [propName] of Object.entries(db.properties)) {
          let filled = 0;
          for (const entry of entries) {
            const prop = entry.properties[propName];
            if (prop && !isPropertyEmpty(prop as Record<string, unknown>)) {
              filled++;
            }
          }
          fillRates[propName] = entries.length > 0 ? Math.round((filled / entries.length) * 100) : 0;
        }
        
        // Calculate health score
        const activityScore = Math.min(100, (recentlyEdited / entries.length) * 100 * 2);
        const avgFillRate = Object.values(fillRates).reduce((a, b) => a + b, 0) / Object.values(fillRates).length;
        
        const healthScore = Math.round((activityScore * 0.3) + (avgFillRate * 0.5) + (completionRate * 0.2));
        
        // Output
        console.log(`\n📊 Health Report: ${dbTitle}\n`);
        console.log(`${'═'.repeat(40)}`);
        console.log(`Health Score: ${healthScore}/100 ${healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴'}`);
        console.log(`${'═'.repeat(40)}\n`);
        
        console.log(`📈 Activity (last 7 days): ${recentlyEdited}/${entries.length} entries (${Math.round(recentlyEdited/entries.length*100)}%)`);
        console.log(`✅ Completion rate: ${completionRate}%`);
        console.log(`📝 Average fill rate: ${Math.round(avgFillRate)}%\n`);
        
        console.log('Property fill rates:');
        const sortedFillRates = Object.entries(fillRates)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 10);
        
        for (const [prop, rate] of sortedFillRates) {
          const bar = '█'.repeat(Math.ceil(rate / 10)) + '░'.repeat(10 - Math.ceil(rate / 10));
          const icon = rate >= 80 ? '✅' : rate >= 50 ? '⚠️' : '❌';
          console.log(`  ${icon} ${prop.padEnd(25)} ${bar} ${rate}%`);
        }
        
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
