import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { mockUser, mockUserList, createPaginatedResult } from '../fixtures/notion-data';

describe('Users Command', () => {
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
    const { registerUsersCommand } = await import('../../src/commands/users');
    program = new Command();
    registerUsersCommand(program);
  });

  describe('user me', () => {
    it('should get current user', async () => {
      const botUser = {
        ...mockUser,
        type: 'bot' as const,
        bot: { owner: { type: 'workspace', workspace: true } },
      };

      mockClient.get.mockResolvedValue(botUser);

      await program.parseAsync(['node', 'test', 'user', 'me']);

      expect(mockClient.get).toHaveBeenCalledWith('users/me');
      expect(console.log).toHaveBeenCalledWith('🤖 Current User (Integration)');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Name:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ID:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Type:'));
    });

    it('should display workspace owner info', async () => {
      const botUser = {
        ...mockUser,
        type: 'bot' as const,
        name: 'Integration Bot',
        bot: { owner: { type: 'workspace', workspace: true } },
      };

      mockClient.get.mockResolvedValue(botUser);

      await program.parseAsync(['node', 'test', 'user', 'me']);

      expect(console.log).toHaveBeenCalledWith('Owner: Workspace');
    });

    it('should handle user without name', async () => {
      const userWithoutName = {
        ...mockUser,
        name: undefined,
      };

      mockClient.get.mockResolvedValue(userWithoutName);

      await program.parseAsync(['node', 'test', 'user', 'me']);

      expect(console.log).toHaveBeenCalledWith('Name: Unknown');
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockUser);

      await program.parseAsync(['node', 'test', 'user', 'me', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "user"'));
    });
  });

  describe('user list', () => {
    it('should list all users', async () => {
      mockClient.get.mockResolvedValue(mockUserList);

      await program.parseAsync(['node', 'test', 'user', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith('users', { page_size: 100 });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('👤'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test User'));
    });

    it('should limit results', async () => {
      mockClient.get.mockResolvedValue(mockUserList);

      await program.parseAsync(['node', 'test', 'user', 'list', '--limit', '50']);

      expect(mockClient.get).toHaveBeenCalledWith('users', { page_size: 50 });
    });

    it('should use cursor for pagination', async () => {
      mockClient.get.mockResolvedValue(mockUserList);

      await program.parseAsync(['node', 'test', 'user', 'list', '--cursor', 'cursor-123']);

      expect(mockClient.get).toHaveBeenCalledWith('users', {
        page_size: 100,
        start_cursor: 'cursor-123'
      });
    });

    it('should show pagination hint when has_more is true', async () => {
      const result = createPaginatedResult([mockUser], 'next-cursor-123', true);

      mockClient.get.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'user', 'list']);

      expect(console.log).toHaveBeenCalledWith(
        'More results available. Use --cursor next-cursor-123'
      );
    });

    it('should display person users with email', async () => {
      const personUser = {
        ...mockUser,
        type: 'person' as const,
        name: 'John Doe',
        person: { email: 'john@example.com' },
      };

      const result = createPaginatedResult([personUser]);

      mockClient.get.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'user', 'list']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('👤'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('John Doe'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Email: john@example.com'));
    });

    it('should display bot users', async () => {
      const botUser = {
        ...mockUser,
        type: 'bot' as const,
        name: 'Bot User',
      };

      const result = createPaginatedResult([botUser]);

      mockClient.get.mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'user', 'list']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🤖'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Bot User'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockUserList);

      await program.parseAsync(['node', 'test', 'user', 'list', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });
  });

  describe('user get', () => {
    it('should get specific user', async () => {
      mockClient.get.mockResolvedValue(mockUser);

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-123']);

      expect(mockClient.get).toHaveBeenCalledWith('users/user-123');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('👤'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test User'));
    });

    it('should display email for person users', async () => {
      const personUser = {
        ...mockUser,
        type: 'person' as const,
        person: { email: 'test@example.com' },
      };

      mockClient.get.mockResolvedValue(personUser);

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-123']);

      expect(console.log).toHaveBeenCalledWith('Email: test@example.com');
    });

    it('should display avatar URL when available', async () => {
      const userWithAvatar = {
        ...mockUser,
        avatar_url: 'https://example.com/avatar.jpg',
      };

      mockClient.get.mockResolvedValue(userWithAvatar);

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-123']);

      expect(console.log).toHaveBeenCalledWith('Avatar: https://example.com/avatar.jpg');
    });

    it('should display bot users correctly', async () => {
      const botUser = {
        ...mockUser,
        type: 'bot' as const,
        name: 'Integration Bot',
      };

      mockClient.get.mockResolvedValue(botUser);

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-bot']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🤖'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Integration Bot'));
    });

    it('should output JSON when --json flag is used', async () => {
      mockClient.get.mockResolvedValue(mockUser);

      await program.parseAsync(['node', 'test', 'user', 'get', 'user-123', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "user"'));
    });
  });

  describe('Error handling', () => {
    it('should handle API errors on me command', async () => {
      mockClient.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(
        program.parseAsync(['node', 'test', 'user', 'me'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Unauthorized');
    });

    it('should handle API errors on list command', async () => {
      mockClient.get.mockRejectedValue(new Error('Rate limited'));

      await expect(
        program.parseAsync(['node', 'test', 'user', 'list'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'Rate limited');
    });

    it('should handle API errors on get command', async () => {
      mockClient.get.mockRejectedValue(new Error('User not found'));

      await expect(
        program.parseAsync(['node', 'test', 'user', 'get', 'invalid-id'])
      ).rejects.toThrow('process.exit(1)');

      expect(console.error).toHaveBeenCalledWith('Error:', 'User not found');
    });
  });
});
