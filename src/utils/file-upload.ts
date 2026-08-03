/**
 * File uploads — Notion File Upload API.
 *
 * Single source of truth for turning a "source" (local path, public URL, or an
 * existing file_upload id) into an attachable `file_upload` id, plus the
 * payload shapes Notion expects at each attach point (blocks, page icon/cover,
 * `files` properties, comment attachments).
 *
 * Flow: POST /file_uploads (create) → POST /file_uploads/:id/send (bytes)
 *       → POST /file_uploads/:id/complete (multi-part only).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { NotionClient } from '../client.js';
import { isFullNotionId, normalizeNotionId } from './workspace-resolver.js';

/** Files larger than this must use multi-part upload. */
export const SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;
/** Part size for multi-part uploads. Notion requires 5–20 MiB per part (last may be smaller). */
export const MULTI_PART_CHUNK_BYTES = 10 * 1024 * 1024;
/** Notion caps comments at 3 attachments. */
export const MAX_COMMENT_ATTACHMENTS = 3;

const DEFAULT_IMPORT_TIMEOUT_MS = 60_000;
const IMPORT_POLL_INTERVAL_MS = 1_000;

export type MediaBlockType = 'image' | 'video' | 'audio' | 'pdf' | 'file';

export interface FileUpload {
  id: string;
  status: 'pending' | 'uploaded' | 'expired' | 'failed';
  filename?: string;
  content_type?: string;
  content_length?: number;
  expiry_time?: string;
  number_of_parts?: { total: number; sent: number };
  file_import_result?: { error?: { message?: string; type?: string } };
}

/** An upload resolved to something attachable. */
export interface ResolvedFile {
  id: string;
  /** Best-known filename — used for display names and media-block detection. */
  name: string;
}

export interface UploadOptions {
  /** Override the filename stored in Notion. */
  name?: string;
  /** Override the detected MIME type. */
  contentType?: string;
  /** Called after each part of a multi-part upload. */
  onProgress?: (sentParts: number, totalParts: number) => void;
  /** Max wait for an external_url import to finish (ms). */
  timeoutMs?: number;
}

// ─── MIME detection ──────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.heic': 'image/heic', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  // Documents
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.html': 'text/html', '.json': 'application/json', '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Audio
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/opus', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  // Video
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.flv': 'video/x-flv',
};

export const MEDIA_BLOCK_TYPES: MediaBlockType[] = ['image', 'video', 'audio', 'pdf', 'file'];

/**
 * Validate an explicit media-block type from user input. Returns undefined when
 * unset, so callers fall back to detection from the filename.
 */
export function parseMediaType(value?: string): MediaBlockType | undefined {
  if (!value) return undefined;
  if (!MEDIA_BLOCK_TYPES.includes(value as MediaBlockType)) {
    throw new Error(`Invalid type "${value}". Use one of: ${MEDIA_BLOCK_TYPES.join(', ')}`);
  }
  return value as MediaBlockType;
}

/** MIME type for a filename, `application/octet-stream` when unknown. */
export function guessContentType(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

/**
 * Pick the Notion block type that can render this file.
 * Notion rejects mismatches (a video in an image block), so this drives
 * auto-detection when the caller does not pass an explicit type.
 */
export function mediaBlockTypeFor(filename: string): MediaBlockType {
  const type = guessContentType(filename);
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'file';
}

// ─── Attach payload shapes ───────────────────────────────────────────────────

/** Payload for a `files` property entry, a page icon, or a page cover. */
export function buildFileAttachment(id: string, name?: string): Record<string, unknown> {
  return {
    type: 'file_upload',
    file_upload: { id },
    ...(name ? { name } : {}),
  };
}

/** Payload for an image/video/audio/pdf/file block. */
export function buildMediaBlock(
  type: MediaBlockType,
  id: string,
  caption?: string,
): Record<string, unknown> {
  return {
    object: 'block',
    type,
    [type]: {
      type: 'file_upload',
      file_upload: { id },
      ...(caption ? { caption: [{ type: 'text', text: { content: caption } }] } : {}),
    },
  };
}

/**
 * Payload for a comment attachment. Notion uses a flat `file_upload_id` here,
 * unlike every other attach point.
 */
export function buildCommentAttachment(id: string): Record<string, unknown> {
  return { type: 'file_upload', file_upload_id: id };
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Upload a local file, choosing single-part or multi-part based on its size.
 * Resolves once Notion reports the upload as complete.
 */
export async function uploadLocalFile(
  client: NotionClient,
  filePath: string,
  options: UploadOptions = {},
): Promise<FileUpload> {
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = options.name || path.basename(filePath);
  const contentType = options.contentType || guessContentType(filename);

  return size > SINGLE_PART_MAX_BYTES
    ? uploadMultiPart(client, filePath, size, filename, contentType, options.onProgress)
    : uploadSinglePart(client, filePath, filename, contentType);
}

async function uploadSinglePart(
  client: NotionClient,
  filePath: string,
  filename: string,
  contentType: string,
): Promise<FileUpload> {
  const upload = await client.post<FileUpload>('file_uploads', {
    mode: 'single_part',
    filename,
    content_type: contentType,
  });

  const form = new FormData();
  form.append('file', new Blob([await fs.promises.readFile(filePath)], { type: contentType }), filename);

  return client.postForm<FileUpload>(`file_uploads/${upload.id}/send`, form);
}

async function uploadMultiPart(
  client: NotionClient,
  filePath: string,
  size: number,
  filename: string,
  contentType: string,
  onProgress?: (sentParts: number, totalParts: number) => void,
): Promise<FileUpload> {
  const totalParts = Math.ceil(size / MULTI_PART_CHUNK_BYTES);

  const upload = await client.post<FileUpload>('file_uploads', {
    mode: 'multi_part',
    filename,
    content_type: contentType,
    number_of_parts: totalParts,
  });

  const handle = await fs.promises.open(filePath, 'r');
  try {
    for (let part = 1; part <= totalParts; part++) {
      const offset = (part - 1) * MULTI_PART_CHUNK_BYTES;
      const length = Math.min(MULTI_PART_CHUNK_BYTES, size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);

      const form = new FormData();
      form.append('file', new Blob([buffer], { type: contentType }), filename);
      form.append('part_number', String(part));

      await client.postForm(`file_uploads/${upload.id}/send`, form);
      onProgress?.(part, totalParts);
    }
  } finally {
    await handle.close();
  }

  return client.post<FileUpload>(`file_uploads/${upload.id}/complete`, {});
}

/**
 * Import a file from a publicly accessible URL. Notion fetches it server-side,
 * so this polls until the upload leaves `pending`.
 */
export async function importExternalUrl(
  client: NotionClient,
  url: string,
  options: UploadOptions = {},
): Promise<FileUpload> {
  let upload = await client.post<FileUpload>('file_uploads', {
    mode: 'external_url',
    external_url: url,
    filename: importFilename(url, options),
    ...(options.contentType ? { content_type: options.contentType } : {}),
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (upload.status === 'pending') {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s importing ${url}`);
    }
    await new Promise(resolve => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS));
    upload = await client.get<FileUpload>(`file_uploads/${upload.id}`);
  }

  if (upload.status !== 'uploaded') {
    const reason = upload.file_import_result?.error?.message || upload.status;
    throw new Error(`Import failed for ${url}: ${reason}`);
  }

  return upload;
}

/** Derive a filename from a URL path. Empty when the URL carries no basename. */
function filenameFromUrl(url: string): string {
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && base !== '/') return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return '';
}

/** First extension registered for a MIME type, e.g. `image/jpeg` → `.jpg`. */
function extensionForContentType(contentType: string): string | undefined {
  return Object.keys(CONTENT_TYPES).find(ext => CONTENT_TYPES[ext] === contentType);
}

/**
 * Filename to register for a URL import. Notion requires one *with an
 * extension*, but plenty of CDN URLs end in a bare id (`/photo-1506744038`),
 * so fall back to the content type and otherwise fail with an actionable error
 * instead of letting Notion return a cryptic 400.
 */
function importFilename(url: string, options: UploadOptions): string {
  const filename = options.name || filenameFromUrl(url);
  if (filename && path.extname(filename)) return filename;

  const extension = options.contentType && extensionForContentType(options.contentType);
  if (extension) return `${filename || 'download'}${extension}`;

  throw new Error(
    `Notion needs a filename with an extension to import a URL, and "${url}" has none. ` +
    `Pass --name <name.ext> or --content-type <mime>.`,
  );
}

/**
 * True when a value is meant as a file source rather than literal content
 * (an emoji, for `--icon`). Recognizes URLs, upload ids, existing paths, and
 * anything that merely looks like a path — a missing path then fails with a
 * clear "File not found" instead of being sent to Notion as an emoji.
 */
export function isFileSource(value: string): boolean {
  return /^https?:\/\//i.test(value)
    || isFullNotionId(value)
    || fs.existsSync(value)
    || /[/\\]/.test(value)
    || /\.[A-Za-z0-9]{1,5}$/.test(value);
}

/**
 * Turn any supported source into an attachable upload:
 *   - an http(s) URL      → imported via external_url
 *   - a full Notion id    → an existing file_upload (verified, filename read back)
 *   - anything else       → treated as a local path and uploaded
 *
 * A local file that exists wins over the id interpretation, so a file literally
 * named like a UUID still uploads.
 */
export async function resolveFileUpload(
  client: NotionClient,
  source: string,
  options: UploadOptions = {},
): Promise<ResolvedFile> {
  if (/^https?:\/\//i.test(source)) {
    const upload = await importExternalUrl(client, source, options);
    return { id: upload.id, name: options.name || upload.filename || filenameFromUrl(source) };
  }

  if (isFullNotionId(source) && !fs.existsSync(source)) {
    const id = normalizeNotionId(source);
    const upload = await client.get<FileUpload>(`file_uploads/${id}`);
    return { id: upload.id, name: options.name || upload.filename || id };
  }

  const upload = await uploadLocalFile(client, source, options);
  return { id: upload.id, name: options.name || upload.filename || path.basename(source) };
}

/** Resolve several sources in order (sequential — Notion rate-limits uploads). */
export async function resolveFileUploads(
  client: NotionClient,
  sources: string[],
  options: UploadOptions = {},
): Promise<ResolvedFile[]> {
  const resolved: ResolvedFile[] = [];
  for (const source of sources) {
    resolved.push(await resolveFileUpload(client, source, options));
  }
  return resolved;
}
