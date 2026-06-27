import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Workspace resolver tests.
 *
 * The aliases shown by `notion list` (the object keys in workspace.json's
 * `databases` / `custom` maps, e.g. `tasks`, `projects`, `goals`) MUST be
 * resolvable by `resolveDatabaseInput` — and an exact alias match must win
 * BEFORE any title/name substring matching.
 *
 * We drive resolution by mocking node:fs so `readWorkspace()` returns a
 * controlled fixture.
 */

// A workspace cache mirroring the real one: aliased curated DBs (keyed by
// alias) plus registry DBs whose *titles* would otherwise shadow the aliases.
const WORKSPACE_FIXTURE = {
  version: 1,
  databases: {
    tasks: { id: '635cb21e-21fc-42b8-b8d1-0586e6fef15d', title: 'Tareas' },
    projects: { id: '4072818b-3c04-47a4-84c4-7bdf4ee30a87', title: 'Proyectos' },
    goals: { id: '60106551-ef19-4048-a903-295fa95fec29', title: 'Objetivos' },
  },
  custom: {
    key_results: { id: '2c98284a-8643-8100-a695-000b1bd8abed', title: 'Indicadores Clave' },
  },
  registry: [
    // These titles literally contain "Projects" — they would make a bare
    // name-substring match for "projects" ambiguous if the alias didn't win.
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Projects [Customer Journey]' },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Projects [Onboarding Flow]' },
  ],
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => JSON.stringify(WORKSPACE_FIXTURE)),
  };
});

let resolver: typeof import('../../src/utils/workspace-resolver');

beforeEach(async () => {
  vi.resetModules();
  resolver = await import('../../src/utils/workspace-resolver');
});

describe('resolveDatabaseInput() — alias resolution', () => {
  it('resolves the alias "tasks" to the Tareas database id (not "no database found")', () => {
    expect(resolver.resolveDatabaseInput('tasks')).toBe(
      '635cb21e-21fc-42b8-b8d1-0586e6fef15d',
    );
  });

  it('resolves the alias "projects" to Proyectos (not ambiguous with "Projects [...]" titles)', () => {
    expect(resolver.resolveDatabaseInput('projects')).toBe(
      '4072818b-3c04-47a4-84c4-7bdf4ee30a87',
    );
  });

  it('resolves the alias "goals" to the Objetivos database id', () => {
    expect(resolver.resolveDatabaseInput('goals')).toBe(
      '60106551-ef19-4048-a903-295fa95fec29',
    );
  });

  it('resolves aliases from the custom section ("key_results")', () => {
    expect(resolver.resolveDatabaseInput('key_results')).toBe(
      '2c98284a-8643-8100-a695-000b1bd8abed',
    );
  });

  it('is case-insensitive for aliases ("TASKS")', () => {
    expect(resolver.resolveDatabaseInput('TASKS')).toBe(
      '635cb21e-21fc-42b8-b8d1-0586e6fef15d',
    );
  });

  it('still resolves by exact title (alias fallback) — "Tareas"', () => {
    expect(resolver.resolveDatabaseInput('Tareas')).toBe(
      '635cb21e-21fc-42b8-b8d1-0586e6fef15d',
    );
  });

  it('passes UUIDs through unchanged', () => {
    const uuid = 'deadbeef-0000-0000-0000-000000000000';
    expect(resolver.resolveDatabaseInput(uuid)).toBe(uuid);
  });

  it('still reports ambiguity for a non-alias name that matches multiple titles', () => {
    // "Onboarding" only appears in one title, so use a substring matching both:
    expect(() => resolver.resolveDatabaseInput('Projects [')).toThrow(/Ambiguous/);
  });
});

describe('normalizeNotionId() — short-id handling (BUG 2)', () => {
  it('passes a dashed UUID through unchanged', () => {
    const uuid = '4c485397-1234-4abc-8def-0123456789ab';
    expect(resolver.normalizeNotionId(uuid)).toBe(uuid);
  });

  it('expands a 32-hex undashed id to a dashed UUID', () => {
    expect(resolver.normalizeNotionId('4c4853971234abcd8def0123456789ab')).toBe(
      '4c485397-1234-abcd-8def-0123456789ab',
    );
  });

  it('is case-insensitive and lowercases the 32-hex expansion', () => {
    expect(resolver.normalizeNotionId('4C4853971234ABCD8DEF0123456789AB')).toBe(
      '4c485397-1234-abcd-8def-0123456789ab',
    );
  });

  it('throws a clear "full UUID" error for a bare 8-hex short id (not reconstructable)', () => {
    expect(() => resolver.normalizeNotionId('4c485397')).toThrow(/full.*UUID/i);
  });

  it('leaves non-id inputs untouched (caller decides)', () => {
    expect(resolver.normalizeNotionId('some-page-title')).toBe('some-page-title');
  });
});
