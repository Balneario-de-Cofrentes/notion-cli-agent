import { vi } from 'vitest';

interface MockFileSystem {
  [path: string]: string | Buffer;
}

/**
 * Normalize file paths for cross-platform compatibility
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Create an in-memory file system mock
 */
export function createMockFS(initialFiles: MockFileSystem = {}) {
  const fileStore = new Map<string, string | Buffer>(Object.entries(initialFiles));

  return {
    // File store for inspection
    files: fileStore,

    // Mock implementations
    readFileSync: (path: string, encoding?: BufferEncoding | { encoding?: BufferEncoding }): any => {
      const normalizedPath = normalizePath(path);
      if (!fileStore.has(normalizedPath)) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }

      const content = fileStore.get(normalizedPath)!;

      // Handle encoding parameter (can be string or object)
      const enc = typeof encoding === 'string' ? encoding : encoding?.encoding;

      if (enc === 'utf8' || enc === 'utf-8') {
        return content.toString();
      }

      return content;
    },

    writeFileSync: (path: string, data: string | Buffer): void => {
      const normalizedPath = normalizePath(path);
      fileStore.set(normalizedPath, data);
    },

    existsSync: (path: string): boolean => {
      const normalizedPath = normalizePath(path);
      return fileStore.has(normalizedPath);
    },

    mkdirSync: (path: string, options?: any): string => {
      const normalizedPath = normalizePath(path);
      // Store directories as empty strings
      fileStore.set(normalizedPath, '');
      return normalizedPath;
    },

    readdirSync: (path: string, options?: any): any => {
      const normalizedPath = normalizePath(path);
      const withFileTypes = options?.withFileTypes;

      // Get all files/dirs that start with this path
      const entries: string[] = [];
      const prefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;

      for (const filePath of fileStore.keys()) {
        if (filePath.startsWith(prefix)) {
          const relativePath = filePath.slice(prefix.length);
          const firstSegment = relativePath.split('/')[0];
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment);
          }
        }
      }

      if (withFileTypes) {
        return entries.map(name => ({
          name,
          isFile: () => fileStore.has(`${prefix}${name}`),
          isDirectory: () => !fileStore.has(`${prefix}${name}`),
        }));
      }

      return entries;
    },

    unlinkSync: (path: string): void => {
      const normalizedPath = normalizePath(path);
      if (!fileStore.has(normalizedPath)) {
        const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      fileStore.delete(normalizedPath);
    },

    statSync: (path: string): any => {
      const normalizedPath = normalizePath(path);
      if (!fileStore.has(normalizedPath)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }

      const content = fileStore.get(normalizedPath)!;
      return {
        isFile: () => content.length > 0,
        isDirectory: () => content.length === 0,
        size: content.length,
      };
    },
  };
}
