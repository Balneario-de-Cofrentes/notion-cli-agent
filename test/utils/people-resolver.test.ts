import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Guest resolution tests.
 *
 * Notion's GET /v1/users (list) never returns GUEST users — only members and
 * bots — so guests can't be discovered by listing. But their ids appear in
 * pages' created_by/last_edited_by, and GET /v1/users/{id} returns a guest's
 * full info once you know the id.
 *
 * `fishGuests()` walks POST /v1/search, collects every creator/editor id that
 * isn't already a known member, GET-resolves each, and keeps type=person
 * non-members (= guests). The result is cached in ~/.config/notion/guests.json.
 *
 * Real fixture: guest Sergio Balufo, sergioangel@balneario.com.
 */

// ─── Real guest fixture ───────────────────────────────────────────────────────
const SERGIO = {
  object: 'user',
  id: '240566b6-0c2e-413a-9efa-6f011bdc3976',
  type: 'person',
  name: 'Sergio Balufo',
  person: { email: 'sergioangel@balneario.com' },
};

const MEMBER = {
  object: 'user',
  id: '11111111-1111-1111-1111-111111111111',
  type: 'person',
  name: 'Encarni',
  person: { email: 'encarni@balneario.com' },
};

const BOT = {
  object: 'user',
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  type: 'bot',
  name: 'Integration',
};

// ─── fs mock (controls guests.json + the homedir path) ────────────────────────
let fileStore: Record<string, string> = {};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => p in fileStore),
    readFileSync: vi.fn((p: string) => {
      if (p in fileStore) return fileStore[p];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    writeFileSync: vi.fn((p: string, data: string) => {
      fileStore[p] = data;
    }),
    mkdirSync: vi.fn(),
  };
});

let mod: typeof import('../../src/utils/people-resolver');

beforeEach(async () => {
  vi.resetModules();
  fileStore = {};
  mod = await import('../../src/utils/people-resolver');
});

describe('guests cache I/O', () => {
  it('getGuestsPath() lives next to api_key/workspace.json', () => {
    expect(mod.getGuestsPath()).toMatch(/\.config[\\/]notion[\\/]guests\.json$/);
  });

  it('readGuests() returns empty list when no cache exists', () => {
    expect(mod.readGuests()).toEqual([]);
  });

  it('writeGuests() persists {guests, updatedAt} and readGuests() round-trips', () => {
    mod.writeGuests([{ id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' }]);

    const raw = JSON.parse(fileStore[mod.getGuestsPath()]);
    expect(raw.guests).toEqual([
      { id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' },
    ]);
    expect(typeof raw.updatedAt).toBe('string');

    expect(mod.readGuests()).toEqual([
      { id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' },
    ]);
  });

  it('writeGuests() merges/dedups with an existing cache by id', () => {
    mod.writeGuests([{ id: SERGIO.id, name: 'Old name', email: 'old@balneario.com' }]);
    mod.writeGuests([
      { id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' },
      { id: 'ccc', name: 'Other Guest', email: 'other@x.com' },
    ]);

    const guests = mod.readGuests();
    expect(guests).toHaveLength(2);
    // newest write wins for the duplicate id
    expect(guests.find(g => g.id === SERGIO.id)).toEqual({
      id: SERGIO.id,
      name: 'Sergio Balufo',
      email: 'sergioangel@balneario.com',
    });
  });
});

describe('fishGuests()', () => {
  function makeClient(searchPages: any[], usersById: Record<string, any>) {
    return {
      post: vi.fn().mockResolvedValue({
        results: searchPages,
        has_more: false,
        next_cursor: null,
      }),
      get: vi.fn((path: string) => {
        const id = path.replace('users/', '');
        if (id === 'me') return Promise.resolve(BOT);
        if (usersById[id]) return Promise.resolve(usersById[id]);
        return Promise.reject(new Error(`Notion API Error (404): not found`));
      }),
    };
  }

  it('discovers the guest Sergio from a page created_by id not in the member list', async () => {
    const page = {
      object: 'page',
      id: 'page-1',
      created_by: { object: 'user', id: SERGIO.id },
      last_edited_by: { object: 'user', id: MEMBER.id },
    };
    const client = makeClient([page], { [SERGIO.id]: SERGIO, [MEMBER.id]: MEMBER });

    const guests = await mod.fishGuests(client as any, { members: [MEMBER] });

    expect(guests).toEqual([
      { id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' },
    ]);
    // must NOT re-GET the known member
    expect(client.get).toHaveBeenCalledWith(`users/${SERGIO.id}`);
    expect(client.get).not.toHaveBeenCalledWith(`users/${MEMBER.id}`);
  });

  it('persists discovered guests to the cache', async () => {
    const page = {
      object: 'page',
      id: 'page-1',
      created_by: { object: 'user', id: SERGIO.id },
      last_edited_by: { object: 'user', id: SERGIO.id },
    };
    const client = makeClient([page], { [SERGIO.id]: SERGIO });

    await mod.fishGuests(client as any, { members: [] });

    expect(mod.readGuests()).toContainEqual({
      id: SERGIO.id,
      name: 'Sergio Balufo',
      email: 'sergioangel@balneario.com',
    });
  });

  it('does not treat bots as guests', async () => {
    const page = {
      object: 'page',
      id: 'page-1',
      created_by: { object: 'user', id: BOT.id },
      last_edited_by: { object: 'user', id: BOT.id },
    };
    const client = makeClient([page], { [BOT.id]: BOT });

    const guests = await mod.fishGuests(client as any, { members: [] });
    expect(guests).toEqual([]);
  });

  it('dedups a guest id seen across many pages (one GET each)', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      object: 'page',
      id: `page-${i}`,
      created_by: { object: 'user', id: SERGIO.id },
      last_edited_by: { object: 'user', id: SERGIO.id },
    }));
    const client = makeClient(pages, { [SERGIO.id]: SERGIO });

    await mod.fishGuests(client as any, { members: [] });

    const sergioGets = client.get.mock.calls.filter(
      (c: any[]) => c[0] === `users/${SERGIO.id}`,
    );
    expect(sergioGets).toHaveLength(1);
  });
});

describe('resolvePeopleValue()', () => {
  const dir = {
    members: [MEMBER],
    guests: [{ id: SERGIO.id, name: 'Sergio Balufo', email: 'sergioangel@balneario.com' }],
  };

  it('passes a UUID through unchanged', () => {
    expect(mod.resolvePeopleValue(SERGIO.id, dir)).toBe(SERGIO.id);
  });

  it('resolves a guest by exact email', () => {
    expect(mod.resolvePeopleValue('sergioangel@balneario.com', dir)).toBe(SERGIO.id);
  });

  it('resolves a member by exact email', () => {
    expect(mod.resolvePeopleValue('encarni@balneario.com', dir)).toBe(MEMBER.id);
  });

  it('resolves a guest by case-insensitive name', () => {
    expect(mod.resolvePeopleValue('sergio balufo', dir)).toBe(SERGIO.id);
  });

  it('prefers email over name when both could match', () => {
    const tricky = {
      members: [],
      guests: [
        { id: 'g1', name: 'sergioangel@balneario.com', email: 'noise@x.com' },
        { id: 'g2', name: 'Sergio', email: 'sergioangel@balneario.com' },
      ],
    };
    expect(mod.resolvePeopleValue('sergioangel@balneario.com', tricky)).toBe('g2');
  });

  it('returns the original value unchanged when nothing matches (pass-through)', () => {
    expect(mod.resolvePeopleValue('user-123', dir)).toBe('user-123');
    expect(mod.resolvePeopleValue('unknown@nobody.com', dir)).toBe('unknown@nobody.com');
  });
});
