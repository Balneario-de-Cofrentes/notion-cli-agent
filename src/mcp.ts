/**
 * MCP server mode — exposes notion-cli-agent as an MCP tool server over stdio.
 *
 * Usage: notion --mcp
 *
 * Reuses existing command logic via the Notion client and helpers.
 * Each tool returns JSON results directly (no console.log formatting).
 */

import { createMcpServer } from 'mcp-stdio';
import { initClient, getClient } from './client.js';
import { setGlobalDataSourceId } from './utils/database-resolver.js';
import { getDatabaseSchema, queryDatabase, queryAllPages, updateDatabase } from './utils/database-resolver.js';
import { getPageTitle, getDbTitle, fetchAllBlocks, buildTrashPayload, resolvePropertyName, buildClearPayload } from './utils/notion-helpers.js';
import { parseProperties, parseFilter, formatResultsAsDelimited } from './utils/format.js';
import type { Page, PaginatedResponse, Database } from './types/notion.js';

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
    version: '0.13.0',
    tools: {

      // ─── Search ─────────────────────────────────────────────────────

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

      // ─── Pages ──────────────────────────────────────────────────────

      page_get: {
        description: 'Get a page by ID with properties and optional content',
        parameters: {
          type: 'object',
          properties: {
            page_id: { type: 'string', description: 'Page ID' },
            content: { type: 'boolean', description: 'Include block content' },
          },
          required: ['page_id'],
        },
        handler: async (params) => {
          const page = await client.get(`pages/${params.page_id}`) as Page;
          const result: Record<string, unknown> = { ...page };
          if (params.content) {
            result.blocks = await fetchAllBlocks(client, params.page_id as string);
          }
          return JSON.stringify(result);
        },
      },

      page_create: {
        description: 'Create a page in a database',
        parameters: {
          type: 'object',
          properties: {
            parent_id: { type: 'string', description: 'Database ID' },
            title: { type: 'string', description: 'Page title' },
            properties: { type: 'object', description: 'Additional properties in Notion format' },
          },
          required: ['parent_id', 'title'],
        },
        handler: async (params) => {
          const db = await getDatabaseSchema(client, params.parent_id as string);
          const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0] || 'Name';

          const properties: Record<string, unknown> = {
            [titleProp]: { title: [{ text: { content: params.title as string } }] },
            ...(params.properties as Record<string, unknown> || {}),
          };

          const page = await client.post('pages', {
            parent: { database_id: params.parent_id },
            properties,
          });
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

      // ─── Databases ──────────────────────────────────────────────────

      db_query: {
        description: 'Query a database with optional filter and sort',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID' },
            filter: { type: 'object', description: 'Notion filter object' },
            sorts: { type: 'array', description: 'Sort criteria' },
            title: { type: 'string', description: 'Filter by exact title' },
            limit: { type: 'number', description: 'Max results (default 100)' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const body: Record<string, unknown> = {};

          if (params.title) {
            const db = await getDatabaseSchema(client, params.database_id as string);
            const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0] || 'Name';
            body.filter = { property: titleProp, title: { equals: params.title } };
          } else if (params.filter) {
            body.filter = params.filter;
          }

          if (params.sorts) body.sorts = params.sorts;
          body.page_size = (params.limit as number) || 100;

          const result = await queryDatabase<PaginatedResponse<Page>>(client, params.database_id as string, body);
          return JSON.stringify(result);
        },
      },

      db_schema: {
        description: 'Get database schema (property names, types, and options)',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const db = await getDatabaseSchema(client, params.database_id as string);
          return JSON.stringify(db);
        },
      },

      // ─── Blocks ─────────────────────────────────────────────────────

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

      // ─── Find ───────────────────────────────────────────────────────

      find: {
        description: 'Natural language query against a database (e.g., "overdue tasks unassigned")',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language query' },
            database_id: { type: 'string', description: 'Database ID to search' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: ['query', 'database_id'],
        },
        handler: async (params) => {
          // Dynamically import find logic to avoid circular deps
          const { execSync } = await import('child_process');
          const result = execSync(
            `node ${process.argv[1]} find ${JSON.stringify(params.query)} -d ${params.database_id} --json --limit ${params.limit || 20}`,
            { env: process.env, encoding: 'utf-8', timeout: 30000 },
          );
          return result;
        },
      },

      // ─── Batch ──────────────────────────────────────────────────────

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
          const { execSync } = await import('child_process');
          const result = execSync(
            `node ${process.argv[1]} batch --json --data ${JSON.stringify(JSON.stringify(params.operations))}`,
            { env: process.env, encoding: 'utf-8', timeout: 60000 },
          );
          return result;
        },
      },

      // ─── Workspace ──────────────────────────────────────────────────

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

      // ─── Comments ───────────────────────────────────────────────────

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

      // ─── Validate ───────────────────────────────────────────────────

      validate_health: {
        description: 'Get health score and fill rates for a database',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const { execSync } = await import('child_process');
          const result = execSync(
            `node ${process.argv[1]} validate health ${params.database_id}`,
            { env: process.env, encoding: 'utf-8', timeout: 60000 },
          );
          return result;
        },
      },

      // ─── Dedup ──────────────────────────────────────────────────────

      dedup: {
        description: 'Find duplicate pages in a database',
        parameters: {
          type: 'object',
          properties: {
            database_id: { type: 'string', description: 'Database ID' },
            fuzzy: { type: 'boolean', description: 'Include near-duplicates' },
          },
          required: ['database_id'],
        },
        handler: async (params) => {
          const { execSync } = await import('child_process');
          const flags = params.fuzzy ? '--fuzzy' : '';
          const result = execSync(
            `node ${process.argv[1]} dedup ${params.database_id} --json ${flags}`,
            { env: process.env, encoding: 'utf-8', timeout: 60000 },
          );
          return result;
        },
      },
    },
  });
}
