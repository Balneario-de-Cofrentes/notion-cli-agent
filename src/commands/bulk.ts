/**
 * Bulk commands - mass operations on databases
 * Update or archive multiple entries at once
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { parseFilter, parseProperties, propsIncludePeople } from '../utils/format.js';
import { loadPeopleDirectory } from '../utils/people-resolver.js';
import { getPageTitle, buildTrashPayload } from '../utils/notion-helpers.js';
import { getDatabaseSchema, queryDatabase } from '../utils/database-resolver.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { resolveDatabaseInput } from '../utils/workspace-resolver.js';
import type { Page, Database, PropertySchema, PaginatedResponse } from '../types/notion.js';

// Parse simple where clause: "Status=Done,Priority=High"
function parseWhereClause(
  where: string,
  schema: Record<string, PropertySchema>
): Record<string, unknown> | null {
  const conditions = where.split(',').map(c => c.trim()).filter(Boolean);
  
  if (conditions.length === 0) return null;
  
  const filters: Record<string, unknown>[] = [];
  
  for (const condition of conditions) {
    // Support operators: =, !=, <, >, contains
    let match = condition.match(/^([^=!<>]+)(=|!=|<|>|<=|>=)(.+)$/);
    
    if (!match) continue;
    
    const [, propName, operator, value] = match;
    const trimmedName = propName.trim();
    const trimmedValue = value.trim();
    
    // Find property in schema
    const schemaProp = schema[trimmedName];
    if (!schemaProp) {
      console.warn(`Warning: Property "${trimmedName}" not found in schema`);
      continue;
    }
    
    // Build filter based on type
    const propType = schemaProp.type;
    let filterType: string;
    let filterValue: unknown = trimmedValue;
    
    switch (operator) {
      case '=':
        filterType = 'equals';
        break;
      case '!=':
        filterType = 'does_not_equal';
        break;
      case '<':
        filterType = propType === 'date' ? 'before' : 'less_than';
        break;
      case '>':
        filterType = propType === 'date' ? 'after' : 'greater_than';
        break;
      case '<=':
        filterType = propType === 'date' ? 'on_or_before' : 'less_than_or_equal_to';
        break;
      case '>=':
        filterType = propType === 'date' ? 'on_or_after' : 'greater_than_or_equal_to';
        break;
      default:
        filterType = 'equals';
    }
    
    // Handle number conversion
    if (propType === 'number') {
      filterValue = parseFloat(trimmedValue);
    }
    
    // Handle checkbox
    if (propType === 'checkbox') {
      filterValue = trimmedValue.toLowerCase() === 'true';
    }
    
    // Build the filter
    const filter: Record<string, unknown> = { property: trimmedName };
    filter[propType] = { [filterType]: filterValue };
    
    filters.push(filter);
  }
  
  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

export function registerBulkCommand(program: Command): void {
  const bulk = program
    .command('bulk')
    .description('Bulk operations on databases');

  // Bulk update
  bulk
    .command('update <database_id>')
    .description('Update multiple entries matching a condition')
    .requiredOption('--where <condition>', 'Filter condition (e.g., "Status=Todo")')
    .requiredOption('--set <properties>', 'Properties to set (e.g., "Status=Done,Priority=Low")')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('--limit <number>', 'Max entries to update', '100')
    .option('--yes', 'Skip confirmation')
    .action(withErrorHandler(async (databaseId: string, options) => {
      databaseId = resolveDatabaseInput(databaseId);
      const client = getClient();

      // Get database schema
      const db = await getDatabaseSchema(client, databaseId);

      // Parse where clause
      const filter = parseWhereClause(options.where, db.properties);

      if (!filter) {
        console.error('Error: Invalid --where clause');
        process.exit(1);
      }

      // Parse set clause — type via schema, resolve people by email/name (members + guests)
      const setSchemaTypes = Object.fromEntries(
        Object.entries(db.properties).map(([name, prop]) => [name, prop.type])
      );
      const setProps = options.set.split(',').map((s: string) => s.trim());
      const peopleDirectory = propsIncludePeople(setProps, setSchemaTypes)
        ? await loadPeopleDirectory(client)
        : undefined;
      const setProperties = parseProperties(setProps, setSchemaTypes, peopleDirectory);

      // Query matching entries
      const result = await queryDatabase<PaginatedResponse<Page>>(client, databaseId, {
        filter,
        page_size: parseInt(options.limit, 10),
      });
        
        if (result.results.length === 0) {
          console.log('No entries match the condition.');
          return;
        }
        
        console.log(`Found ${result.results.length} matching entries${result.has_more ? ' (more available)' : ''}`);
        
        // Show preview
        if (options.dryRun || !options.yes) {
          console.log('\nEntries to update:');
          for (const page of result.results.slice(0, 10)) {
            console.log(`  - ${getPageTitle(page)} (${page.id.slice(0, 8)}...)`);
          }
          if (result.results.length > 10) {
            console.log(`  ... and ${result.results.length - 10} more`);
          }
          
          console.log('\nChanges to apply:');
          for (const [key, value] of Object.entries(setProperties)) {
            console.log(`  ${key} → ${JSON.stringify(value)}`);
          }
        }
        
        if (options.dryRun) {
          console.log('\n🔍 Dry run - no changes made');
          return;
        }
        
        if (!options.yes) {
          console.log('\nUse --yes to execute, or --dry-run to preview');
          return;
        }
        
        // Execute updates
        let updated = 0;
        let failed = 0;
        
        for (const page of result.results) {
          try {
            await client.patch(`pages/${page.id}`, { properties: setProperties });
            updated++;
            process.stdout.write(`\r✅ Updated ${updated}/${result.results.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed to update ${page.id}: ${(error as Error).message}`);
          }
        }
        
        console.log(`\n\n✅ Updated ${updated} entries${failed > 0 ? `, ${failed} failed` : ''}`);
    }));

  // Bulk archive
  bulk
    .command('archive <database_id>')
    .description('Archive multiple entries matching a condition')
    .requiredOption('--where <condition>', 'Filter condition (e.g., "Status=Done")')
    .option('--dry-run', 'Show what would be archived without making changes')
    .option('--limit <number>', 'Max entries to archive', '100')
    .option('--yes', 'Skip confirmation')
    .action(withErrorHandler(async (databaseId: string, options) => {
      databaseId = resolveDatabaseInput(databaseId);
      const client = getClient();

      // Get database schema
      const db = await getDatabaseSchema(client, databaseId);

      // Parse where clause
      const filter = parseWhereClause(options.where, db.properties);

      if (!filter) {
        console.error('Error: Invalid --where clause');
        process.exit(1);
      }

      // Query matching entries
      const result = await queryDatabase<PaginatedResponse<Page>>(client, databaseId, {
        filter,
        page_size: parseInt(options.limit, 10),
      });
        
        if (result.results.length === 0) {
          console.log('No entries match the condition.');
          return;
        }
        
        console.log(`Found ${result.results.length} matching entries${result.has_more ? ' (more available)' : ''}`);
        
        // Show preview
        if (options.dryRun || !options.yes) {
          console.log('\nEntries to archive:');
          for (const page of result.results.slice(0, 10)) {
            console.log(`  - ${getPageTitle(page)} (${page.id.slice(0, 8)}...)`);
          }
          if (result.results.length > 10) {
            console.log(`  ... and ${result.results.length - 10} more`);
          }
        }
        
        if (options.dryRun) {
          console.log('\n🔍 Dry run - no changes made');
          return;
        }
        
        if (!options.yes) {
          console.log('\nUse --yes to execute, or --dry-run to preview');
          return;
        }
        
        // Execute archival
        let archived = 0;
        let failed = 0;
        
        for (const page of result.results) {
          try {
            await client.patch(`pages/${page.id}`, buildTrashPayload(true));
            archived++;
            process.stdout.write(`\r🗑️ Archived ${archived}/${result.results.length}...`);
          } catch (error) {
            failed++;
            console.error(`\n❌ Failed to archive ${page.id}: ${(error as Error).message}`);
          }
        }
        
        console.log(`\n\n✅ Archived ${archived} entries${failed > 0 ? `, ${failed} failed` : ''}`);
    }));

  // Bulk delete (really archive, Notion doesn't have true delete)
  bulk
    .command('delete <database_id>')
    .description('Delete (archive) multiple entries matching a condition')
    .requiredOption('--where <condition>', 'Filter condition')
    .option('--dry-run', 'Show what would be deleted without making changes')
    .option('--limit <number>', 'Max entries to delete', '100')
    .option('--yes', 'Skip confirmation (DANGEROUS)')
    .action(async (databaseId: string, options) => {
      // Alias for archive
      console.log('Note: Notion does not support permanent deletion. Entries will be archived.\n');
      
      // Re-run as archive
      const archiveCmd = bulk.commands.find(c => c.name() === 'archive');
      if (archiveCmd) {
        await archiveCmd.parseAsync([
          'archive', databaseId,
          '--where', options.where,
          ...(options.dryRun ? ['--dry-run'] : []),
          ...(options.limit ? ['--limit', options.limit] : []),
          ...(options.yes ? ['--yes'] : []),
        ], { from: 'user' });
      }
    });
}
