import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { getPageTitle } from '../utils/notion-helpers.js';
function getPropertyValue(prop) {
    const type = prop.type;
    return prop[type];
}
function isPropertyEmpty(prop) {
    const type = prop.type;
    const value = prop[type];
    if (value === null || value === undefined)
        return true;
    switch (type) {
        case 'title':
        case 'rich_text':
            return !Array.isArray(value) || value.length === 0 ||
                !value[0]?.plain_text;
        case 'select':
        case 'status':
            return !value?.name;
        case 'multi_select':
        case 'people':
        case 'files':
        case 'relation':
            return !Array.isArray(value) || value.length === 0;
        case 'date':
            return !value?.start;
        case 'number':
            return value === null;
        case 'checkbox':
            return false; // Checkbox is never "empty"
        case 'url':
        case 'email':
        case 'phone_number':
            return !value;
        default:
            return !value;
    }
}
export function registerValidateCommand(program) {
    const validate = program
        .command('validate')
        .description('Validate database integrity and find issues');
    // Full validation
    validate
        .command('check <database_id>')
        .alias('run')
        .description('Run full validation on a database')
        .option('--required <props>', 'Comma-separated list of required properties')
        .option('--check-dates', 'Check for overdue items')
        .option('--check-stale <days>', 'Flag items not updated in N days')
        .option('-j, --json', 'Output as JSON')
        .option('--fix', 'Show fix suggestions')
        .action(async (databaseId, options) => {
        try {
            const client = getClient();
            const issues = [];
            // Get database schema
            const db = await client.get(`databases/${databaseId}`);
            const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
            console.log(`🔍 Validating database: ${dbTitle}\n`);
            // Determine required properties
            const requiredProps = options.required
                ? options.required.split(',').map((p) => p.trim())
                : [];
            // Find status and date properties
            let statusProp = '';
            let dateProp = '';
            for (const [name, schema] of Object.entries(db.properties)) {
                if (schema.type === 'status')
                    statusProp = name;
                if (schema.type === 'date' && name.toLowerCase().includes('deadline')) {
                    dateProp = name;
                }
            }
            // Query all entries
            const entries = [];
            let cursor;
            do {
                const body = { page_size: 100 };
                if (cursor)
                    body.start_cursor = cursor;
                const result = await client.post(`databases/${databaseId}/query`, body);
                entries.push(...result.results);
                cursor = result.has_more ? result.next_cursor : undefined;
                process.stdout.write(`\rFetching: ${entries.length} entries...`);
            } while (cursor);
            console.log(`\rAnalyzing ${entries.length} entries...      \n`);
            const now = new Date();
            const staleThreshold = options.checkStale
                ? new Date(now.getTime() - parseInt(options.checkStale, 10) * 24 * 60 * 60 * 1000)
                : null;
            // Validate each entry
            for (const entry of entries) {
                const title = getPageTitle(entry);
                // Check for empty title
                const titleProp = Object.entries(entry.properties)
                    .find(([, p]) => p.type === 'title');
                if (titleProp && isPropertyEmpty(titleProp[1])) {
                    issues.push({
                        severity: 'error',
                        type: 'empty_title',
                        message: 'Entry has no title',
                        pageId: entry.id,
                        pageTitle: '(untitled)',
                    });
                }
                // Check required properties
                for (const propName of requiredProps) {
                    const prop = entry.properties[propName];
                    if (!prop || isPropertyEmpty(prop)) {
                        issues.push({
                            severity: 'warning',
                            type: 'missing_required',
                            message: `Missing required property: ${propName}`,
                            pageId: entry.id,
                            pageTitle: title,
                            property: propName,
                        });
                    }
                }
                // Check for overdue items
                if (options.checkDates && dateProp && statusProp) {
                    const dateValue = entry.properties[dateProp];
                    const statusValue = entry.properties[statusProp];
                    if (dateValue?.date?.start && statusValue?.status?.name) {
                        const deadline = new Date(dateValue.date.start);
                        const status = statusValue.status.name.toLowerCase();
                        // Not completed and past deadline
                        if (deadline < now && !['hecho', 'done', 'completed', 'archivado'].some(s => status.includes(s))) {
                            issues.push({
                                severity: 'warning',
                                type: 'overdue',
                                message: `Overdue: deadline was ${dateValue.date.start}`,
                                pageId: entry.id,
                                pageTitle: title,
                                suggestion: `notion page update ${entry.id} --prop "${statusProp}=Archivado"`,
                            });
                        }
                    }
                }
                // Check for stale items
                if (staleThreshold) {
                    const lastEdited = new Date(entry.last_edited_time);
                    const statusValue = entry.properties[statusProp];
                    const status = statusValue?.status?.name?.toLowerCase() || '';
                    // In progress but not updated
                    if (lastEdited < staleThreshold &&
                        ['en marcha', 'in progress', 'doing'].some(s => status.includes(s))) {
                        const daysSince = Math.floor((now.getTime() - lastEdited.getTime()) / (1000 * 60 * 60 * 24));
                        issues.push({
                            severity: 'info',
                            type: 'stale',
                            message: `Not updated in ${daysSince} days (status: ${statusValue?.status?.name})`,
                            pageId: entry.id,
                            pageTitle: title,
                        });
                    }
                }
            }
            // Output results
            if (options.json) {
                console.log(formatOutput({
                    database: dbTitle,
                    totalEntries: entries.length,
                    issues,
                    summary: {
                        errors: issues.filter(i => i.severity === 'error').length,
                        warnings: issues.filter(i => i.severity === 'warning').length,
                        info: issues.filter(i => i.severity === 'info').length,
                    },
                }));
                return;
            }
            // Group by type
            const byType = {};
            for (const issue of issues) {
                if (!byType[issue.type])
                    byType[issue.type] = [];
                byType[issue.type].push(issue);
            }
            if (issues.length === 0) {
                console.log('✅ No issues found!\n');
            }
            else {
                const errors = issues.filter(i => i.severity === 'error').length;
                const warnings = issues.filter(i => i.severity === 'warning').length;
                const infos = issues.filter(i => i.severity === 'info').length;
                console.log(`Found ${issues.length} issues: ${errors} errors, ${warnings} warnings, ${infos} info\n`);
                for (const [type, typeIssues] of Object.entries(byType)) {
                    const icon = typeIssues[0].severity === 'error' ? '❌' :
                        typeIssues[0].severity === 'warning' ? '⚠️' : 'ℹ️';
                    console.log(`${icon} ${type.replace(/_/g, ' ').toUpperCase()} (${typeIssues.length})`);
                    // Show first 5
                    for (const issue of typeIssues.slice(0, 5)) {
                        console.log(`   - ${issue.pageTitle}: ${issue.message}`);
                        if (options.fix && issue.suggestion) {
                            console.log(`     Fix: ${issue.suggestion}`);
                        }
                    }
                    if (typeIssues.length > 5) {
                        console.log(`   ... and ${typeIssues.length - 5} more`);
                    }
                    console.log('');
                }
            }
            // Health score with weighted factors
            const totalEntries = entries.length || 1;
            const errorRate = issues.filter(i => i.severity === 'error').length / totalEntries;
            const warningRate = issues.filter(i => i.severity === 'warning').length / totalEntries;
            const overdueRate = issues.filter(i => i.type === 'overdue').length / totalEntries;
            const staleRate = issues.filter(i => i.type === 'stale').length / totalEntries;
            // Property fill rates
            let totalFillRate = 0;
            let propCount = 0;
            for (const [propName] of Object.entries(db.properties)) {
                let filled = 0;
                for (const entry of entries) {
                    const prop = entry.properties[propName];
                    if (prop && !isPropertyEmpty(prop)) {
                        filled++;
                    }
                }
                totalFillRate += filled / totalEntries;
                propCount++;
            }
            const avgFillRate = propCount > 0 ? totalFillRate / propCount : 1;
            // Weighted score: fill rate 30%, errors 30%, warnings 20%, timeliness 20%
            const fillScore = avgFillRate * 100;
            const errorScore = Math.max(0, 100 - errorRate * 500);
            const warningScore = Math.max(0, 100 - warningRate * 200);
            const timelinessScore = Math.max(0, 100 - (overdueRate + staleRate) * 300);
            const healthScore = Math.round(fillScore * 0.3 + errorScore * 0.3 + warningScore * 0.2 + timelinessScore * 0.2);
            const emoji = healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴';
            console.log(`\n${'═'.repeat(40)}`);
            console.log(`📊 Health Score: ${healthScore}/100 ${emoji}`);
            console.log(`${'═'.repeat(40)}`);
            console.log(`   Fill rate:    ${Math.round(fillScore)}/100 (weight: 30%)`);
            console.log(`   Errors:       ${Math.round(errorScore)}/100 (weight: 30%)`);
            console.log(`   Warnings:     ${Math.round(warningScore)}/100 (weight: 20%)`);
            console.log(`   Timeliness:   ${Math.round(timelinessScore)}/100 (weight: 20%)`);
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Quick lint
    validate
        .command('lint <database_id>')
        .description('Quick lint check for common issues')
        .action(async (databaseId) => {
        try {
            const client = getClient();
            // Get database
            const db = await client.get(`databases/${databaseId}`);
            const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
            console.log(`🔍 Linting: ${dbTitle}\n`);
            // Quick queries for common issues
            const checks = [];
            // Find properties
            let titleProp = '';
            let statusProp = '';
            for (const [name, schema] of Object.entries(db.properties)) {
                if (schema.type === 'title')
                    titleProp = name;
                if (schema.type === 'status')
                    statusProp = name;
            }
            // Check for entries without title
            if (titleProp) {
                checks.push({
                    name: 'Empty titles',
                    filter: { property: titleProp, title: { is_empty: true } },
                    severity: 'error',
                });
            }
            // Check for old "in progress" items
            if (statusProp) {
                const statusData = db.properties[statusProp].status;
                const inProgressStatus = statusData?.options?.find(o => o.name.toLowerCase().includes('marcha') || o.name.toLowerCase().includes('progress'));
                if (inProgressStatus) {
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    checks.push({
                        name: `"${inProgressStatus.name}" for >30 days`,
                        filter: {
                            and: [
                                { property: statusProp, status: { equals: inProgressStatus.name } },
                                { timestamp: 'last_edited_time', last_edited_time: { before: thirtyDaysAgo.toISOString() } },
                            ],
                        },
                        severity: 'warning',
                    });
                }
            }
            // Run filter-based checks
            let totalIssues = 0;
            for (const check of checks) {
                try {
                    const countResult = await client.post(`databases/${databaseId}/query`, {
                        filter: check.filter,
                        page_size: 100,
                    });
                    const count = countResult.results.length;
                    if (count > 0) {
                        const icon = check.severity === 'error' ? '❌' : '⚠️';
                        console.log(`${icon} ${check.name}: ${count} found`);
                        totalIssues += count;
                    }
                    else {
                        console.log(`✅ ${check.name}: OK`);
                    }
                }
                catch {
                    console.log(`⏭️ ${check.name}: skipped (filter not supported)`);
                }
            }
            // Check for duplicate titles (requires fetching entries)
            const allEntries = await client.post(`databases/${databaseId}/query`, {
                page_size: 100,
            });
            const titleCounts = new Map();
            for (const entry of allEntries.results) {
                const title = getPageTitle(entry).toLowerCase().trim();
                if (title && title !== 'untitled') {
                    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
                }
            }
            const duplicates = [...titleCounts.entries()].filter(([, count]) => count > 1);
            if (duplicates.length > 0) {
                const dupeCount = duplicates.reduce((sum, [, count]) => sum + count, 0);
                console.log(`⚠️ Duplicate titles: ${duplicates.length} titles repeated (${dupeCount} entries)`);
                for (const [title, count] of duplicates.slice(0, 3)) {
                    console.log(`   "${title}" appears ${count} times`);
                }
                totalIssues += dupeCount;
            }
            else {
                console.log('✅ Duplicate titles: OK');
            }
            console.log(`\nTotal issues: ${totalIssues}`);
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Health check
    validate
        .command('health <database_id>')
        .description('Get a health score for the database')
        .action(async (databaseId) => {
        try {
            const client = getClient();
            const db = await client.get(`databases/${databaseId}`);
            const dbTitle = db.title?.map(t => t.plain_text).join('') || 'Untitled';
            // Query recent entries
            const result = await client.post(`databases/${databaseId}/query`, {
                page_size: 100,
                sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
            });
            const entries = result.results;
            // Calculate metrics
            const now = new Date();
            const recentlyEdited = entries.filter(e => {
                const edited = new Date(e.last_edited_time);
                const daysSince = (now.getTime() - edited.getTime()) / (1000 * 60 * 60 * 24);
                return daysSince <= 7;
            }).length;
            let completionRate = 0;
            let statusProp = '';
            for (const [name, schema] of Object.entries(db.properties)) {
                if (schema.type === 'status') {
                    statusProp = name;
                    break;
                }
            }
            if (statusProp) {
                const completed = entries.filter(e => {
                    const status = e.properties[statusProp];
                    const name = status?.status?.name?.toLowerCase() || '';
                    return ['hecho', 'done', 'completed'].some(s => name.includes(s));
                }).length;
                completionRate = entries.length > 0 ? Math.round((completed / entries.length) * 100) : 0;
            }
            // Property fill rates
            const fillRates = {};
            for (const [propName] of Object.entries(db.properties)) {
                let filled = 0;
                for (const entry of entries) {
                    const prop = entry.properties[propName];
                    if (prop && !isPropertyEmpty(prop)) {
                        filled++;
                    }
                }
                fillRates[propName] = entries.length > 0 ? Math.round((filled / entries.length) * 100) : 0;
            }
            // Calculate health score
            const activityScore = Math.min(100, (recentlyEdited / entries.length) * 100 * 2);
            const avgFillRate = Object.values(fillRates).reduce((a, b) => a + b, 0) / Object.values(fillRates).length;
            const healthScore = Math.round((activityScore * 0.3) + (avgFillRate * 0.5) + (completionRate * 0.2));
            // Output
            console.log(`\n📊 Health Report: ${dbTitle}\n`);
            console.log(`${'═'.repeat(40)}`);
            console.log(`Health Score: ${healthScore}/100 ${healthScore >= 80 ? '🟢' : healthScore >= 50 ? '🟡' : '🔴'}`);
            console.log(`${'═'.repeat(40)}\n`);
            console.log(`📈 Activity (last 7 days): ${recentlyEdited}/${entries.length} entries (${Math.round(recentlyEdited / entries.length * 100)}%)`);
            console.log(`✅ Completion rate: ${completionRate}%`);
            console.log(`📝 Average fill rate: ${Math.round(avgFillRate)}%\n`);
            console.log('Property fill rates:');
            const sortedFillRates = Object.entries(fillRates)
                .sort((a, b) => b[1] - a[1]);
            for (const [prop, rate] of sortedFillRates) {
                const bar = '█'.repeat(Math.ceil(rate / 10)) + '░'.repeat(10 - Math.ceil(rate / 10));
                const icon = rate >= 80 ? '✅' : rate >= 50 ? '⚠️' : '❌';
                console.log(`  ${icon} ${prop.padEnd(25)} ${bar} ${rate}%`);
            }
            // Recommendations
            const recommendations = [];
            const lowFill = sortedFillRates.filter(([, r]) => r < 50);
            if (lowFill.length > 0) {
                recommendations.push(`Fill in "${lowFill[0][0]}" (only ${lowFill[0][1]}% populated)`);
            }
            if (completionRate < 30) {
                recommendations.push('Completion rate is low, review stuck or abandoned items');
            }
            if (recentlyEdited < entries.length * 0.1) {
                recommendations.push('Most entries are stale, consider archiving inactive items');
            }
            if (recommendations.length > 0) {
                console.log('\nRecommendations:');
                for (const rec of recommendations) {
                    console.log(`  -> ${rec}`);
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=validate.js.map