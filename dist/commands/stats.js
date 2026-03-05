import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { getDbTitle } from '../utils/notion-helpers.js';
// Stats-specific version: returns 'true'/'false' for checkboxes and only
// handles property types relevant to statistical breakdowns.
function getPropertyValue(prop) {
    const type = prop.type;
    const data = prop[type];
    switch (type) {
        case 'select':
        case 'status':
            return data?.name || null;
        case 'multi_select':
            return data?.map(s => s.name).join(', ') || null;
        case 'people':
            return data?.map(p => p.name).filter(Boolean).join(', ') || null;
        case 'date':
            return data?.start || null;
        case 'checkbox':
            return data ? 'true' : 'false';
        case 'number':
            return data != null ? String(data) : null;
        default:
            return null;
    }
}
export function registerStatsCommand(program) {
    const stats = program
        .command('stats')
        .description('Database statistics and reporting');
    // Database overview stats
    stats
        .command('overview <database_id>')
        .alias('db')
        .description('Get statistics overview for a database')
        .option('-j, --json', 'Output as JSON')
        .option('--llm', 'LLM-friendly output')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            // Get database info
            const db = await client.get(`databases/${databaseId}`);
            const title = getDbTitle(db);
            // Find status/select properties for breakdown
            const breakdownProps = [];
            for (const [name, schema] of Object.entries(db.properties)) {
                if (schema.type === 'status') {
                    const statusData = schema.status;
                    breakdownProps.push({
                        name,
                        type: 'status',
                        options: statusData?.options?.map(o => o.name) || [],
                    });
                }
                else if (schema.type === 'select' &&
                    (name.toLowerCase().includes('priority') ||
                        name.toLowerCase().includes('type') ||
                        name.toLowerCase().includes('category'))) {
                    const selectData = schema.select;
                    breakdownProps.push({
                        name,
                        type: 'select',
                        options: selectData?.options?.map(o => o.name) || [],
                    });
                }
            }
            // Query all entries (paginated)
            const entries = [];
            let cursor;
            do {
                const body = { page_size: 100 };
                if (cursor)
                    body.start_cursor = cursor;
                const result = await client.post(`databases/${databaseId}/query`, body);
                entries.push(...result.results);
                cursor = result.has_more ? result.next_cursor : undefined;
                process.stdout.write(`\rFetching entries: ${entries.length}...`);
            } while (cursor);
            console.log(`\rFetched ${entries.length} entries.      \n`);
            // Calculate breakdowns
            const breakdowns = {};
            for (const prop of breakdownProps) {
                breakdowns[prop.name] = {};
                // Initialize with all options
                for (const opt of prop.options) {
                    breakdowns[prop.name][opt] = 0;
                }
                breakdowns[prop.name]['(empty)'] = 0;
            }
            // Count created/edited over time
            const createdByMonth = {};
            const editedByMonth = {};
            for (const entry of entries) {
                // Breakdown counts
                for (const prop of breakdownProps) {
                    const value = entry.properties[prop.name];
                    if (value) {
                        const strValue = getPropertyValue(value);
                        if (strValue) {
                            breakdowns[prop.name][strValue] = (breakdowns[prop.name][strValue] || 0) + 1;
                        }
                        else {
                            breakdowns[prop.name]['(empty)']++;
                        }
                    }
                }
                // Time-based stats
                const createdMonth = entry.created_time.slice(0, 7);
                const editedMonth = entry.last_edited_time.slice(0, 7);
                createdByMonth[createdMonth] = (createdByMonth[createdMonth] || 0) + 1;
                editedByMonth[editedMonth] = (editedByMonth[editedMonth] || 0) + 1;
            }
            // Build stats object
            const statsData = {
                database: title,
                databaseId,
                totalEntries: entries.length,
                breakdowns,
                activity: {
                    createdByMonth,
                    editedByMonth,
                },
            };
            if (options.json) {
                console.log(formatOutput(statsData));
                return;
            }
            if (options.llm) {
                console.log(`# Database Stats: ${title}\n`);
                console.log(`**Total entries:** ${entries.length}\n`);
                for (const [propName, counts] of Object.entries(breakdowns)) {
                    console.log(`## ${propName}`);
                    const sorted = Object.entries(counts)
                        .filter(([, count]) => count > 0)
                        .sort((a, b) => b[1] - a[1]);
                    for (const [value, count] of sorted) {
                        const pct = ((count / entries.length) * 100).toFixed(1);
                        console.log(`- ${value}: ${count} (${pct}%)`);
                    }
                    console.log('');
                }
                console.log('## Recent Activity');
                const recentMonths = Object.keys(editedByMonth).sort().slice(-3);
                for (const month of recentMonths) {
                    console.log(`- ${month}: ${editedByMonth[month]} edited`);
                }
                return;
            }
            // Standard output
            console.log(`📊 Database: ${title}`);
            console.log(`   Total entries: ${entries.length}\n`);
            for (const [propName, counts] of Object.entries(breakdowns)) {
                console.log(`${propName}:`);
                const sorted = Object.entries(counts)
                    .filter(([, count]) => count > 0)
                    .sort((a, b) => b[1] - a[1]);
                for (const [value, count] of sorted) {
                    const pct = ((count / entries.length) * 100).toFixed(0);
                    const bar = '█'.repeat(Math.ceil(count / entries.length * 20));
                    console.log(`  ${value.padEnd(20)} ${String(count).padStart(4)} (${pct.padStart(3)}%) ${bar}`);
                }
                console.log('');
            }
            // Activity summary
            console.log('Recent activity:');
            const recentMonths = Object.keys(editedByMonth).sort().slice(-6);
            for (const month of recentMonths) {
                const created = createdByMonth[month] || 0;
                const edited = editedByMonth[month] || 0;
                console.log(`  ${month}: ${created} created, ${edited} edited`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Timeline view
    stats
        .command('timeline <database_id>')
        .description('Show activity timeline for a database')
        .option('-d, --days <number>', 'Number of days to show', '14')
        .option('-j, --json', 'Output as JSON')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            const days = parseInt(options.days, 10);
            const since = new Date();
            since.setDate(since.getDate() - days);
            since.setHours(0, 0, 0, 0);
            // Query recently edited entries
            const result = await client.post(`databases/${databaseId}/query`, {
                filter: {
                    timestamp: 'last_edited_time',
                    last_edited_time: { on_or_after: since.toISOString() },
                },
                sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
                page_size: 100,
            });
            // Group by day
            const byDay = {};
            for (const page of result.results) {
                const day = page.last_edited_time.split('T')[0];
                if (!byDay[day])
                    byDay[day] = [];
                byDay[day].push(page);
            }
            if (options.json) {
                console.log(formatOutput({ days, since: since.toISOString(), byDay }));
                return;
            }
            console.log(`📅 Activity timeline (last ${days} days)\n`);
            // Generate all days
            const allDays = [];
            const current = new Date(since);
            while (current <= new Date()) {
                allDays.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
            }
            for (const day of allDays.reverse()) {
                const pages = byDay[day] || [];
                const count = pages.length;
                const bar = '█'.repeat(Math.min(count, 30));
                // Format day name
                const date = new Date(day);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                console.log(`${day} (${dayName}) ${String(count).padStart(3)} ${bar}`);
                // Show top 3 items for the day
                if (count > 0 && count <= 5) {
                    for (const page of pages) {
                        const title = Object.values(page.properties)
                            .find((p) => p.type === 'title');
                        const name = title?.title?.map(t => t.plain_text).join('') || 'Untitled';
                        console.log(`           └─ ${name.slice(0, 40)}`);
                    }
                }
            }
            console.log(`\nTotal: ${result.results.length} entries edited`);
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=stats.js.map