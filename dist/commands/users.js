import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
export function registerUsersCommand(program) {
    const users = program
        .command('user')
        .alias('users')
        .description('Manage Notion users');
    // Current user (me)
    users
        .command('me')
        .description('Get the current bot user')
        .option('-j, --json', 'Output raw JSON')
        .action(async (options) => {
        try {
            const client = getClient();
            const user = await client.get('users/me');
            if (options.json) {
                console.log(formatOutput(user));
            }
            else {
                console.log('🤖 Current User (Integration)');
                console.log(`Name: ${user.name || 'Unknown'}`);
                console.log(`ID: ${user.id}`);
                console.log(`Type: ${user.type}`);
                if (user.bot?.owner.workspace) {
                    console.log('Owner: Workspace');
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // List users
    users
        .command('list')
        .description('List all users in the workspace')
        .option('-l, --limit <number>', 'Max results', '100')
        .option('--cursor <cursor>', 'Pagination cursor')
        .option('-j, --json', 'Output raw JSON')
        .action(async (options) => {
        try {
            const client = getClient();
            const query = {};
            if (options.limit)
                query.page_size = parseInt(options.limit, 10);
            if (options.cursor)
                query.start_cursor = options.cursor;
            const result = await client.get('users', query);
            if (options.json) {
                console.log(formatOutput(result));
                return;
            }
            const typedResult = result;
            for (const user of typedResult.results) {
                const icon = user.type === 'person' ? '👤' : '🤖';
                console.log(`${icon} ${user.name || 'Unknown'}`);
                console.log(`   ID: ${user.id}`);
                console.log(`   Type: ${user.type}`);
                if (user.person?.email) {
                    console.log(`   Email: ${user.person.email}`);
                }
                console.log('');
            }
            if (typedResult.has_more) {
                console.log(`More results available. Use --cursor ${typedResult.next_cursor}`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Get user
    users
        .command('get <user_id>')
        .description('Get a specific user')
        .option('-j, --json', 'Output raw JSON')
        .action(async (userId, options) => {
        try {
            const client = getClient();
            const user = await client.get(`users/${userId}`);
            if (options.json) {
                console.log(formatOutput(user));
            }
            else {
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
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=users.js.map