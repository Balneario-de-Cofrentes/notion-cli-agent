/**
 * People / Guest Resolver
 *
 * Notion's `GET /v1/users` (list) does NOT return GUEST users — only members
 * and bots — in every API version. So guests can't be discovered by listing,
 * and you can't assign a guest to a `people` property because you can't get
 * their user id from any list endpoint.
 *
 * BUT `GET /v1/users/{id}` DOES return a guest's full info once you know the
 * id, and guest ids appear in pages' `created_by`/`last_edited_by` and in
 * `people` property values where they're already assigned.
 *
 * `fishGuests()` walks `POST /v1/search`, collects every creator/editor id that
 * isn't already a known member, resolves each via `GET /v1/users/{id}`, and
 * keeps `type: 'person'` non-members (= guests). The result is cached in
 * `~/.config/notion/guests.json` (same dir as `api_key`/`workspace.json`) so
 * later commands can resolve a guest by email or name without re-fishing.
 *
 * Design mirrors workspace-resolver.ts for cache I/O conventions.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { isNotionUUID } from './workspace-resolver.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NotionUser {
  object?: 'user';
  id: string;
  type?: 'person' | 'bot';
  name?: string;
  person?: { email?: string };
  bot?: unknown;
}

export interface Guest {
  id: string;
  name: string;
  email: string;
}

interface GuestsCache {
  guests: Guest[];
  updatedAt: string;
}

/** Directory of resolvable people: live members + cached guests. */
export interface PeopleDirectory {
  members: NotionUser[];
  guests: Guest[];
}

/** Minimal client surface this module depends on (eases testing). */
export interface PeopleClient {
  get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<T>;
  post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T>;
}

// ─── Cache I/O ────────────────────────────────────────────────────────────────

export function getGuestsPath(): string {
  return join(homedir(), '.config', 'notion', 'guests.json');
}

export function readGuests(): Guest[] {
  const path = getGuestsPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as GuestsCache;
    return Array.isArray(parsed.guests) ? parsed.guests : [];
  } catch {
    return [];
  }
}

/**
 * Persist guests to the cache, merging/deduping with any existing entries by
 * id. The newest write wins for a duplicate id.
 */
export function writeGuests(guests: Guest[]): Guest[] {
  const path = getGuestsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const merged = new Map<string, Guest>();
  for (const g of readGuests()) merged.set(g.id, g);
  for (const g of guests) merged.set(g.id, g);

  const result = [...merged.values()];
  const cache: GuestsCache = { guests: result, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  return result;
}

// ─── Member listing (live) ────────────────────────────────────────────────────

interface PaginatedUsers {
  results: NotionUser[];
  has_more: boolean;
  next_cursor?: string | null;
}

/**
 * List all workspace members + bots via `GET /v1/users` (paginated).
 * Guests are never returned here — that's the whole reason this module exists.
 */
export async function listWorkspaceMembers(client: PeopleClient): Promise<NotionUser[]> {
  const members: NotionUser[] = [];
  let cursor: string | undefined;

  do {
    const query: Record<string, unknown> = { page_size: 100 };
    if (cursor) query.start_cursor = cursor;
    const page = await client.get<PaginatedUsers>('users', query);
    members.push(...page.results);
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return members;
}

// ─── Guest fishing ────────────────────────────────────────────────────────────

interface SearchResult {
  results: Array<{
    created_by?: { id?: string };
    last_edited_by?: { id?: string };
  }>;
  has_more: boolean;
  next_cursor?: string | null;
}

export interface FishGuestsOptions {
  /** Known members to skip. If omitted, fetched live via the users list. */
  members?: NotionUser[];
  /** Skip writing to the cache (used for previews). */
  persist?: boolean;
}

/**
 * Discover guests by walking search results and resolving every creator/editor
 * id that isn't a known member. Keeps `type: 'person'` non-members.
 *
 * Results are merged into the guests cache unless `persist: false`.
 */
export async function fishGuests(
  client: PeopleClient,
  options: FishGuestsOptions = {},
): Promise<Guest[]> {
  const members = options.members ?? (await listWorkspaceMembers(client));
  const memberIds = new Set(members.map(m => m.id));

  // Collect every distinct creator/editor id across all search results.
  const candidateIds = new Set<string>();
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await client.post<SearchResult>('search', body);

    for (const item of result.results) {
      for (const id of [item.created_by?.id, item.last_edited_by?.id]) {
        if (id && !memberIds.has(id)) candidateIds.add(id);
      }
    }

    cursor = result.has_more ? (result.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Resolve each candidate; keep type:person non-members (= guests). Some guests
  // expose no email, so we don't require one — they still resolve by name.
  const guests: Guest[] = [];
  for (const id of candidateIds) {
    let user: NotionUser;
    try {
      user = await client.get<NotionUser>(`users/${id}`);
    } catch {
      continue; // id no longer resolvable (deleted user, revoked guest, etc.)
    }
    if (user.type !== 'person') continue;
    if (memberIds.has(user.id)) continue;
    guests.push({
      id: user.id,
      name: user.name ?? '',
      email: user.person?.email ?? '',
    });
  }

  if (options.persist !== false && guests.length > 0) {
    writeGuests(guests);
  }

  return guests;
}

// ─── People value resolution ──────────────────────────────────────────────────

/**
 * Resolve a single `people` value to a Notion user id.
 *
 * - A UUID is passed through unchanged.
 * - Otherwise resolve against the directory: exact email first (members and
 *   guests), then case-insensitive name.
 * - If nothing matches, the original value is returned untouched so callers
 *   keep their existing pass-through behaviour.
 */
export function resolvePeopleValue(value: string, directory: PeopleDirectory): string {
  const trimmed = value.trim();
  if (isNotionUUID(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();

  const memberByEmail = directory.members.find(
    m => m.person?.email && m.person.email.toLowerCase() === lower,
  );
  if (memberByEmail) return memberByEmail.id;

  const guestByEmail = directory.guests.find(g => g.email && g.email.toLowerCase() === lower);
  if (guestByEmail) return guestByEmail.id;

  const memberByName = directory.members.find(
    m => m.name && m.name.toLowerCase() === lower,
  );
  if (memberByName) return memberByName.id;

  const guestByName = directory.guests.find(g => g.name && g.name.toLowerCase() === lower);
  if (guestByName) return guestByName.id;

  return value;
}

/**
 * Build a people directory from the live member list plus the cached guests.
 */
export async function loadPeopleDirectory(client: PeopleClient): Promise<PeopleDirectory> {
  const members = await listWorkspaceMembers(client);
  return { members, guests: readGuests() };
}

/**
 * Synchronous, cache-only directory (guests only). Used by sync property
 * builders that can't await a live member list.
 */
export function loadCachedDirectory(): PeopleDirectory {
  return { members: [], guests: readGuests() };
}
