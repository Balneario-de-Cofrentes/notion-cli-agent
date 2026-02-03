/**
 * Batch command - execute multiple operations in one call
 * Optimized for AI agents to reduce tool calls
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';

interface BatchOperation {
  op: 'get' | 'create' | 'update' | 'delete' | 'query' | 'append';
  type: 'page' | 'database' | 'block';
  id?: string;
  parent?: string;
  data?: Record<string, unknown>;
}

interface BatchResult {
  index: number;
  op: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export function registerBatchCommand(program: Command): void {
  program
    .command('batch')
    .description('Execute multiple operations in one command (for AI agents)')
    .option('-f, --file <path>', 'Read operations from JSON file')
    .option('-d, --data <json>', 'Operations as JSON string')
    .option('--dry-run', 'Show what would be done without executing')
    .option('--stop-on-error', 'Stop execution on first error')
    .option('--llm', 'Output in LLM-friendly format')
    .action(async (options) => {
      try {
        let operations: BatchOperation[];
        
        if (options.file) {
          const fs = await import('fs');
          const content = fs.readFileSync(options.file, 'utf-8');
          operations = JSON.parse(content);
        } else if (options.data) {
          operations = JSON.parse(options.data);
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const input = Buffer.concat(chunks).toString('utf-8');
          operations = JSON.parse(input);
        }
        
        if (!Array.isArray(operations)) {
          operations = [operations];
        }
        
        if (options.dryRun) {
          console.log('🔍 Dry run - would execute:');
          operations.forEach((op, i) => {
            console.log(`  ${i + 1}. ${op.op} ${op.type} ${op.id || op.parent || ''}`);
          });
          console.log(`\nTotal: ${operations.length} operations`);
          return;
        }
        
        const client = getClient();
        const results: BatchResult[] = [];
        let succeeded = 0;
        let failed = 0;
        
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];
          const result: BatchResult = {
            index: i,
            op: `${op.op} ${op.type}`,
            success: false,
          };
          
          try {
            switch (op.op) {
              case 'get':
                if (op.type === 'page') {
                  result.result = await client.get(`pages/${op.id}`);
                } else if (op.type === 'database') {
                  result.result = await client.get(`databases/${op.id}`);
                } else if (op.type === 'block') {
                  result.result = await client.get(`blocks/${op.id}`);
                }
                break;
              
              case 'create':
                if (op.type === 'page') {
                  const pageData = {
                    parent: op.data?.parent_type === 'page' 
                      ? { page_id: op.parent }
                      : { database_id: op.parent },
                    properties: op.data?.properties || {},
                    children: op.data?.children || [],
                  };
                  result.result = await client.post('pages', pageData);
                } else if (op.type === 'database') {
                  const dbData = {
                    parent: { page_id: op.parent },
                    title: op.data?.title || [],
                    properties: op.data?.properties || {},
                  };
                  result.result = await client.post('databases', dbData);
                }
                break;
              
              case 'update':
                if (op.type === 'page') {
                  result.result = await client.patch(`pages/${op.id}`, op.data || {});
                } else if (op.type === 'database') {
                  result.result = await client.patch(`databases/${op.id}`, op.data || {});
                } else if (op.type === 'block') {
                  result.result = await client.patch(`blocks/${op.id}`, op.data || {});
                }
                break;
              
              case 'delete':
                if (op.type === 'block') {
                  result.result = await client.delete(`blocks/${op.id}`);
                } else {
                  // Pages use archive
                  result.result = await client.patch(`pages/${op.id}`, { archived: true });
                }
                break;
              
              case 'query':
                if (op.type === 'database') {
                  result.result = await client.post(`databases/${op.id}/query`, op.data || {});
                }
                break;
              
              case 'append':
                if (op.type === 'block') {
                  result.result = await client.patch(`blocks/${op.id}/children`, {
                    children: op.data?.children || [],
                  });
                }
                break;
              
              default:
                throw new Error(`Unknown operation: ${op.op}`);
            }
            
            result.success = true;
            succeeded++;
          } catch (error) {
            result.error = (error as Error).message;
            failed++;
            
            if (options.stopOnError) {
              results.push(result);
              break;
            }
          }
          
          results.push(result);
        }
        
        // Output results
        if (options.llm) {
          // LLM-friendly format
          console.log(`## Batch Results: ${succeeded}/${operations.length} succeeded\n`);
          
          results.forEach(r => {
            const status = r.success ? '✅' : '❌';
            console.log(`${status} [${r.index}] ${r.op}`);
            if (r.error) {
              console.log(`   Error: ${r.error}`);
            } else if (r.result) {
              const res = r.result as { id?: string; url?: string };
              if (res.id) console.log(`   ID: ${res.id}`);
              if (res.url) console.log(`   URL: ${res.url}`);
            }
          });
          
          if (failed > 0) {
            console.log(`\n⚠️ ${failed} operations failed`);
          }
        } else {
          console.log(formatOutput({
            summary: { total: operations.length, succeeded, failed },
            results,
          }));
        }
        
        // Exit with error code if any failed
        if (failed > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
