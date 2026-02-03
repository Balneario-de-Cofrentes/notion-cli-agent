import { beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  // Reset all modules to clear singleton state (critical for NotionClient)
  vi.resetModules();

  // Set default test token in environment
  process.env.NOTION_TOKEN = 'test_token_default';

  // Mock process.exit to throw instead of exiting
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  });

  // Mock console methods to suppress output during tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // Mock global fetch to reject by default (forces explicit mocking per test)
  global.fetch = vi.fn().mockRejectedValue(
    new Error('Unmocked API call - all fetch calls must be explicitly mocked')
  );
});

afterEach(() => {
  // Clean up environment variables
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_API_KEY;

  // Restore all mocks
  vi.restoreAllMocks();
});
