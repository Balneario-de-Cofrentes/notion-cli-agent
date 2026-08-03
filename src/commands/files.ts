/**
 * File commands - upload files and attach them to pages
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';
import { buildBlockPosition } from '../utils/notion-helpers.js';
import { normalizeNotionId } from '../utils/workspace-resolver.js';
import {
  uploadLocalFile,
  importExternalUrl,
  resolveFileUpload,
  buildMediaBlock,
  mediaBlockTypeFor,
  parseMediaType,
  MEDIA_BLOCK_TYPES,
  type FileUpload,
} from '../utils/file-upload.js';
import type { PaginatedResponse } from '../types/notion.js';

/** Progress line on stderr so --json output on stdout stays parseable. */
function reportParts(sent: number, total: number): void {
  process.stderr.write(`\rUploading part ${sent}/${total}...${sent === total ? '\n' : ''}`);
}

function printUpload(upload: FileUpload, json: boolean): void {
  if (json) {
    console.log(formatOutput(upload));
    return;
  }
  console.log(`✅ ${upload.filename || 'File'} uploaded`);
  console.log(`ID: ${upload.id}`);
}

export function registerFilesCommand(program: Command): void {
  const files = program
    .command('file')
    .alias('files')
    .description('Upload files and attach them to pages, properties, and comments');

  // Upload local files
  files
    .command('upload <path...>')
    .description('Upload local file(s), printing the file_upload ID for each')
    .option('--name <name>', 'Override the stored filename (single file only)')
    .option('--content-type <mime>', 'Override the detected MIME type')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (paths: string[], options) => {
      if (options.name && paths.length > 1) {
        throw new Error('--name can only be used with a single file');
      }

      const client = getClient();
      const uploads: FileUpload[] = [];

      for (const filePath of paths) {
        uploads.push(await uploadLocalFile(client, filePath, {
          name: options.name,
          contentType: options.contentType,
          onProgress: reportParts,
        }));
      }

      if (options.json) {
        console.log(formatOutput(uploads.length === 1 ? uploads[0] : uploads));
        return;
      }

      for (const upload of uploads) printUpload(upload, false);
    }));

  // Import from a public URL
  files
    .command('import <url>')
    .description('Import a file from a publicly accessible URL')
    .option('--name <name>', 'Override the stored filename')
    .option('--content-type <mime>', 'Override the MIME type')
    .option('--timeout <seconds>', 'Max wait for the import to finish', '60')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (url: string, options) => {
      const upload = await importExternalUrl(getClient(), url, {
        name: options.name,
        contentType: options.contentType,
        timeoutMs: parseInt(options.timeout, 10) * 1000,
      });
      printUpload(upload, options.json);
    }));

  // List uploads
  files
    .command('list')
    .description('List file uploads in the workspace')
    .option('-l, --limit <number>', 'Max results', '100')
    .option('--status <status>', 'Filter by status: pending, uploaded, expired, failed')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const query: Record<string, string | number> = {};
      if (options.limit) query.page_size = parseInt(options.limit, 10);
      if (options.status) query.status = options.status;
      if (options.cursor) query.start_cursor = options.cursor;

      const result = await getClient().get('file_uploads', query) as PaginatedResponse<FileUpload>;

      if (options.json) {
        console.log(formatOutput(result));
        return;
      }

      if (result.results.length === 0) {
        console.log('No file uploads found.');
        return;
      }

      for (const upload of result.results) {
        console.log(`📎 ${upload.filename || '(unnamed)'} [${upload.status}]`);
        console.log(`   ID: ${upload.id}`);
      }

      if (result.has_more) {
        console.log(`\nMore results available. Use --cursor ${result.next_cursor}`);
      }
    }));

  // Get one upload
  files
    .command('get <file_upload_id>')
    .description('Retrieve a file upload by ID')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (uploadId: string, options) => {
      const upload = await getClient().get(`file_uploads/${normalizeNotionId(uploadId)}`) as FileUpload;

      if (options.json) {
        console.log(formatOutput(upload));
      } else {
        console.log(`📎 ${upload.filename || '(unnamed)'} [${upload.status}]`);
        console.log(`ID: ${upload.id}`);
        if (upload.content_type) console.log(`Type: ${upload.content_type}`);
        if (upload.expiry_time) console.log(`Expires: ${new Date(upload.expiry_time).toLocaleString()}`);
      }
    }));

  // Upload + attach in one call
  files
    .command('attach <page_id> <source...>')
    .description('Upload file(s), URL(s), or upload ID(s) and append them to a page')
    .option('--as <type>', `Force block type: ${MEDIA_BLOCK_TYPES.join(', ')} (default: detect)`)
    .option('--caption <text>', 'Caption (applied to every attached block)')
    .option('--after <block_id>', 'Insert after this block')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, sources: string[], options) => {
      const client = getClient();
      const forcedType = parseMediaType(options.as);

      const children: Array<Record<string, unknown>> = [];
      for (const source of sources) {
        const file = await resolveFileUpload(client, source, { onProgress: reportParts });
        children.push(buildMediaBlock(forcedType || mediaBlockTypeFor(file.name), file.id, options.caption));
      }

      const result = await client.patch(`blocks/${normalizeNotionId(pageId)}/children`, {
        children,
        ...buildBlockPosition(options.after),
      });

      if (options.json) {
        console.log(formatOutput(result));
      } else {
        console.log(`✅ Attached ${children.length} file(s)`);
      }
    }));
}
