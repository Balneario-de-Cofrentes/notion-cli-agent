/**
 * Database Resolver — routes database operations to /v1/data_sources/
 *
 * Since API version 2025-09-03, database properties (schema) live on
 * data_source objects, not database objects. This module discovers the
 * data_source_id for a database and routes all schema/query/update
 * operations to the correct /v1/data_sources/ endpoint.
 *
 * Design: This module is the ONLY place that knows about endpoint routing.
 * Command files call getDatabaseSchema(), queryDatabase(), etc. and never
 * construct database/data_source paths themselves.
 */

import type { NotionClient } from '../client.js';
import type { Database, PaginatedResponse, Page } from '../types/notion.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolvedDatabase {
  type: 'data_source';
  databaseId: string;
  dataSourceId: string;
  schemaPath: string;
  queryPath: string;
  updatePath: string;
  schema: Database;
}

export interface ResolverOptions {
  dataSourceId?: string;
}

export interface QueryAllOptions extends ResolverOptions {
  filter?: Record<string, unknown>;
  sorts?: Record<string, unknown>[];
  pageSize?: number;
  limit?: number;
  onProgress?: (fetched: number) => void;
}

// ─── Global data-source-id fallback ─────────────────────────────────────────

let globalDataSourceId: string | undefined;

/**
 * Set the global data-source-id fallback from CLI's --data-source-id option.
 * Called once from cli.ts preAction hook. Commands don't need to thread
 * this option — the resolver picks it up automatically.
 */
export function setGlobalDataSourceId(id?: string): void {
  globalDataSourceId = id;
}

function effectiveDataSourceId(explicit?: string): string | undefined {
  return explicit ?? globalDataSourceId;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new Map<string, Promise<ResolvedDatabase>>();

function cacheKey(databaseId: string, dataSourceId?: string): string {
  return dataSourceId ? `${databaseId}::${dataSourceId}` : databaseId;
}

export function clearResolverCache(): void {
  cache.clear();
}

// ─── Core resolution ────────────────────────────────────────────────────────

function buildPaths(dataSourceId: string) {
  return {
    schemaPath: `data_sources/${dataSourceId}`,
    queryPath: `data_sources/${dataSourceId}/query`,
    updatePath: `data_sources/${dataSourceId}`,
  };
}

/**
 * Discover the data_source_id for a database.
 * On API v2025-09-03, GET /databases/{id} returns a data_sources array
 * instead of properties. We pick the first (or only) data source.
 * If multiple exist, the user must specify --data-source-id explicitly.
 */
async function discoverDataSourceId(
  client: NotionClient,
  databaseId: string,
): Promise<string> {
  const db = await client.get<{ data_sources?: { id: string; name: string }[] }>(
    `databases/${databaseId}`,
  );

  const sources = db.data_sources;
  if (!sources || sources.length === 0) {
    throw new Error(
      `Database ${databaseId} has no data sources. Use --data-source-id to specify one.`,
    );
  }

  if (sources.length > 1) {
    const list = sources.map(s => `  - ${s.id} (${s.name})`).join('\n');
    throw new Error(
      `Database ${databaseId} has ${sources.length} data sources:\n${list}\n` +
      `Use --data-source-id <id> to specify which one.`,
    );
  }

  return sources[0].id;
}

/**
 * Fetch the data_source schema and build a ResolvedDatabase.
 */
async function fetchDataSource(
  client: NotionClient,
  databaseId: string,
  dataSourceId: string,
): Promise<ResolvedDatabase> {
  const ds = await client.get<Record<string, unknown>>(
    `data_sources/${dataSourceId}`,
  );
  return {
    type: 'data_source',
    databaseId,
    dataSourceId,
    ...buildPaths(dataSourceId),
    schema: normalizeToDatabase(ds, dataSourceId),
  };
}

/**
 * Resolve a database ID to the correct API endpoints.
 *
 * Resolution strategy:
 * 1. If explicit dataSourceId is provided, fetch that data_source directly
 * 2. Otherwise, GET /databases/{id} to discover data_sources, then fetch schema
 * 3. Cache the result for the lifetime of the process
 */
export function resolveDatabase(
  client: NotionClient,
  databaseId: string,
  dataSourceId?: string,
): Promise<ResolvedDatabase> {
  const key = cacheKey(databaseId, dataSourceId);

  if (!cache.has(key)) {
    const promise = dataSourceId
      ? fetchDataSource(client, databaseId, dataSourceId)
      : discoverAndResolve(client, databaseId);

    cache.set(key, promise);

    // Remove from cache on failure so retries work
    promise.catch(() => cache.delete(key));
  }

  return cache.get(key)!;
}

async function discoverAndResolve(
  client: NotionClient,
  databaseId: string,
): Promise<ResolvedDatabase> {
  const dataSourceId = await discoverDataSourceId(client, databaseId);
  return fetchDataSource(client, databaseId, dataSourceId);
}

// ─── High-level helpers ─────────────────────────────────────────────────────

/**
 * Get the schema (properties, title, etc.) for a database.
 * Discovers the data_source automatically.
 */
export async function getDatabaseSchema(
  client: NotionClient,
  databaseId: string,
  opts?: ResolverOptions,
): Promise<Database> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return resolved.schema;
}

/**
 * Query a database. Resolves endpoint automatically.
 */
export async function queryDatabase<T = unknown>(
  client: NotionClient,
  databaseId: string,
  body: Record<string, unknown> = {},
  opts?: ResolverOptions,
): Promise<T> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return client.post<T>(resolved.queryPath, body);
}

/**
 * Query using an already-resolved database (avoids re-resolution).
 * Useful in loops/pagination where resolution already happened.
 */
export async function queryDatabaseDirect<T = unknown>(
  client: NotionClient,
  resolved: ResolvedDatabase,
  body: Record<string, unknown> = {},
): Promise<T> {
  return client.post<T>(resolved.queryPath, body);
}

/**
 * Update a database schema. Resolves endpoint automatically.
 */
export async function updateDatabase<T = unknown>(
  client: NotionClient,
  databaseId: string,
  body: Record<string, unknown>,
  opts?: ResolverOptions,
): Promise<T> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts?.dataSourceId));
  return client.patch<T>(resolved.updatePath, body);
}

// ─── Pagination helper ──────────────────────────────────────────────────────

/**
 * Fetch all pages from a database, handling pagination automatically.
 */
export async function queryAllPages(
  client: NotionClient,
  databaseId: string,
  opts: QueryAllOptions = {},
): Promise<Page[]> {
  const resolved = await resolveDatabase(client, databaseId, effectiveDataSourceId(opts.dataSourceId));
  const pages: Page[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: opts.pageSize ?? 100,
    };
    if (opts.filter) body.filter = opts.filter;
    if (opts.sorts) body.sorts = opts.sorts;
    if (cursor) body.start_cursor = cursor;

    const result = await queryDatabaseDirect<PaginatedResponse<Page>>(
      client, resolved, body,
    );

    pages.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;

    opts.onProgress?.(pages.length);

    if (opts.limit && pages.length >= opts.limit) {
      pages.splice(opts.limit);
      break;
    }
  } while (cursor);

  return pages;
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize a data_source API response to the Database shape
 * that all command files expect.
 */
function normalizeToDatabase(
  ds: Record<string, unknown>,
  id: string,
): Database {
  return {
    object: 'database' as const,
    id: (ds.id as string) || id,
    title: ds.title as Database['title'],
    description: ds.description as Database['description'],
    url: ds.url as string | undefined,
    properties: (ds.properties as Database['properties']) || {},
  };
}
