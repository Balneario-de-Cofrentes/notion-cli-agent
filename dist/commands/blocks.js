import { getClient } from '../client.js';
import { formatOutput, formatBlock } from '../utils/format.js';
export function registerBlocksCommand(program) {
    const blocks = program
        .command('block')
        .alias('blocks')
        .alias('b')
        .description('Manage page content blocks');
    // Get block
    blocks
        .command('get <block_id>')
        .description('Retrieve a block by ID')
        .option('-j, --json', 'Output raw JSON')
        .action(async (blockId, options) => {
        try {
            const client = getClient();
            const block = await client.get(`blocks/${blockId}`);
            console.log(options.json ? formatOutput(block) : formatBlock(block));
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // List children
    blocks
        .command('list <block_id>')
        .alias('children')
        .description('List child blocks of a page or block')
        .option('-l, --limit <number>', 'Max results', '100')
        .option('--cursor <cursor>', 'Pagination cursor')
        .option('-j, --json', 'Output raw JSON')
        .action(async (blockId, options) => {
        try {
            const client = getClient();
            const query = {};
            if (options.limit)
                query.page_size = parseInt(options.limit, 10);
            if (options.cursor)
                query.start_cursor = options.cursor;
            const result = await client.get(`blocks/${blockId}/children`, query);
            if (options.json) {
                console.log(formatOutput(result));
                return;
            }
            const typedResult = result;
            for (const block of typedResult.results) {
                console.log(formatBlock(block));
            }
            if (typedResult.has_more) {
                console.log(`\nMore results available. Use --cursor ${typedResult.next_cursor}`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Append blocks
    blocks
        .command('append <block_id>')
        .description('Append content to a block or page')
        .option('-t, --text <text>', 'Add paragraph with text')
        .option('--heading1 <text>', 'Add heading 1')
        .option('--heading2 <text>', 'Add heading 2')
        .option('--heading3 <text>', 'Add heading 3')
        .option('--bullet <text...>', 'Add bullet list items')
        .option('--numbered <text...>', 'Add numbered list items')
        .option('--todo <text...>', 'Add todo items')
        .option('--code <text>', 'Add code block')
        .option('--code-lang <language>', 'Code block language', 'plain text')
        .option('--quote <text>', 'Add quote block')
        .option('--divider', 'Add divider')
        .option('--callout <text>', 'Add callout block')
        .option('--after <block_id>', 'Insert after this block')
        .option('-j, --json', 'Output raw JSON')
        .action(async (blockId, options) => {
        try {
            const client = getClient();
            const children = [];
            // Build blocks from options
            if (options.text) {
                children.push(createParagraph(options.text));
            }
            if (options.heading1) {
                children.push(createHeading(options.heading1, 1));
            }
            if (options.heading2) {
                children.push(createHeading(options.heading2, 2));
            }
            if (options.heading3) {
                children.push(createHeading(options.heading3, 3));
            }
            if (options.bullet) {
                for (const text of options.bullet) {
                    children.push(createBullet(text));
                }
            }
            if (options.numbered) {
                for (const text of options.numbered) {
                    children.push(createNumbered(text));
                }
            }
            if (options.todo) {
                for (const text of options.todo) {
                    children.push(createTodo(text));
                }
            }
            if (options.code) {
                children.push(createCode(options.code, options.codeLang));
            }
            if (options.quote) {
                children.push(createQuote(options.quote));
            }
            if (options.divider) {
                children.push({ object: 'block', type: 'divider', divider: {} });
            }
            if (options.callout) {
                children.push(createCallout(options.callout));
            }
            if (children.length === 0) {
                console.error('Error: No content specified. Use --text, --heading1, --bullet, etc.');
                process.exit(1);
            }
            const body = { children };
            if (options.after) {
                body.after = options.after;
            }
            const result = await client.patch(`blocks/${blockId}/children`, body);
            if (options.json) {
                console.log(formatOutput(result));
            }
            else {
                console.log(`✅ Added ${children.length} block(s)`);
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Update block
    blocks
        .command('update <block_id>')
        .description('Update a block')
        .option('-t, --text <text>', 'New text content')
        .option('--archive', 'Archive the block')
        .option('-j, --json', 'Output raw JSON')
        .action(async (blockId, options) => {
        try {
            const client = getClient();
            // First, get the block to know its type
            const existing = await client.get(`blocks/${blockId}`);
            const blockType = existing.type;
            const body = {};
            if (options.text) {
                body[blockType] = {
                    rich_text: [{ type: 'text', text: { content: options.text } }],
                };
            }
            if (options.archive) {
                body.archived = true;
            }
            const result = await client.patch(`blocks/${blockId}`, body);
            if (options.json) {
                console.log(formatOutput(result));
            }
            else {
                console.log('✅ Block updated');
            }
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
    // Delete block
    blocks
        .command('delete <block_id>')
        .description('Delete (archive) a block')
        .action(async (blockId) => {
        try {
            const client = getClient();
            await client.delete(`blocks/${blockId}`);
            console.log('✅ Block deleted');
        }
        catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });
}
// Block creation helpers
function createRichText(text) {
    return [{ type: 'text', text: { content: text } }];
}
function createParagraph(text) {
    return {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: createRichText(text) },
    };
}
function createHeading(text, level) {
    const type = `heading_${level}`;
    return {
        object: 'block',
        type,
        [type]: { rich_text: createRichText(text) },
    };
}
function createBullet(text) {
    return {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: createRichText(text) },
    };
}
function createNumbered(text) {
    return {
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: createRichText(text) },
    };
}
function createTodo(text, checked = false) {
    return {
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: createRichText(text), checked },
    };
}
function createCode(text, language) {
    return {
        object: 'block',
        type: 'code',
        code: {
            rich_text: createRichText(text),
            language,
        },
    };
}
function createQuote(text) {
    return {
        object: 'block',
        type: 'quote',
        quote: { rich_text: createRichText(text) },
    };
}
function createCallout(text) {
    return {
        object: 'block',
        type: 'callout',
        callout: {
            rich_text: createRichText(text),
            icon: { type: 'emoji', emoji: '💡' },
        },
    };
}
//# sourceMappingURL=blocks.js.map