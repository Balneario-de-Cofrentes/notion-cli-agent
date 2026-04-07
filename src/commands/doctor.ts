/**
 * Doctor command — quick diagnostics for troubleshooting
 */
import { Command } from 'commander';
import { getClient, initClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run diagnostics: token, connectivity, permissions')
    .option('-j, --json', 'Output as JSON')
    .action(withErrorHandler(async (options) => {
      const checks: CheckResult[] = [];

      // 1. Token check
      try {
        initClient();
        checks.push({ name: 'Token', status: 'pass', message: 'Token found and configured' });
      } catch (error) {
        checks.push({ name: 'Token', status: 'fail', message: (error as Error).message });
      }

      // 2. API connectivity + auth
      let userId = '';
      try {
        const client = getClient();
        const me = await client.get('users/me') as { id: string; name?: string; type: string };
        userId = me.id;
        const name = me.name || me.type;
        checks.push({ name: 'API Connection', status: 'pass', message: `Authenticated as ${name} (${me.type})` });
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes('401')) {
          checks.push({ name: 'API Connection', status: 'fail', message: 'Token is invalid or expired' });
        } else if (msg.includes('fetch') || msg.includes('ENOTFOUND')) {
          checks.push({ name: 'API Connection', status: 'fail', message: 'Cannot reach Notion API — check network' });
        } else {
          checks.push({ name: 'API Connection', status: 'fail', message: msg });
        }
      }

      // 3. Workspace access
      if (userId) {
        try {
          const client = getClient();
          const result = await client.post('search', { page_size: 1 }) as { results: unknown[] };
          if (result.results.length > 0) {
            checks.push({ name: 'Workspace Access', status: 'pass', message: 'Integration has access to workspace content' });
          } else {
            checks.push({
              name: 'Workspace Access',
              status: 'warn',
              message: 'No pages or databases accessible. Share content with your integration in Notion.',
            });
          }
        } catch (error) {
          checks.push({ name: 'Workspace Access', status: 'fail', message: (error as Error).message });
        }
      }

      // 4. API version
      checks.push({ name: 'API Version', status: 'pass', message: '2026-03-11' });

      // 5. CLI version
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const { version } = require('../../package.json');
      checks.push({ name: 'CLI Version', status: 'pass', message: version });

      // Output
      if (options.json) {
        console.log(formatOutput(checks));
        return;
      }

      console.log('\nNotion CLI Doctor\n');
      const passed = checks.filter(c => c.status === 'pass').length;
      for (const check of checks) {
        const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
        console.log(`${icon} ${check.name}: ${check.message}`);
      }
      console.log(`\n${passed}/${checks.length} checks passed`);

      if (checks.some(c => c.status === 'fail')) {
        process.exit(1);
      }
    }));
}
