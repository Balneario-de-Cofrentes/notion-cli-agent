import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

describe('Files Command', () => {
  let program: Command;
  let mockClient: any;
  let mockFS: Map<string, Buffer>;

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      postForm: vi.fn(),
    };

    vi.doMock('../../src/client', () => ({
      getClient: () => mockClient,
      initClient: vi.fn(),
    }));

    vi.doMock('fs', () => ({
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      promises: {
        stat: vi.fn(async (path: string) => {
          if (!mockFS.has(path)) throw new Error('ENOENT');
          return { size: mockFS.get(path)!.length };
        }),
        readFile: vi.fn(async (path: string) => mockFS.get(path)!),
        open: vi.fn(),
      },
    }));

    const { registerFilesCommand } = await import('../../src/commands/files');
    program = new Command();
    registerFilesCommand(program);
  });

  describe('file upload', () => {
    beforeEach(() => {
      mockFS.set('shot.png', Buffer.alloc(64));
      mockClient.post.mockResolvedValue({ id: 'up-1', status: 'pending' });
      mockClient.postForm.mockResolvedValue({ id: 'up-1', status: 'uploaded', filename: 'shot.png' });
    });

    it('uploads a file and prints its ID', async () => {
      await program.parseAsync(['node', 'test', 'file', 'upload', 'shot.png']);

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'single_part',
        filename: 'shot.png',
        content_type: 'image/png',
      });
      expect(mockClient.postForm).toHaveBeenCalledWith('file_uploads/up-1/send', expect.any(FormData));
      expect(console.log).toHaveBeenCalledWith('ID: up-1');
    });

    it('uploads multiple files', async () => {
      mockFS.set('doc.pdf', Buffer.alloc(32));

      await program.parseAsync(['node', 'test', 'file', 'upload', 'shot.png', 'doc.pdf']);

      expect(mockClient.postForm).toHaveBeenCalledTimes(2);
    });

    it('outputs raw JSON for a single file', async () => {
      await program.parseAsync(['node', 'test', 'file', 'upload', 'shot.png', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"id": "up-1"'));
    });

    it('rejects --name with multiple files', async () => {
      mockFS.set('doc.pdf', Buffer.alloc(32));

      await expect(
        program.parseAsync(['node', 'test', 'file', 'upload', 'shot.png', 'doc.pdf', '--name', 'x.png'])
      ).rejects.toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error:', '--name can only be used with a single file');
    });

    it('fails clearly when the file does not exist', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'file', 'upload', 'missing.png'])
      ).rejects.toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error:', 'File not found: missing.png');
    });
  });

  describe('file import', () => {
    it('imports a public URL', async () => {
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'uploaded', filename: 'logo.png' });

      await program.parseAsync(['node', 'test', 'file', 'import', 'https://example.com/logo.png']);

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'external_url',
        external_url: 'https://example.com/logo.png',
        filename: 'logo.png',
      });
      expect(console.log).toHaveBeenCalledWith('ID: up-2');
    });
  });

  describe('file list', () => {
    it('lists uploads', async () => {
      mockClient.get.mockResolvedValue({
        object: 'list',
        results: [{ id: 'up-1', status: 'uploaded', filename: 'a.png' }],
        has_more: false,
        next_cursor: null,
      });

      await program.parseAsync(['node', 'test', 'file', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith('file_uploads', { page_size: 100 });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('a.png'));
    });

    it('passes status and cursor filters', async () => {
      mockClient.get.mockResolvedValue({ object: 'list', results: [], has_more: false, next_cursor: null });

      await program.parseAsync([
        'node', 'test', 'file', 'list', '--status', 'pending', '--cursor', 'abc', '--limit', '5',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('file_uploads', {
        page_size: 5,
        status: 'pending',
        start_cursor: 'abc',
      });
      expect(console.log).toHaveBeenCalledWith('No file uploads found.');
    });

    it('outputs raw JSON', async () => {
      mockClient.get.mockResolvedValue({ object: 'list', results: [], has_more: false, next_cursor: null });

      await program.parseAsync(['node', 'test', 'file', 'list', '--json']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"object": "list"'));
    });
  });

  describe('file get', () => {
    it('retrieves an upload', async () => {
      mockClient.get.mockResolvedValue({
        id: '1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
        status: 'uploaded',
        filename: 'a.png',
        content_type: 'image/png',
      });

      await program.parseAsync([
        'node', 'test', 'file', 'get', '1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
      ]);

      expect(mockClient.get).toHaveBeenCalledWith('file_uploads/1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f');
      expect(console.log).toHaveBeenCalledWith('Type: image/png');
    });
  });

  describe('file attach', () => {
    beforeEach(() => {
      mockFS.set('shot.png', Buffer.alloc(64));
      mockClient.post.mockResolvedValue({ id: 'up-1' });
      mockClient.postForm.mockResolvedValue({ id: 'up-1', status: 'uploaded', filename: 'shot.png' });
      mockClient.patch.mockResolvedValue({ object: 'list', results: [] });
    });

    it('uploads and appends a detected image block', async () => {
      await program.parseAsync(['node', 'test', 'file', 'attach', 'page-123', 'shot.png']);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'image',
          image: { type: 'file_upload', file_upload: { id: 'up-1' } },
        }],
      });
      expect(console.log).toHaveBeenCalledWith('✅ Attached 1 file(s)');
    });

    it('honors --as, --caption and --after', async () => {
      await program.parseAsync([
        'node', 'test', 'file', 'attach', 'page-123', 'shot.png',
        '--as', 'file', '--caption', 'Diagram', '--after', 'block-9',
      ]);

      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'file',
          file: {
            type: 'file_upload',
            file_upload: { id: 'up-1' },
            caption: [{ type: 'text', text: { content: 'Diagram' } }],
          },
        }],
        position: { after_block: 'block-9' },
      });
    });

    it('rejects an invalid --as value', async () => {
      await expect(
        program.parseAsync(['node', 'test', 'file', 'attach', 'page-123', 'shot.png', '--as', 'sheet'])
      ).rejects.toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith(
        'Error:',
        'Invalid type "sheet". Use one of: image, video, audio, pdf, file',
      );
    });

    it('reuses an existing upload ID instead of uploading', async () => {
      mockClient.get.mockResolvedValue({ id: 'up-7', status: 'uploaded', filename: 'old.pdf' });

      await program.parseAsync([
        'node', 'test', 'file', 'attach', 'page-123', '1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
      ]);

      expect(mockClient.postForm).not.toHaveBeenCalled();
      expect(mockClient.patch).toHaveBeenCalledWith('blocks/page-123/children', {
        children: [{
          object: 'block',
          type: 'pdf',
          pdf: { type: 'file_upload', file_upload: { id: 'up-7' } },
        }],
      });
    });
  });
});
