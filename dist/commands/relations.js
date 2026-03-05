import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { getPageTitle } from '../utils/notion-helpers.js';
export function registerRelationsCommand(program) {
    const relations = program
        .command('relations')
        .alias('rel')
        .description('Manage page relationships and backlinks');
    // Find backlinks
    relations
        .command('backlinks <page_id>')
        .alias('bl')
        .description('Find pages that link to this page')
        .option('-j, --json', 'Output as JSON')
        .option('--llm', 'LLM-friendly output')
        .action(async (pageId, options) => {
        try {
            const client = getClient();
            // Get the target page
            const targetPage = await client.get(`pages/${pageId}`);
            const targetTitle = getPageTitle(targetPage);
            console.log(`🔍 Finding backlinks to: ${targetTitle}\n`);
            // Find the parent database
            if (targetPage.parent.type !== 'database_id' || !targetPage.parent.database_id) {
                console.log('Note: Page is not in a database. Checking for relation backlinks only.\n');
            }
            const backlinks = [];
            // Search for pages that might reference this one
            // Strategy 1: Search by page title (mentions)
            const searchResult = await client.post('search', {
                query: targetTitle,
                filter: { property: 'object', value: 'page' },
                page_size: 50,
            });
            // Strategy 2: Check relation properties in the same database
            if (targetPage.parent.database_id) {
                const db = await client.get(`databases/${targetPage.parent.database_id}`);
                // Find relation properties that point to this database
                for (const [propName, schema] of Object.entries(db.properties)) {
                    if (schema.type === 'relation' && schema.relation?.database_id) {
                        // Query for entries with relation to our page
                        try {
                            const relResult = await client.post(`databases/${schema.relation.database_id}/query`, {
                                page_size: 100,
                            });
                            for (const page of relResult.results) {
                                // Check if any relation property points to our target
                                for (const [pName, pValue] of Object.entries(page.properties)) {
                                    const prop = pValue;
                                    if (prop.type === 'relation' && prop.relation) {
                                        const hasLink = prop.relation.some(r => r.id === pageId);
                                        if (hasLink) {
                                            backlinks.push({
                                                type: 'relation',
                                                page,
                                                property: pName,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        catch {
                            // Database might not be accessible
                        }
                    }
                }
            }
            // Also check mentions from search results
            for (const page of searchResult.results) {
                if (page.id === pageId)
                    continue; // Skip self
                // Check if this page has relation to target
                for (const [pName, pValue] of Object.entries(page.properties)) {
                    const prop = pValue;
                    if (prop.type === 'relation' && prop.relation) {
                        const hasLink = prop.relation.some(r => r.id === pageId);
                        if (hasLink && !backlinks.some(b => b.page.id === page.id)) {
                            backlinks.push({
                                type: 'relation',
                                page,
                                property: pName,
                            });
                        }
                    }
                }
                // Add as potential mention if title matches
                if (!backlinks.some(b => b.page.id === page.id)) {
                    backlinks.push({
                        type: 'mention',
                        page,
                    });
                }
            }
            // Output
            if (options.json) {
                console.log(formatOutput({
                    target: { id: pageId, title: targetTitle },
                    backlinks: backlinks.map(b => ({
                        type: b.type,
                        pageId: b.page.id,
                        pageTitle: getPageTitle(b.page),
                        property: b.property,
                        url: b.page.url,
                    })),
                }));
                return;
            }
            if (backlinks.length === 0) {
                console.log('No backlinks found.');
                return;
            }
            // Group by type
            const relationLinks = backlinks.filter(b => b.type === 'relation');
            const mentionLinks = backlinks.filter(b => b.type === 'mention');
            if (options.llm) {
                console.log(`## Backlinks to "${targetTitle}"\n`);
                if (relationLinks.length > 0) {
                    console.log(`### Direct Relations (${relationLinks.length})`);
                    for (const b of relationLinks) {
                        console.log(`- **${getPageTitle(b.page)}** via \`${b.property}\``);
                        console.log(`  ID: ${b.page.id}`);
                    }
                    console.log('');
                }
                if (mentionLinks.length > 0) {
                    console.log(`### Potential Mentions (${mentionLinks.length})`);
                    for (const b of mentionLinks.slice(0, 10)) {
                        console.log(`- ${getPageTitle(b.page)}`);
                    }
                    if (mentionLinks.length > 10) {
                        console.log(`- ... and ${mentionLinks.length - 10} more`);
                    }
                }
                return;
            }
            // Standard output
            console.log(`Found ${backlinks.length} backlinks:\n`);
            if (relationLinks.length > 0) {
                console.log('📎 Direct Relations:');
                for (const b of relationLinks) {
                    console.log(`   ${getPageTitle(b.page)}`);
                    console.log(`   └─ via property: ${b.property}`);
                    console.log(`      ID: ${b.page.id}`);
                    console.log('');
                }
            }
            if (mentionLinks.length > 0) {
                console.log('📝 Potential Mentions:');
                for (const b of mentionLinks.slice(0, 10)) {
                    console.log(`   ${getPageTitle(b.page)}`);
                    console.log(`      ID: ${b.page.id}`);
                }
                if (mentionLinks.length > 10) {
                    console.log(`   ... and ${mentionLinks.length - 10} more`);
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Link pages
    relations
        .command('link <source_id> <target_id>')
        .description('Create a relation between two pages')
        .requiredOption('-p, --property <name>', 'Relation property name')
        .option('--bidirectional', 'Also link target back to source')
        .action(async (sourceId, targetId, options) => {
        try {
            const client = getClient();
            // Get source page
            const sourcePage = await client.get(`pages/${sourceId}`);
            const sourceTitle = getPageTitle(sourcePage);
            // Get target page
            const targetPage = await client.get(`pages/${targetId}`);
            const targetTitle = getPageTitle(targetPage);
            // Check if property exists and is a relation
            const prop = sourcePage.properties[options.property];
            if (!prop || prop.type !== 'relation') {
                console.error(`Error: Property "${options.property}" is not a relation property`);
                process.exit(1);
            }
            // Get existing relations
            const existingRelations = (prop.relation || [])
                .map(r => ({ id: r.id }));
            // Check if already linked
            if (existingRelations.some(r => r.id === targetId)) {
                console.log(`Already linked: ${sourceTitle} → ${targetTitle}`);
                return;
            }
            // Add new relation
            existingRelations.push({ id: targetId });
            await client.patch(`pages/${sourceId}`, {
                properties: {
                    [options.property]: {
                        relation: existingRelations,
                    },
                },
            });
            console.log(`✅ Linked: ${sourceTitle} → ${targetTitle}`);
            console.log(`   Property: ${options.property}`);
            // Bidirectional linking
            if (options.bidirectional) {
                const targetProp = targetPage.properties[options.property];
                if (targetProp && targetProp.type === 'relation') {
                    const targetRelations = (targetProp.relation || [])
                        .map(r => ({ id: r.id }));
                    if (!targetRelations.some(r => r.id === sourceId)) {
                        targetRelations.push({ id: sourceId });
                        await client.patch(`pages/${targetId}`, {
                            properties: {
                                [options.property]: {
                                    relation: targetRelations,
                                },
                            },
                        });
                        console.log(`✅ Linked: ${targetTitle} → ${sourceTitle} (bidirectional)`);
                    }
                }
                else {
                    console.log(`⚠️ Could not create bidirectional link (property not found on target)`);
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Unlink pages
    relations
        .command('unlink <source_id> <target_id>')
        .description('Remove a relation between two pages')
        .requiredOption('-p, --property <name>', 'Relation property name')
        .option('--bidirectional', 'Also unlink target from source')
        .action(async (sourceId, targetId, options) => {
        try {
            const client = getClient();
            // Get source page
            const sourcePage = await client.get(`pages/${sourceId}`);
            const sourceTitle = getPageTitle(sourcePage);
            // Get target page
            const targetPage = await client.get(`pages/${targetId}`);
            const targetTitle = getPageTitle(targetPage);
            // Get existing relations
            const prop = sourcePage.properties[options.property];
            if (!prop || prop.type !== 'relation') {
                console.error(`Error: Property "${options.property}" is not a relation property`);
                process.exit(1);
            }
            const existingRelations = (prop.relation || [])
                .filter(r => r.id !== targetId)
                .map(r => ({ id: r.id }));
            await client.patch(`pages/${sourceId}`, {
                properties: {
                    [options.property]: {
                        relation: existingRelations,
                    },
                },
            });
            console.log(`✅ Unlinked: ${sourceTitle} ✕ ${targetTitle}`);
            // Bidirectional unlinking
            if (options.bidirectional) {
                const targetProp = targetPage.properties[options.property];
                if (targetProp && targetProp.type === 'relation') {
                    const targetRelations = (targetProp.relation || [])
                        .filter(r => r.id !== sourceId)
                        .map(r => ({ id: r.id }));
                    await client.patch(`pages/${targetId}`, {
                        properties: {
                            [options.property]: {
                                relation: targetRelations,
                            },
                        },
                    });
                    console.log(`✅ Unlinked: ${targetTitle} ✕ ${sourceTitle} (bidirectional)`);
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Show graph
    relations
        .command('graph <page_id>')
        .description('Show relationship graph for a page')
        .option('--depth <number>', 'How many levels deep to traverse', '1')
        .option('--format <type>', 'Output format: text, dot, json', 'text')
        .action(async (pageId, options) => {
        try {
            const client = getClient();
            const depth = parseInt(options.depth, 10);
            // Track visited pages
            const visited = new Set();
            const nodes = [];
            const edges = [];
            // BFS traversal
            const queue = [{ id: pageId, level: 0 }];
            while (queue.length > 0) {
                const { id, level } = queue.shift();
                if (visited.has(id) || level > depth)
                    continue;
                visited.add(id);
                try {
                    const page = await client.get(`pages/${id}`);
                    const title = getPageTitle(page);
                    nodes.push({ id, title, level });
                    // Find relations
                    for (const [propName, propValue] of Object.entries(page.properties)) {
                        const prop = propValue;
                        if (prop.type === 'relation' && prop.relation) {
                            for (const rel of prop.relation) {
                                edges.push({ from: id, to: rel.id, property: propName });
                                if (!visited.has(rel.id) && level + 1 <= depth) {
                                    queue.push({ id: rel.id, level: level + 1 });
                                }
                            }
                        }
                    }
                    process.stdout.write(`\rTraversing: ${nodes.length} nodes...`);
                }
                catch {
                    // Page might not be accessible
                }
            }
            console.log(`\rFound ${nodes.length} nodes, ${edges.length} edges.      \n`);
            // Output
            if (options.format === 'json') {
                console.log(formatOutput({ nodes, edges }));
                return;
            }
            if (options.format === 'dot') {
                console.log('digraph G {');
                console.log('  rankdir=LR;');
                for (const node of nodes) {
                    const label = node.title.replace(/"/g, '\\"').slice(0, 30);
                    console.log(`  "${node.id.slice(0, 8)}" [label="${label}"];`);
                }
                for (const edge of edges) {
                    console.log(`  "${edge.from.slice(0, 8)}" -> "${edge.to.slice(0, 8)}" [label="${edge.property}"];`);
                }
                console.log('}');
                return;
            }
            // Text format
            console.log('📊 Relationship Graph:\n');
            const rootNode = nodes.find(n => n.id === pageId);
            if (rootNode) {
                console.log(`🎯 ${rootNode.title} (root)`);
                const outgoing = edges.filter(e => e.from === pageId);
                const incoming = edges.filter(e => e.to === pageId);
                if (outgoing.length > 0) {
                    console.log('\n   → Links to:');
                    for (const edge of outgoing) {
                        const target = nodes.find(n => n.id === edge.to);
                        console.log(`      ${target?.title || edge.to.slice(0, 8)} (via ${edge.property})`);
                    }
                }
                if (incoming.length > 0) {
                    console.log('\n   ← Linked from:');
                    for (const edge of incoming) {
                        const source = nodes.find(n => n.id === edge.from);
                        console.log(`      ${source?.title || edge.from.slice(0, 8)} (via ${edge.property})`);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=relations.js.map