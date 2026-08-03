import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('file-upload utils', () => {
  let mockClient: any;
  let mockFS: Map<string, Buffer>;
  let mod: typeof import('../../src/utils/file-upload');

  beforeEach(async () => {
    vi.resetModules();
    mockFS = new Map();

    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      postForm: vi.fn(),
    };

    vi.doMock('fs', () => ({
      existsSync: vi.fn((path: string) => mockFS.has(path)),
      promises: {
        stat: vi.fn(async (path: string) => {
          if (!mockFS.has(path)) {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          }
          return { size: mockFS.get(path)!.length };
        }),
        readFile: vi.fn(async (path: string) => {
          if (!mockFS.has(path)) throw new Error('ENOENT');
          return mockFS.get(path)!;
        }),
        open: vi.fn(async (path: string) => {
          const content = mockFS.get(path)!;
          return {
            read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
              content.copy(buffer, offset, position, position + length);
              return { bytesRead: length };
            }),
            close: vi.fn(),
          };
        }),
      },
    }));

    mod = await import('../../src/utils/file-upload');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('guessContentType', () => {
    it('maps known extensions', () => {
      expect(mod.guessContentType('shot.png')).toBe('image/png');
      expect(mod.guessContentType('doc.pdf')).toBe('application/pdf');
      expect(mod.guessContentType('clip.mp4')).toBe('video/mp4');
      expect(mod.guessContentType('song.mp3')).toBe('audio/mpeg');
    });

    it('is case-insensitive', () => {
      expect(mod.guessContentType('SHOT.PNG')).toBe('image/png');
    });

    it('falls back to octet-stream', () => {
      expect(mod.guessContentType('archive.unknownext')).toBe('application/octet-stream');
      expect(mod.guessContentType('noextension')).toBe('application/octet-stream');
    });
  });

  describe('mediaBlockTypeFor', () => {
    it('picks the block type Notion can render', () => {
      expect(mod.mediaBlockTypeFor('a.png')).toBe('image');
      expect(mod.mediaBlockTypeFor('a.pdf')).toBe('pdf');
      expect(mod.mediaBlockTypeFor('a.mp4')).toBe('video');
      expect(mod.mediaBlockTypeFor('a.mp3')).toBe('audio');
      expect(mod.mediaBlockTypeFor('a.zip')).toBe('file');
    });
  });

  describe('parseMediaType', () => {
    it('returns undefined when unset', () => {
      expect(mod.parseMediaType(undefined)).toBeUndefined();
    });

    it('accepts valid types', () => {
      expect(mod.parseMediaType('pdf')).toBe('pdf');
    });

    it('rejects invalid types', () => {
      expect(() => mod.parseMediaType('spreadsheet')).toThrow('Invalid type "spreadsheet"');
    });
  });

  describe('payload builders', () => {
    it('builds a file attachment with an optional name', () => {
      expect(mod.buildFileAttachment('up-1')).toEqual({
        type: 'file_upload',
        file_upload: { id: 'up-1' },
      });
      expect(mod.buildFileAttachment('up-1', 'a.png')).toEqual({
        type: 'file_upload',
        file_upload: { id: 'up-1' },
        name: 'a.png',
      });
    });

    it('builds a media block with a caption', () => {
      expect(mod.buildMediaBlock('image', 'up-1', 'Hello')).toEqual({
        object: 'block',
        type: 'image',
        image: {
          type: 'file_upload',
          file_upload: { id: 'up-1' },
          caption: [{ type: 'text', text: { content: 'Hello' } }],
        },
      });
    });

    it('omits the caption when not given', () => {
      expect(mod.buildMediaBlock('pdf', 'up-2')).toEqual({
        object: 'block',
        type: 'pdf',
        pdf: { type: 'file_upload', file_upload: { id: 'up-2' } },
      });
    });

    it('builds a comment attachment with the flat id field', () => {
      expect(mod.buildCommentAttachment('up-3')).toEqual({
        type: 'file_upload',
        file_upload_id: 'up-3',
      });
    });
  });

  describe('uploadLocalFile', () => {
    it('uploads a small file in a single part', async () => {
      mockFS.set('/tmp/shot.png', Buffer.alloc(1024));
      mockClient.post.mockResolvedValue({ id: 'up-1', status: 'pending' });
      mockClient.postForm.mockResolvedValue({ id: 'up-1', status: 'uploaded', filename: 'shot.png' });

      const result = await mod.uploadLocalFile(mockClient, '/tmp/shot.png');

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'single_part',
        filename: 'shot.png',
        content_type: 'image/png',
      });
      expect(mockClient.postForm).toHaveBeenCalledTimes(1);
      const [path, form] = mockClient.postForm.mock.calls[0];
      expect(path).toBe('file_uploads/up-1/send');
      expect(form.get('file')).toBeInstanceOf(Blob);
      expect(form.get('part_number')).toBeNull();
      expect(result.status).toBe('uploaded');
    });

    it('honors --name and --content-type overrides', async () => {
      mockFS.set('/tmp/raw', Buffer.alloc(10));
      mockClient.post.mockResolvedValue({ id: 'up-1' });
      mockClient.postForm.mockResolvedValue({ id: 'up-1', status: 'uploaded' });

      await mod.uploadLocalFile(mockClient, '/tmp/raw', { name: 'report.pdf', contentType: 'application/pdf' });

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'single_part',
        filename: 'report.pdf',
        content_type: 'application/pdf',
      });
    });

    it('splits files over 20 MiB into parts and completes the upload', async () => {
      const size = 25 * 1024 * 1024;
      mockFS.set('/tmp/big.mp4', Buffer.alloc(size));
      mockClient.post
        .mockResolvedValueOnce({ id: 'up-9', status: 'pending' })
        .mockResolvedValueOnce({ id: 'up-9', status: 'uploaded' });
      mockClient.postForm.mockResolvedValue({ id: 'up-9', status: 'pending' });

      const onProgress = vi.fn();
      const result = await mod.uploadLocalFile(mockClient, '/tmp/big.mp4', { onProgress });

      expect(mockClient.post).toHaveBeenNthCalledWith(1, 'file_uploads', {
        mode: 'multi_part',
        filename: 'big.mp4',
        content_type: 'video/mp4',
        number_of_parts: 3,
      });
      expect(mockClient.postForm).toHaveBeenCalledTimes(3);
      expect(mockClient.postForm.mock.calls.map((c: any[]) => c[1].get('part_number')))
        .toEqual(['1', '2', '3']);
      expect(mockClient.post).toHaveBeenNthCalledWith(2, 'file_uploads/up-9/complete', {});
      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenLastCalledWith(3, 3);
      expect(result.status).toBe('uploaded');
    });

    it('reports a clear error for a missing file', async () => {
      await expect(mod.uploadLocalFile(mockClient, '/tmp/nope.png'))
        .rejects.toThrow('File not found: /tmp/nope.png');
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('importExternalUrl', () => {
    it('imports a URL that is ready immediately', async () => {
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'uploaded', filename: 'logo.png' });

      const result = await mod.importExternalUrl(mockClient, 'https://example.com/img/logo.png');

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'external_url',
        external_url: 'https://example.com/img/logo.png',
        filename: 'logo.png',
      });
      expect(result.id).toBe('up-2');
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('polls while the import is pending', async () => {
      vi.useFakeTimers();
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'pending' });
      mockClient.get
        .mockResolvedValueOnce({ id: 'up-2', status: 'pending' })
        .mockResolvedValueOnce({ id: 'up-2', status: 'uploaded' });

      const promise = mod.importExternalUrl(mockClient, 'https://example.com/a.pdf');
      await vi.advanceTimersByTimeAsync(2500);

      await expect(promise).resolves.toMatchObject({ status: 'uploaded' });
      expect(mockClient.get).toHaveBeenCalledWith('file_uploads/up-2');
      expect(mockClient.get).toHaveBeenCalledTimes(2);
    });

    it('throws when the import fails', async () => {
      vi.useFakeTimers();
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'pending' });
      mockClient.get.mockResolvedValue({
        id: 'up-2',
        status: 'failed',
        file_import_result: { error: { message: 'Unreachable host' } },
      });

      const promise = mod.importExternalUrl(mockClient, 'https://example.com/a.pdf');
      const assertion = expect(promise).rejects.toThrow('Import failed for https://example.com/a.pdf: Unreachable host');
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('times out instead of polling forever', async () => {
      vi.useFakeTimers();
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'pending' });
      mockClient.get.mockResolvedValue({ id: 'up-2', status: 'pending' });

      const promise = mod.importExternalUrl(mockClient, 'https://example.com/a.pdf', { timeoutMs: 3000 });
      const assertion = expect(promise).rejects.toThrow('Timed out after 3s');
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it('fails with an actionable error when the URL has no file extension', async () => {
      await expect(mod.importExternalUrl(mockClient, 'https://images.example.com/photo-15067440'))
        .rejects.toThrow(/needs a filename with an extension.*Pass --name/s);
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('accepts an explicit --name for extensionless URLs', async () => {
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'uploaded' });

      await mod.importExternalUrl(mockClient, 'https://images.example.com/photo-15067440', {
        name: 'hero.jpg',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        'file_uploads',
        expect.objectContaining({ filename: 'hero.jpg' }),
      );
    });

    it('derives the extension from --content-type', async () => {
      mockClient.post.mockResolvedValue({ id: 'up-2', status: 'uploaded' });

      await mod.importExternalUrl(mockClient, 'https://images.example.com/photo-15067440', {
        contentType: 'image/jpeg',
      });

      expect(mockClient.post).toHaveBeenCalledWith('file_uploads', {
        mode: 'external_url',
        external_url: 'https://images.example.com/photo-15067440',
        filename: 'photo-15067440.jpg',
        content_type: 'image/jpeg',
      });
    });
  });

  describe('isFileSource', () => {
    it('recognizes file-ish values', () => {
      mockFS.set('LICENSE', Buffer.alloc(1));
      expect(mod.isFileSource('https://example.com/a.png')).toBe(true);
      expect(mod.isFileSource('./shot.png')).toBe(true);
      expect(mod.isFileSource('shot.png')).toBe(true);
      expect(mod.isFileSource('LICENSE')).toBe(true);
      expect(mod.isFileSource('1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f')).toBe(true);
    });

    it('treats emoji and plain words as non-files', () => {
      expect(mod.isFileSource('📝')).toBe(false);
      expect(mod.isFileSource('rocket')).toBe(false);
    });
  });

  describe('resolveFileUpload', () => {
    it('imports http(s) sources', async () => {
      mockClient.post.mockResolvedValue({ id: 'up-4', status: 'uploaded', filename: 'a.png' });

      const file = await mod.resolveFileUpload(mockClient, 'https://example.com/a.png');

      expect(file).toEqual({ id: 'up-4', name: 'a.png' });
    });

    it('reuses an existing upload ID without re-uploading', async () => {
      mockClient.get.mockResolvedValue({ id: 'up-5', status: 'uploaded', filename: 'old.pdf' });

      const file = await mod.resolveFileUpload(mockClient, '1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f');

      expect(mockClient.get).toHaveBeenCalledWith('file_uploads/1a2b3c4d-1a2b-3c4d-5e6f-7a8b9c0d1e2f');
      expect(mockClient.post).not.toHaveBeenCalled();
      expect(file).toEqual({ id: 'up-5', name: 'old.pdf' });
    });

    it('uploads local paths', async () => {
      mockFS.set('./a.png', Buffer.alloc(4));
      mockClient.post.mockResolvedValue({ id: 'up-6' });
      mockClient.postForm.mockResolvedValue({ id: 'up-6', status: 'uploaded', filename: 'a.png' });

      const file = await mod.resolveFileUpload(mockClient, './a.png');

      expect(file).toEqual({ id: 'up-6', name: 'a.png' });
    });

    it('resolves several sources in order', async () => {
      mockFS.set('a.png', Buffer.alloc(1));
      mockFS.set('b.pdf', Buffer.alloc(1));
      mockClient.post.mockResolvedValue({ id: 'up-x' });
      mockClient.postForm
        .mockResolvedValueOnce({ id: 'up-a', status: 'uploaded', filename: 'a.png' })
        .mockResolvedValueOnce({ id: 'up-b', status: 'uploaded', filename: 'b.pdf' });

      const files = await mod.resolveFileUploads(mockClient, ['a.png', 'b.pdf']);

      expect(files).toEqual([
        { id: 'up-a', name: 'a.png' },
        { id: 'up-b', name: 'b.pdf' },
      ]);
    });
  });
});
