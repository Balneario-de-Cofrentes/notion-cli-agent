/**
 * Batch command - execute multiple operations in one call
 * Optimized for AI agents to reduce tool calls
 */
import { Command } from 'commander';
import { getClient, NotionClient } from '../client.js';
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
  durationMs?: number;
}

async function executeOperation(client: NotionClient, op: BatchOperation): Promise<unknown> {
  switch (op.op) {
    case 'get':
      if (op.type === 'page') return client.get(`pages/${op.id}`);
      if (op.type === 'database') return client.get(`databases/${op.id}`);
      if (op.type === 'block') return client.get(`blocks/${op.id}`);
      break;

    case 'create':
      if (op.type === 'page') {
        return client.post('pages', {
          parent: op.data?.parent_type === 'page'
            ? { page_id: op.parent }
            : { database_id: op.parent },
          properties: op.data?.properties || {},
          children: op.data?.children || [],
        });
      }
      if (op.type === 'database') {
        return client.post('databases', {
          parent: { page_id: op.parent },
          title: op.data?.title || [],
          properties: op.data?.properties || {},
        });
      }
      break;

    case 'update':
      if (op.type === 'page') return client.patch(`pages/${op.id}`, op.data || {});
      if (op.type === 'database') return client.patch(`databases/${op.id}`, op.data || {});
      if (op.type === 'block') return client.patch(`blocks/${op.id}`, op.data || {});
      break;

    case 'delete':
      if (op.type === 'block') return client.delete(`blocks/${op.id}`);
      return client.patch(`pages/${op.id}`, { archived: true });

    case 'query':
      if (op.type === 'database') {
        return client.post(`databases/${op.id}/query`, op.data || {});
      }
      break;

    case 'append':
      if (op.type === 'block') {
        return client.patch(`blocks/${op.id}/children`, {
          children: op.data?.children || [],
        });
      }
      break;

    default:
      throw new Error(`Unknown operation: ${op.op}`);
  }
}

async function runWithConcurrency(
  operations: BatchOperation[],
  client: NotionClient,
  concurrency: number,
  stopOnError: boolean,
): Promise<{ results: BatchResult[]; succeeded: number; failed: number }> {
  const results: BatchResult[] = new Array(operations.length);
  let succeeded = 0;
  let failed = 0;
  let stopped = false;

  // Process in chunks of `concurrency` size
  for (let start = 0; start < operations.length && !stopped; start += concurrency) {
    const chunk = operations.slice(start, start + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map(async (op, chunkIdx) => {
        const index = start + chunkIdx;
        const startTime = Date.now();

        try {
          const result = await executeOperation(client, op);
          return {
            index,
            op: `${op.op} ${op.type}`,
            success: true,
            result,
            durationMs: Date.now() - startTime,
          } as BatchResult;
        } catch (error) {
          return {
            index,
            op: `${op.op} ${op.type}`,
            success: false,
            error: (error as Error).message,
            durationMs: Date.now() - startTime,
          } as BatchResult;
        }
      })
    );

    for (const settled of chunkResults) {
      const result = settled.status === 'fulfilled'
        ? settled.value
        : { index: 0, op: 'unknown', success: false, error: 'Unexpected failure' } as BatchResult;

      results[result.index] = result;

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        if (stopOnError) {
          stopped = true;
        }
      }
    }
  }

  return { results: results.filter(Boolean), succeeded, failed };
}

export function registerBatchCommand(program: Command): void {
  program
    .command('batch')
    .description('Execute multiple operations in one command (for AI agents)')
    .option('-f, --file <path>', 'Read operations from JSON file')
    .option('-d, --data <json>', 'Operations as JSON string')
    .option('--dry-run', 'Show what would be done without executing')
    .option('--stop-on-error', 'Stop execution on first error')
    .option('--sequential', 'Execute operations one at a time')
    .option('-c, --concurrency <number>', 'Max parallel operations (default: 3)', '3')
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
        const concurrency = (options.sequential || options.stopOnError) ? 1 : parseInt(options.concurrency, 10);

        const { results, succeeded, failed } = await runWithConcurrency(
          operations, client, concurrency, options.stopOnError
        );

        // Output results
        if (options.llm) {
          console.log(`## Batch Results: ${succeeded}/${operations.length} succeeded\n`);

          results.forEach(r => {
            const status = r.success ? '✅' : '❌';
            const timing = r.durationMs !== undefined ? ` (${r.durationMs}ms)` : '';
            console.log(`${status} [${r.index}] ${r.op}${timing}`);
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
