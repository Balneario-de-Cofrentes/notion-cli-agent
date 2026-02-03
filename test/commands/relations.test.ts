import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockPage, mockDatabase } from '../fixtures/notion-data';

describe('Relations Command', () => {
  let program: Command;
  let mockClient: any;

  beforeEach(async () => {
    vi.resetModules();

    // Create mock client
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    // Mock the client module
    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    // Import command and register it
    const { registerRelationsCommand } = await import('../../src/commands/relations');
    program = new Command();
    registerRelationsCommand(program);
  });

  describe('backlinks', () => {
    it('should find backlinks to a page', async () => {
      const targetPage = { ...mockPage, id: 'target-123' };
      const linkingPage = {
        ...mockPage,
        id: 'linking-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Linking Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'target-123' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/target-123') return targetPage;
        if (path.startsWith('databases/')) return mockDatabase;
        throw new Error('Unexpected path');
      });
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'search') return { results: [linkingPage] };
        if (path.includes('query')) return { results: [] };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123']);

      expect(mockClient.get).toHaveBeenCalledWith('pages/target-123');
      expect(mockClient.post).toHaveBeenCalledWith('search', expect.objectContaining({
        query: 'Test Page',
        filter: { property: 'object', value: 'page' },
      }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Finding backlinks'));
    });

    it('should separate relations from mentions', async () => {
      const targetPage = { ...mockPage, id: 'target-123' };
      const relationPage = {
        ...mockPage,
        id: 'rel-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Related Page' }],
          },
          Link: {
            type: 'relation',
            relation: [{ id: 'target-123' }],
          },
        },
      };
      const mentionPage = {
        ...mockPage,
        id: 'mention-789',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Mention Page' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/target-123') return targetPage;
        if (path.startsWith('databases/')) return mockDatabase;
        throw new Error('Unexpected path');
      });
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'search') return { results: [relationPage, mentionPage] };
        if (path.includes('query')) return { results: [] };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Direct Relations'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Potential Mentions'));
    });

    it('should output JSON with --json', async () => {
      const targetPage = { ...mockPage, id: 'target-123' };
      
      mockClient.get.mockResolvedValue(targetPage);
      mockClient.post.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"target"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"backlinks"'));
    });

    it('should format LLM-friendly output with --llm', async () => {
      const targetPage = { ...mockPage, id: 'target-123' };
      const linkingPage = {
        ...mockPage,
        id: 'linking-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Linking Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'target-123' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/target-123') return targetPage;
        if (path.startsWith('databases/')) return mockDatabase;
        throw new Error('Unexpected path');
      });
      mockClient.post.mockImplementation(async (path: string) => {
        if (path === 'search') return { results: [linkingPage] };
        if (path.includes('query')) return { results: [] };
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123', '--llm']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('## Backlinks to'));
    });

    it('should handle no backlinks found', async () => {
      const targetPage = { ...mockPage, id: 'target-123' };
      
      mockClient.get.mockResolvedValue(targetPage);
      mockClient.post.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123']);

      expect(console.log).toHaveBeenCalledWith('No backlinks found.');
    });

    it('should handle pages not in database', async () => {
      const targetPage = {
        ...mockPage,
        id: 'target-123',
        parent: { type: 'page_id', page_id: 'parent-page' },
      };
      
      mockClient.get.mockResolvedValue(targetPage);
      mockClient.post.mockResolvedValue({ results: [] });

      await program.parseAsync(['node', 'test', 'relations', 'backlinks', 'target-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not in a database'));
    });

    it('should handle page fetch errors', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'relations', 'backlinks', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });
  });

  describe('link', () => {
    it('should link two pages', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [],
          },
        },
      };
      const targetPage = {
        ...mockPage,
        id: 'target-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Target Page' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'Related']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', {
        properties: {
          Related: {
            relation: [{ id: 'target-456' }],
          },
        },
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Linked'));
    });

    it('should handle already linked pages', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'target-456' }],
          },
        },
      };
      const targetPage = { ...mockPage, id: 'target-456' };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'Related']);

      expect(mockClient.patch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Already linked'));
    });

    it('should create bidirectional link with --bidirectional', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [],
          },
        },
      };
      const targetPage = {
        ...mockPage,
        id: 'target-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Target Page' }],
          },
          Related: {
            type: 'relation',
            relation: [],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'Related', '--bidirectional']);

      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', expect.any(Object));
      expect(mockClient.patch).toHaveBeenCalledWith('pages/target-456', expect.any(Object));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('bidirectional'));
    });

    it('should handle invalid property type', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          NotRelation: {
            type: 'text',
          },
        },
      };
      const targetPage = { ...mockPage, id: 'target-456' };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });

      await expect(
        program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'NotRelation'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not a relation property'));
    });

    it('should handle bidirectional when target lacks property', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [],
          },
        },
      };
      const targetPage = {
        ...mockPage,
        id: 'target-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Target Page' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'Related', '--bidirectional']);

      expect(mockClient.patch).toHaveBeenCalledTimes(1); // Only source
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Could not create bidirectional link'));
    });

    it('should preserve existing relations when adding new one', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'existing-789' }],
          },
        },
      };
      const targetPage = { ...mockPage, id: 'target-456' };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'link', 'source-123', 'target-456', '--property', 'Related']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', {
        properties: {
          Related: {
            relation: [{ id: 'existing-789' }, { id: 'target-456' }],
          },
        },
      });
    });
  });

  describe('unlink', () => {
    it('should unlink two pages', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'target-456' }],
          },
        },
      };
      const targetPage = {
        ...mockPage,
        id: 'target-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Target Page' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'unlink', 'source-123', 'target-456', '--property', 'Related']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', {
        properties: {
          Related: {
            relation: [],
          },
        },
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Unlinked'));
    });

    it('should unlink bidirectionally with --bidirectional', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'target-456' }],
          },
        },
      };
      const targetPage = {
        ...mockPage,
        id: 'target-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Target Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'source-123' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'unlink', 'source-123', 'target-456', '--property', 'Related', '--bidirectional']);

      expect(mockClient.patch).toHaveBeenCalledTimes(2);
      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', expect.objectContaining({
        properties: {
          Related: {
            relation: [],
          },
        },
      }));
      expect(mockClient.patch).toHaveBeenCalledWith('pages/target-456', expect.objectContaining({
        properties: {
          Related: {
            relation: [],
          },
        },
      }));
    });

    it('should preserve other relations when unlinking', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'keep-789' }, { id: 'target-456' }],
          },
        },
      };
      const targetPage = { ...mockPage, id: 'target-456' };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });
      mockClient.patch.mockResolvedValue({});

      await program.parseAsync(['node', 'test', 'relations', 'unlink', 'source-123', 'target-456', '--property', 'Related']);

      expect(mockClient.patch).toHaveBeenCalledWith('pages/source-123', {
        properties: {
          Related: {
            relation: [{ id: 'keep-789' }],
          },
        },
      });
    });

    it('should handle invalid property type', async () => {
      const sourcePage = {
        ...mockPage,
        id: 'source-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Source Page' }],
          },
          NotRelation: {
            type: 'text',
          },
        },
      };
      const targetPage = { ...mockPage, id: 'target-456' };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/source-123') return sourcePage;
        if (path === 'pages/target-456') return targetPage;
        throw new Error('Unexpected path');
      });

      await expect(
        program.parseAsync(['node', 'test', 'relations', 'unlink', 'source-123', 'target-456', '--property', 'NotRelation'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not a relation property'));
    });
  });

  describe('graph', () => {
    it('should show relationship graph in text format', async () => {
      const rootPage = {
        ...mockPage,
        id: 'root-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Root Page' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'linked-456' }],
          },
        },
      };
      const linkedPage = {
        ...mockPage,
        id: 'linked-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Linked Page' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/root-123') return rootPage;
        if (path === 'pages/linked-456') return linkedPage;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'root-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('📊 Relationship Graph'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Root Page'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Links to'));
    });

    it('should respect --depth option', async () => {
      const rootPage = {
        ...mockPage,
        id: 'root-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Root' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'level1' }],
          },
        },
      };
      const level1Page = {
        ...mockPage,
        id: 'level1',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Level 1' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'level2' }],
          },
        },
      };
      const level2Page = {
        ...mockPage,
        id: 'level2',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Level 2' }],
          },
        },
      };

      let getCallCount = 0;
      mockClient.get.mockImplementation(async (path: string) => {
        getCallCount++;
        if (path === 'pages/root-123') return rootPage;
        if (path === 'pages/level1') return level1Page;
        if (path === 'pages/level2') return level2Page;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'root-123', '--depth', '2']);

      // Should fetch root, level1, and level2
      expect(mockClient.get).toHaveBeenCalledWith('pages/root-123');
      expect(mockClient.get).toHaveBeenCalledWith('pages/level1');
      expect(mockClient.get).toHaveBeenCalledWith('pages/level2');
    });

    it('should output JSON with --format json', async () => {
      const rootPage = {
        ...mockPage,
        id: 'root-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Root' }],
          },
        },
      };

      mockClient.get.mockResolvedValue(rootPage);

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'root-123', '--format', 'json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"nodes"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"edges"'));
    });

    it('should output DOT format with --format dot', async () => {
      const rootPage = {
        ...mockPage,
        id: 'root-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Root' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'linked-456' }],
          },
        },
      };
      const linkedPage = {
        ...mockPage,
        id: 'linked-456',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Linked' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/root-123') return rootPage;
        if (path === 'pages/linked-456') return linkedPage;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'root-123', '--format', 'dot']);

      expect(console.log).toHaveBeenCalledWith('digraph G {');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('rankdir=LR'));
      expect(console.log).toHaveBeenCalledWith('}');
    });

    it('should handle circular references gracefully', async () => {
      const page1 = {
        ...mockPage,
        id: 'page-1',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Page 1' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'page-2' }],
          },
        },
      };
      const page2 = {
        ...mockPage,
        id: 'page-2',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Page 2' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'page-1' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/page-1') return page1;
        if (path === 'pages/page-2') return page2;
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'page-1']);

      // Should not get stuck in infinite loop - visited set prevents re-processing
      expect(mockClient.get).toHaveBeenCalledWith('pages/page-1');
      expect(mockClient.get).toHaveBeenCalledWith('pages/page-2');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 nodes'));
    });

    it('should handle page fetch errors in traversal', async () => {
      const rootPage = {
        ...mockPage,
        id: 'root-123',
        properties: {
          Name: {
            type: 'title',
            title: [{ type: 'text', plain_text: 'Root' }],
          },
          Related: {
            type: 'relation',
            relation: [{ id: 'missing-456' }],
          },
        },
      };

      mockClient.get.mockImplementation(async (path: string) => {
        if (path === 'pages/root-123') return rootPage;
        if (path === 'pages/missing-456') throw new Error('Page not accessible');
        throw new Error('Unexpected path');
      });

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'root-123']);

      // Should handle the error gracefully and continue
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 nodes'));
    });

    it('should handle initial page fetch errors gracefully', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await program.parseAsync(['node', 'test', 'relations', 'graph', 'invalid-page']);

      // Should complete successfully but with 0 nodes (error caught in inner try-catch)
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 0 nodes'));
    });
  });
});
