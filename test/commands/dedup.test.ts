import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { createMockPage, createPaginatedResult, setupDatabaseResolution } from '../fixtures/notion-data';

describe('Dedup Command', () => {
  let program: Command;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    const { registerDedupCommand } = await import('../../src/commands/dedup');
    program = new Command();
    registerDedupCommand(program);
  });

  function setupPages(pages: any[]) {
    setupDatabaseResolution(mockClient);
    mockClient.post.mockResolvedValue(createPaginatedResult(pages));
  }

  describe('finding duplicates', () => {
    it('should find exact title duplicates', async () => {
      const pages = [
        createMockPage('p1', 'Weekly Report'),
        createMockPage('p2', 'Weekly Report'),
        createMockPage('p3', 'Unique Page'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"Weekly Report"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 copies'));
    });

    it('should be case-insensitive', async () => {
      const pages = [
        createMockPage('p1', 'My Task'),
        createMockPage('p2', 'my task'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 copies'));
    });

    it('should report no duplicates when none exist', async () => {
      const pages = [
        createMockPage('p1', 'Page One'),
        createMockPage('p2', 'Page Two'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('No duplicates found.');
    });

    it('should skip untitled pages', async () => {
      const pages = [
        createMockPage('p1', 'Untitled'),
        createMockPage('p2', 'Untitled'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('No duplicates found.');
    });

    it('should handle empty database', async () => {
      setupPages([]);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('No duplicates found.');
    });

    it('should sort groups by size (largest first)', async () => {
      const pages = [
        createMockPage('p1', 'Big Group'),
        createMockPage('p2', 'Big Group'),
        createMockPage('p3', 'Big Group'),
        createMockPage('p4', 'Small Group'),
        createMockPage('p5', 'Small Group'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      const calls = (console.log as any).mock.calls.map((c: any[]) => c[0]);
      const bigIdx = calls.findIndex((c: string) => c.includes('3 copies'));
      const smallIdx = calls.findIndex((c: string) => c.includes('2 copies'));
      expect(bigIdx).toBeLessThan(smallIdx);
    });
  });

  describe('--fuzzy flag', () => {
    it('should match titles with (copy) suffix', async () => {
      const pages = [
        createMockPage('p1', 'Meeting Notes'),
        createMockPage('p2', 'Meeting Notes (copy)'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fuzzy']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 copies'));
    });

    it('should match titles with numbered suffixes', async () => {
      const pages = [
        createMockPage('p1', 'Report'),
        createMockPage('p2', 'Report (1)'),
        createMockPage('p3', 'Report (2)'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fuzzy']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('3 copies'));
    });

    it('should match titles with - OLD / - DRAFT suffixes', async () => {
      const pages = [
        createMockPage('p1', 'Q1 OKRs'),
        createMockPage('p2', 'Q1 OKRs - OLD'),
        createMockPage('p3', 'Q1 OKRs - DRAFT'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fuzzy']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('3 copies'));
    });

    it('should not match without --fuzzy', async () => {
      const pages = [
        createMockPage('p1', 'Report'),
        createMockPage('p2', 'Report (copy)'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123']);

      expect(console.log).toHaveBeenCalledWith('No duplicates found.');
    });
  });

  describe('--fix flag', () => {
    it('should show dry-run by default (no --yes)', async () => {
      const pages = [
        createMockPage('p1', 'Dup Page'),
        createMockPage('p2', 'Dup Page'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fix', '--strategy', 'keep-newest']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Would archive 1 page'));
      expect(mockClient.patch).not.toHaveBeenCalled();
    });

    it('should archive duplicates with --yes', async () => {
      const p1 = { ...createMockPage('p1', 'Dup'), created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-03-01T00:00:00Z' };
      const p2 = { ...createMockPage('p2', 'Dup'), created_time: '2026-02-01T00:00:00Z', last_edited_time: '2026-02-01T00:00:00Z' };
      setupPages([p1, p2]);
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fix', '--strategy', 'keep-newest', '--yes']);

      // p1 has newer last_edited_time, so p2 should be archived
      expect(mockClient.patch).toHaveBeenCalledWith('pages/p2', { in_trash: true });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Archived 1 duplicate'));
    });

    it('should keep oldest with keep-oldest strategy', async () => {
      const p1 = { ...createMockPage('p1', 'Dup'), created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-01-01T00:00:00Z' };
      const p2 = { ...createMockPage('p2', 'Dup'), created_time: '2026-03-01T00:00:00Z', last_edited_time: '2026-03-01T00:00:00Z' };
      setupPages([p1, p2]);
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--fix', '--strategy', 'keep-oldest', '--yes']);

      // p1 is oldest, so p2 should be archived
      expect(mockClient.patch).toHaveBeenCalledWith('pages/p2', { in_trash: true });
    });
  });

  describe('--json flag', () => {
    it('should output JSON with duplicate groups', async () => {
      const pages = [
        createMockPage('p1', 'Dup'),
        createMockPage('p2', 'Dup'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--json']);

      const output = (console.log as any).mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe('Dup');
      expect(parsed[0].count).toBe(2);
      expect(parsed[0].pages).toHaveLength(2);
    });
  });

  describe('--llm flag', () => {
    it('should output compact format with KEEP/DUP markers', async () => {
      const pages = [
        createMockPage('p1', 'Dup Page'),
        createMockPage('p2', 'Dup Page'),
      ];
      setupPages(pages);

      await program.parseAsync(['node', 'test', 'dedup', 'db-123', '--llm']);

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[KEEP\].*p[12].*Dup Page/));
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[DUP\].*p[12].*Dup Page/));
    });
  });

  describe('error handling', () => {
    it('should handle database fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Database not found'));

      await expect(
        program.parseAsync(['node', 'test', 'dedup', 'invalid-db'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Database not found');
    });
  });
});
