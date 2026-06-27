/**
 * Users commands - list users and get current user
 */
import { Command } from 'commander';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';
import {
  fishGuests,
  readGuests,
  getGuestsPath,
} from '../utils/people-resolver.js';
import type { PaginatedResponse } from '../types/notion.js';

interface User {
  object: 'user';
  id: string;
  type: 'person' | 'bot';
  name?: string;
  avatar_url?: string;
  person?: { email: string };
  bot?: { owner: { type: string; workspace?: boolean } };
}

export function registerUsersCommand(program: Command): void {
  const users = program
    .command('user')
    .alias('users')
    .description('Manage Notion users');

  // Current user (me)
  users
    .command('me')
    .description('Get the current bot user')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();
      const user = await client.get('users/me') as User;

      if (options.json) {
        console.log(formatOutput(user));
      } else {
        console.log('🤖 Current User (Integration)');
        console.log(`Name: ${user.name || 'Unknown'}`);
        console.log(`ID: ${user.id}`);
        console.log(`Type: ${user.type}`);
        if (user.bot?.owner.workspace) {
          console.log('Owner: Workspace');
        }
      }
    }));

  // List users
  users
    .command('list')
    .description('List all users in the workspace')
    .option('-l, --limit <number>', 'Max results', '100')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();

      const query: Record<string, string | number> = {};
      if (options.limit) query.page_size = parseInt(options.limit, 10);
      if (options.cursor) query.start_cursor = options.cursor;

      const result = await client.get('users', query) as PaginatedResponse<User>;

      // Notion's user list never returns guests. Merge in any guests we've
      // previously fished (notion user resolve-guests) so they're visible,
      // skipping ones that already appear in the live list.
      const memberIds = new Set(result.results.map(u => u.id));
      const cachedGuests = readGuests().filter(g => !memberIds.has(g.id));

      if (options.json) {
        console.log(formatOutput({
          ...result,
          guests: cachedGuests,
        }));
        return;
      }

      for (const user of result.results) {
        const icon = user.type === 'person' ? '👤' : '🤖';
        console.log(`${icon} ${user.name || 'Unknown'}`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Type: ${user.type}`);
        if (user.person?.email) {
          console.log(`   Email: ${user.person.email}`);
        }
        console.log('');
      }

      for (const guest of cachedGuests) {
        console.log(`👤 ${guest.name || 'Unknown'} [guest]`);
        console.log(`   ID: ${guest.id}`);
        console.log(`   Type: guest`);
        if (guest.email) {
          console.log(`   Email: ${guest.email}`);
        }
        console.log('');
      }

      if (result.has_more) {
        console.log(`More results available. Use --cursor ${result.next_cursor}`);
      }
    }));

  // Resolve guests (fishing): guests aren't in the user list, so discover them
  // from page created_by/last_edited_by ids and cache them locally.
  users
    .command('resolve-guests')
    .description('Discover guest users (not in user list) and cache them locally')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (options) => {
      const client = getClient();
      const guests = await fishGuests(client);

      if (options.json) {
        console.log(formatOutput({ guests, cache: getGuestsPath() }));
        return;
      }

      if (guests.length === 0) {
        console.log('No new guests found.');
        console.log(`(Guests don't appear in "notion user list"; resolved from page authorship.)`);
        return;
      }

      console.log(`Resolved ${guests.length} guest(s) → ${getGuestsPath()}\n`);
      for (const guest of guests) {
        console.log(`👤 ${guest.name || 'Unknown'} [guest]`);
        console.log(`   ID: ${guest.id}`);
        if (guest.email) {
          console.log(`   Email: ${guest.email}`);
        }
        console.log('');
      }
      console.log('You can now assign them by email/name, e.g.:');
      console.log(`  notion page update <id> --prop "Owner:people=${guests[0].email || guests[0].name}"`);
    }));

  // Get user
  users
    .command('get <user_id>')
    .description('Get a specific user')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (userId: string, options) => {
      const client = getClient();
      const user = await client.get(`users/${userId}`) as User;

      if (options.json) {
        console.log(formatOutput(user));
      } else {
        const icon = user.type === 'person' ? '👤' : '🤖';
        console.log(`${icon} ${user.name || 'Unknown'}`);
        console.log(`ID: ${user.id}`);
        console.log(`Type: ${user.type}`);
        if (user.person?.email) {
          console.log(`Email: ${user.person.email}`);
        }
        if (user.avatar_url) {
          console.log(`Avatar: ${user.avatar_url}`);
        }
      }
    }));
}
