/**
 * Comments commands - list and create comments
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';

interface Comment {
  id: string;
  discussion_id: string;
  created_time: string;
  created_by: { id: string; name?: string };
  rich_text: Array<{ plain_text: string }>;
}

export function registerCommentsCommand(program: Command): void {
  const comments = program
    .command('comment')
    .alias('comments')
    .description('Manage comments on pages and blocks');

  // List comments
  comments
    .command('list <block_id>')
    .description('List comments on a page or block')
    .option('-l, --limit <number>', 'Max results', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('-j, --json', 'Output raw JSON')
    .action(async (blockId: string, options) => {
      try {
        const client = getClient();
        
        const query: Record<string, string | number> = { block_id: blockId };
        if (options.limit) query.page_size = parseInt(options.limit, 10);
        if (options.cursor) query.start_cursor = options.cursor;

        const result = await client.get('comments', query);

        if (options.json) {
          console.log(formatOutput(result));
          return;
        }

        const typedResult = result as {
          results: Comment[];
          has_more: boolean;
          next_cursor: string | null;
        };

        if (typedResult.results.length === 0) {
          console.log('No comments found.');
          return;
        }

        for (const comment of typedResult.results) {
          const text = comment.rich_text.map(t => t.plain_text).join('');
          const date = new Date(comment.created_time).toLocaleString();
          console.log(`💬 ${text}`);
          console.log(`   ID: ${comment.id}`);
          console.log(`   Date: ${date}`);
          console.log('');
        }

        if (typedResult.has_more) {
          console.log(`More results available. Use --cursor ${typedResult.next_cursor}`);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Get comment
  comments
    .command('get <comment_id>')
    .description('Retrieve a specific comment')
    .option('-j, --json', 'Output raw JSON')
    .action(async (commentId: string, options) => {
      try {
        const client = getClient();
        const comment = await client.get(`comments/${commentId}`) as Comment;

        if (options.json) {
          console.log(formatOutput(comment));
        } else {
          const text = comment.rich_text.map(t => t.plain_text).join('');
          console.log(`💬 ${text}`);
          console.log(`ID: ${comment.id}`);
          console.log(`Discussion: ${comment.discussion_id}`);
          console.log(`Date: ${new Date(comment.created_time).toLocaleString()}`);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  // Create comment
  comments
    .command('create')
    .description('Create a new comment')
    .option('--page <page_id>', 'Page ID to comment on (starts new discussion)')
    .option('--discussion <discussion_id>', 'Discussion ID to reply to')
    .requiredOption('-t, --text <text>', 'Comment text')
    .option('-j, --json', 'Output raw JSON')
    .action(async (options) => {
      try {
        if (!options.page && !options.discussion) {
          console.error('Error: Either --page or --discussion is required');
          process.exit(1);
        }

        const client = getClient();

        const body: Record<string, unknown> = {
          rich_text: [{ type: 'text', text: { content: options.text } }],
        };

        if (options.page) {
          body.parent = { page_id: options.page };
        } else if (options.discussion) {
          body.discussion_id = options.discussion;
        }

        const comment = await client.post('comments', body) as Comment;

        if (options.json) {
          console.log(formatOutput(comment));
        } else {
          console.log('✅ Comment created');
          console.log('ID:', comment.id);
          console.log('Discussion:', comment.discussion_id);
        }
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });
}
