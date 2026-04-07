/**
 * Workspace Resolver -- resolves database names to UUIDs
 *
 * Reads ~/.config/notion/workspace.json (created by `notion sync` or
 * the notion-onboarding skill) and resolves human-friendly database
 * names to Notion UUIDs.
 *
 * Design: This module handles name-to-UUID resolution only.
 * database-resolver.ts handles UUID-to-data-source routing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RegistryEntry {
  id: string;
  title: string;
  url?: string;
  syncedAt?: string;
}

interface DatabaseEntry {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface WorkspaceState {
  version: number;
  onboardedAt?: string;
  updatedAt?: string;
  syncedAt?: string;
  workspace?: { name: string };
  home?: { pageId: string; title: string; url?: string };
  databases?: Record<string, DatabaseEntry>;
  custom?: Record<string, DatabaseEntry>;
  registry?: RegistryEntry[];
}

export interface KnownDatabase {
  id: string;
  title: string;
  source: 'databases' | 'custom' | 'registry';
  role?: string;
}

// ─── UUID detection ─────────────────────────────────────────────────────────

const NOTION_UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function isNotionUUID(input: string): boolean {
  return NOTION_UUID_RE.test(input);
}

// ─── Workspace file I/O ─────────────────────────────────────────────────────

export function getWorkspacePath(): string {
  return join(homedir(), '.config', 'notion', 'workspace.json');
}

export function readWorkspace(): WorkspaceState | null {
  const path = getWorkspacePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceState;
  } catch {
    return null;
  }
}

export function writeWorkspaceRegistry(entries: RegistryEntry[]): void {
  const path = getWorkspacePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = readWorkspace() ?? { version: 1 };
  const now = new Date().toISOString();

  const merged: WorkspaceState = {
    ...existing,
    version: 1,
    syncedAt: now,
    updatedAt: now,
    registry: entries,
  };

  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

// ─── List all known databases ───────────────────────────────────────────────

/**
 * Collect all databases from workspace state, deduped by ID.
 * Curated entries (databases/custom) take priority over registry.
 * Accepts an optional pre-read state to avoid redundant disk reads.
 */
export function listKnownDatabases(preloaded?: WorkspaceState | null): KnownDatabase[] {
  const state = preloaded ?? readWorkspace();
  if (!state) return [];

  const seen = new Set<string>();
  const results: KnownDatabase[] = [];

  if (state.databases) {
    for (const [role, entry] of Object.entries(state.databases)) {
      if (entry.id && !seen.has(entry.id)) {
        seen.add(entry.id);
        results.push({ id: entry.id, title: entry.title, source: 'databases', role });
      }
    }
  }

  if (state.custom) {
    for (const [role, entry] of Object.entries(state.custom)) {
      if (entry.id && !seen.has(entry.id)) {
        seen.add(entry.id);
        results.push({ id: entry.id, title: entry.title, source: 'custom', role });
      }
    }
  }

  if (state.registry) {
    for (const entry of state.registry) {
      if (entry.id && !seen.has(entry.id)) {
        seen.add(entry.id);
        results.push({ id: entry.id, title: entry.title, source: 'registry' });
      }
    }
  }

  return results;
}

// ─── Name resolution ────────────────────────────────────────────────────────

/**
 * Resolve a database identifier that may be a UUID or a human-friendly name.
 * Returns a Notion UUID. Throws on ambiguous matches.
 *
 * Resolution: UUID pass-through, then exact > case-insensitive > substring matching.
 */
export function resolveDatabaseInput(input: string): string {
  if (isNotionUUID(input)) return input;

  const state = readWorkspace();
  if (!state) {
    process.stderr.write(
      `Warning: no workspace cache found. Run "notion sync" to enable name-based lookups.\n`,
    );
    return input;
  }

  const all = listKnownDatabases(state);
  if (all.length === 0) {
    process.stderr.write(
      `Warning: workspace cache is empty. Run "notion sync" to index your databases.\n`,
    );
    return input;
  }

  const exact = all.filter(db => db.title === input);
  if (exact.length === 1) return exact[0].id;

  const lower = input.toLowerCase();
  const ciMatch = all.filter(db => db.title.toLowerCase() === lower);
  if (ciMatch.length === 1) return ciMatch[0].id;

  const substring = all.filter(db => db.title.toLowerCase().includes(lower));
  if (substring.length === 1) return substring[0].id;

  const candidates = [ciMatch, substring, exact].find(c => c.length > 1) ?? [];
  if (candidates.length > 1) {
    const list = candidates
      .map(db => `  - ${db.title} (${db.id.slice(0, 8)}...)${db.role ? ` [${db.role}]` : ''}`)
      .join('\n');
    throw new Error(
      `Ambiguous database name "${input}". Did you mean:\n${list}\n\nUse a more specific name or pass the full database UUID.`,
    );
  }

  const suggestions = all.map(db => db.title).slice(0, 5).join(', ');
  throw new Error(
    `No database found matching "${input}".\nAvailable: ${suggestions}${all.length > 5 ? ` (+${all.length - 5} more)` : ''}\nRun "notion list" to see all databases, or "notion sync" to refresh.`,
  );
}
