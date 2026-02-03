import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockComment, mockCommentList, createPaginatedResult } from '../fixtures/notion-data';

describe('Comments Command', () => {
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
    const { registerCommentsCommand } = await import('../../src/commands/comments');
    program = new Command();
    registerCommentsCommand(program);
  });

  describe('comment list', () => {
    it('should list comments on a page', async () => {
      mockClient.get.mockResolvedValue(mockCommentList);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123']);

      expect(mockClient.get).toHaveBeenCalledWith('comments', {
        block_id: 'page-123',
        page_size: 100,
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('💬'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This is a test comment.'));
    });

    it('should display empty message when no comments', async () => {
      const emptyResult = createPaginatedResult([]);

      mockClient.get.mockResolvedValue(emptyResult);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123']);

      expect(console.log).toHaveBeenCalledWith('No comments found.');
    });

    it('should limit results', async () => {
      mockClient.get.mockResolvedValue(mockCommentList);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123', '--limit', '50']);

      expect(mockClient.get).toHaveBeenCalledWith('comments', {
        block_id: 'page-123',
        page_size: 50,
      });
    });

    it('should use cursor for pagination', async () => {
      mockClient.get.mockResolvedValue(mockCommentList);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123', '--cursor', 'cursor-123']);

      expect(mockClient.get).toHaveBeenCalledWith('comments', {
        block_id: 'page-123',
        page_size: 100,
        start_cursor: 'cursor-123',
      });
    });

    it('should show pagination hint when has_more is true', async () => {
      const result = createPaginatedResult([mockComment], 'next-cursor-123', true);

      mockClient.get.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123']);

      expect(console.log).toHaveBeenCalledWith(
        'More results available. Use --cursor next-cursor-123'
      );
    });

    it('should display comment ID and date', async () => {
      mockClient.get.mockResolvedValue(mockCommentList);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: comment-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Date:'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockCommentList);

      await program.parseAsync(['node', 'test', 'comment', 'list', 'page-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });
  });

  describe('comment get', () => {
    it('should get specific comment', async () => {
      mockClient.get.mockResolvedValue(mockComment);

      await program.parseAsync(['node', 'test', 'comment', 'get', 'comment-123']);

      expect(mockClient.get).toHaveBeenCalledWith('comments/comment-123');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('💬'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This is a test comment.'));
    });

    it('should display comment details', async () => {
      mockClient.get.mockResolvedValue(mockComment);

      await program.parseAsync(['node', 'test', 'comment', 'get', 'comment-123']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID: comment-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Discussion: disc-123'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Date:'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockComment);

      await program.parseAsync(['node', 'test', 'comment', 'get', 'comment-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "comment"'));
    });
  });

  describe('comment create', () => {
    it('should create comment on page', async () => {
      const createdComment = {
        ...mockComment,
        id: 'new-comment-123',
      };

      mockClient.post.mockResolvedValue(createdComment);

      await program.parseAsync([
        'node', 'test', 'comment', 'create',
        '--page', 'page-123',
        '--text', 'My comment',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('comments', {
        parent: { page_id: 'page-123' },
        rich_text: [{ type: 'text', text: { content: 'My comment' } }],
      });

      expect(console.log).toHaveBeenCalledWith('✅ Comment created');
      expect(console.log).toHaveBeenCalledWith('ID:', 'new-comment-123');
      expect(console.log).toHaveBeenCalledWith('Discussion:', 'disc-123');
    });

    it('should create comment in discussion', async () => {
      const createdComment = {
        ...mockComment,
        id: 'reply-comment-123',
      };

      mockClient.post.mockResolvedValue(createdComment);

      await program.parseAsync([
        'node', 'test', 'comment', 'create',
        '--discussion', 'disc-123',
        '--text', 'Reply comment',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('comments', {
        discussion_id: 'disc-123',
        rich_text: [{ type: 'text', text: { content: 'Reply comment' } }],
      });
    });

    it('should error when neither --page nor --discussion is provided', async () => {
      await expect(
        program.parseAsync([
          'node', 'test', 'comment', 'create',
          '--text', 'My comment',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith(
        'Error: Either --page or --discussion is required'
      );
    });

    it('should output JSON when --json flag is used', async () => {
      const createdComment = {
        ...mockComment,
        id: 'new-comment-123',
      };

      mockClient.post.mockResolvedValue(createdComment);

      await program.parseAsync([
        'node', 'test', 'comment', 'create',
        '--page', 'page-123',
        '--text', 'My comment',
        '--json',
      ]);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "comment"'));
    });
  });

  describe('Error handling', () => {
    it('should handle API errors on list command', async () => {
      mockClient.get.mockRejectedValue(new Error('Page not found'));

      await expect(
        program.parseAsync(['node', 'test', 'comment', 'list', 'invalid-page'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Page not found');
    });

    it('should handle API errors on get command', async () => {
      mockClient.get.mockRejectedValue(new Error('Comment not found'));

      await expect(
        program.parseAsync(['node', 'test', 'comment', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Comment not found');
    });

    it('should handle API errors on create command', async () => {
      mockClient.post.mockRejectedValue(new Error('Permission denied'));

      await expect(
        program.parseAsync([
          'node', 'test', 'comment', 'create',
          '--page', 'page-123',
          '--text', 'My comment',
        ])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Permission denied');
    });
  });
});
