/**
 * MCP server mode -- exposes notion-cli-agent as an MCP tool server over stdio.
 *
 * Usage: notion --mcp
 *
 * Reuses existing command logic via the Notion client and helpers.
 * Each tool returns JSON results directly (no console.log formatting).
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createMcpServer } from 'mcp-stdio';
import { initClient, getClient } from './client.js';
import { getDatabaseSchema, queryDatabase } from './utils/database-resolver.js';
import { resolveDatabaseInput, isNotionUUID } from './utils/workspace-resolver.js';
import { getPageTitle, getDbTitle, fetchAllBlocks, getPageMarkdown, buildTrashPayload } from './utils/notion-helpers.js';
import type { Page, PaginatedResponse, Database } from './types/notion.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

/**
 * Reject non-UUID values to prevent argument injection in subprocess argv.
 * Uses the shared UUID regex from workspace-resolver.
 */
function assertNotionId(value: unknown, label: string): string {
  const id = String(value);
  if (!isNotionUUID(id)) {
    throw new Error(`Invalid ${label}: expected a Notion UUID, got "${id}"`);
  }
  return id;
}

/**
 * Run a CLI subcommand in a child process using execFileSync (no shell).
 * Returns stdout as a string. On failure, returns a JSON error string
 * so the MCP caller always gets parseable output.
 */
function runSubcommand(args: string[], timeoutMs = 60_000): string {
  try {
    return execFileSync(process.execPath, [process.argv[1], ...args], {
      env: process.env,
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
  } catch (error) {
    const msg = (error as Error).message || 'Subcommand failed';
    // Return structured JSON so MCP consumers can parse the error
    return JSON.stringify({ error: msg });
  }
}

function ensureClient(): void {
  try {
    getClient();
  } catch {
    initClient();
  }
}

export async function startMcpServer(): Promise<void> {
  ensureClient();
  const client = getClient();

  await createMcpServer({
    name: 'notion-cli-agent',
    version,
    tools: {

      // --- Search -------------------------------------------------------

      search: {
        description: 'Search pages and databases across the workspace',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: { type: 'string', enum: ['page', 'database'], description: 'Filter by type' },
            limit: { type: 'number', description: 'Max results (default 10)' },
          },
        },
        handler: async (params) => {
          const body: Record<string, unknown> = {};
          if (params.query) body.query = params.query as string;
          if (params.type) {
            const apiType = params.type === 'database' ? 'data_source' : params.type;
            body.filter = { property: 'object', value: apiType };
          }
          body.page_size = (params.limit as number) || 10;

          const result = await client.post<{ results: Page[] }>('search', body);
          return JSON.stringify(result.results.map(p => ({
            id: p.id,
            title: getPageTitle(p),
            url: p.url,
          })));
        },
      },

      // --- Pages --------------------------------------------------------

      page_get: {
        description: 'Get a page by ID with properties and optional content (as blocks or markdown)',
        parameters: {
          type: 'object',
          properties: {
            page_id: { type: 'string', description: 'Page ID' },
            content: { type: 'boolean', description: 'Include block content as JSON' },
            markdown: { type: 'boolean', description: 'Return page content as markdown (more token-efficient)' },
          },
          required: ['page_id'],
        },
        handler: async (params) => {
          const page = await client.get(`pages/${params.page_id}`) as Page;
          const result: Record<string, unknown> = { ...page };
          if (params.markdown) {
            const md = await getPageMarkdown(client, params.page_id as string);
            result.markdown = md.markdown;
            if (md.truncated) result.truncated = true;
          } else if (params.content) {
            result.blocks = await fetchAllBlocks(client, params.page_id as string);
          }
          return JSON.stringify(result);
        },
      },

      page_create: {
        description: 'Create a page in a database with optional markdown content',
        parameters: {
          type: 'object',
          properties: {
            parent_id: { type: 'string', description: 'Database ID or name' },
            title: { type: 'string', description: 'Page title' },
            properties: { type: 'object', description: 'Additional properties in Notion format' },
            markdown: { type: 'string', description: 'Page content as markdown' },
          },
          required: ['parent_id', 'title'],
        },
        handler: async (params) => {
          const parentId = resolveDatabaseInput(String(params.parent_id));
          const db = await getDatabaseSchema(client, parentId);
          const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0] || 'Name';

          const properties: Record<string, unknown> = {
            [titleProp]: { title: [{ text: { content: params.title as string } }] },
            ...(params.properties as Record<string, unknown> || {}),
          };

          const body: Record<string, unknown> = {
            parent: { database_id: parentId },
            properties,
          };
          if (params.markdown) {
            body.markdown = params.markdown;
          }

          const page = await client.post('pages', body);
          return JSON.stringify(page);
        },
      },

      page_update: {
        description: 'Update page properties',
        parameters: {
          type: 'object',
          properties: {
            page_id: { type: 'string', description: 'Page ID' },
            properties: { type: 'object', description: 'Properties to update in Notion format' },
            archive: { type: 'boolean', description: 'Move to trash' },
          },
          required: ['page_id'],
        },
        handler: async (params) => {
          const body: Record<string, unknown> = {};
          if (params.properties) body.properties = params.properties;
          if (params.archive) Object.assign(body, buildTrashPayload(true));

          const page = await client.patch(`pages/${params.page_id}`, body);
          return JSON.stringify(page);
        },
      },

      // --- Databases ----------------------------------------------------

      db_query: {
        description: 'Query a database with optional filter and sort',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID or name' },
            filter: { type: 'object', description: 'Notion filter object' },
            sorts: { type: 'array', description: 'Sort criteria' },
            title: { type: 'string', description: 'Filter by exact title' },
            limit: { type: 'number', description: 'Max results (default 100)' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const dbId = resolveDatabaseInput(String(params.database_id));
          const body: Record<string, unknown> = {};

          if (params.title) {
            const db = await getDatabaseSchema(client, dbId);
            const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0] || 'Name';
            body.filter = { property: titleProp, title: { equals: params.title } };
          } else if (params.filter) {
            body.filter = params.filter;
          }

          if (params.sorts) body.sorts = params.sorts;
          body.page_size = (params.limit as number) || 100;

          const result = await queryDatabase<PaginatedResponse<Page>>(client, dbId, body);
          return JSON.stringify(result);
        },
      },

      db_schema: {
        description: 'Get database schema (property names, types, and options)',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID or name' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const db = await getDatabaseSchema(client, resolveDatabaseInput(String(params.database_id)));
          return JSON.stringify(db);
        },
      },

      // --- Blocks -------------------------------------------------------

      block_children: {
        description: 'Get all child blocks of a page or block',
        parameters: {
          type: 'object',
          properties: {
            block_id: { type: 'string', description: 'Page or block ID' },
          },
          required: ['block_id'],
        },
        handler: async (params) => {
          const blocks = await fetchAllBlocks(client, params.block_id as string);
          return JSON.stringify(blocks);
        },
      },

      block_append: {
        description: 'Append content blocks to a page',
        parameters: {
          type: 'object',
          properties: {
            block_id: { type: 'string', description: 'Page or block ID' },
            children: { type: 'array', description: 'Block objects to append' },
          },
          required: ['block_id', 'children'],
        },
        handler: async (params) => {
          const result = await client.patch(`blocks/${params.block_id}/children`, {
            children: params.children,
          });
          return JSON.stringify(result);
        },
      },

      // --- Find ---------------------------------------------------------

      find: {
        description: 'Natural language query against a database (e.g., "overdue tasks unassigned")',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language query' },
            database_id: { type: 'string', description: 'Database ID or name' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: ['query', 'database_id'],
        },
        handler: async (params) => {
          const dbId = resolveDatabaseInput(String(params.database_id));
          const limit = String(Number(params.limit) || 20);
          return runSubcommand(
            ['find', String(params.query), '-d', dbId, '--json', '--limit', limit],
            30_000,
          );
        },
      },

      // --- Batch --------------------------------------------------------

      batch: {
        description: 'Execute multiple operations in one call. Operations: get, create, update, delete, query, append.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: 'Array of operations: [{ op, type, id?, parent?, data? }]',
            },
          },
          required: ['operations'],
        },
        handler: async (params) => {
          return runSubcommand(
            ['batch', '--json', '--data', JSON.stringify(params.operations)],
          );
        },
      },

      // --- Workspace ----------------------------------------------------

      inspect_workspace: {
        description: 'List all accessible databases in the workspace',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max databases (default 20)' },
          },
        },
        handler: async (params) => {
          const result = await client.post('search', {
            filter: { property: 'object', value: 'data_source' },
            page_size: (params.limit as number) || 20,
          }) as { results: Database[] };

          return JSON.stringify(result.results.map(db => ({
            id: db.id,
            title: getDbTitle(db),
          })));
        },
      },

      // --- Comments -----------------------------------------------------

      comment_create: {
        description: 'Create a comment on a page',
        parameters: {
          type: 'object',
          properties: {
            page_id: { type: 'string', description: 'Page ID to comment on' },
            text: { type: 'string', description: 'Comment text' },
          },
          required: ['page_id', 'text'],
        },
        handler: async (params) => {
          const comment = await client.post('comments', {
            parent: { page_id: params.page_id },
            rich_text: [{ type: 'text', text: { content: params.text } }],
          });
          return JSON.stringify(comment);
        },
      },

      // --- Validate -----------------------------------------------------

      validate_health: {
        description: 'Get health score and fill rates for a database',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID or name' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const dbId = resolveDatabaseInput(String(params.database_id));
          return runSubcommand(['validate', 'health', dbId]);
        },
      },

      // --- Dedup --------------------------------------------------------

      dedup: {
        description: 'Find duplicate pages in a database',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID or name' },
            fuzzy: { type: 'boolean', description: 'Include near-duplicates' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const dbId = resolveDatabaseInput(String(params.database_id));
          const args = ['dedup', dbId, '--json'];
          if (params.fuzzy) args.push('--fuzzy');
          return runSubcommand(args);
        },
      },
    },
  });
}
