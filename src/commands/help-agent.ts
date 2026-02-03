/**
 * Help for AI agents - comprehensive quick reference
 */
import { Command } from 'commander';

export function registerHelpAgentCommand(program: Command): void {
  program
    .command('quickstart')
    .alias('qs')
    .description('Quick reference guide for AI agents')
    .action(() => {
      console.log(`
# notion-cli-agent Quick Reference for AI Agents

## Setup
Export your token: export NOTION_TOKEN="ntn_xxx"

## Most Common Operations

### 1. Discover workspace structure
\`\`\`bash
notion inspect ws                    # List all accessible databases
notion inspect schema <db_id>        # Get database schema with property types
notion inspect context <db_id>       # Full context for working with a database
\`\`\`

### 2. Search and query
\`\`\`bash
notion search "keyword"              # Search pages and databases
notion db query <db_id> --limit 10   # Query database entries
notion find "overdue tasks" -d <db_id>  # Smart natural language query
\`\`\`

### 3. Create entries
\`\`\`bash
notion page create --parent <db_id> --title "New Entry"
notion page create --parent <db_id> --title "Task" --prop "Status=Todo" --prop "Priority=High"
\`\`\`

### 4. Update entries
\`\`\`bash
notion page update <page_id> --prop "Status=Done"
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --yes
\`\`\`

### 5. Read page content
\`\`\`bash
notion page get <page_id>            # Get page properties
notion page get <page_id> --content  # Include content blocks
notion ai summarize <page_id>        # Get concise summary
\`\`\`

### 6. Add content to pages
\`\`\`bash
notion block append <page_id> --text "Hello world"
notion block append <page_id> --heading2 "Section" --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --todo "Task to do"
\`\`\`

## Property Types for Filters

When filtering, specify --filter-prop-type for non-text properties:
- status: --filter-prop-type status
- select: --filter-prop-type select  
- number: --filter-prop-type number
- date: --filter-prop-type date
- checkbox: --filter-prop-type checkbox

Example:
\`\`\`bash
notion db query <db_id> --filter-prop "Status" --filter-type equals --filter-value "Done" --filter-prop-type status
\`\`\`

## AI-Specific Commands

\`\`\`bash
notion ai prompt <db_id>             # Generate optimal prompt for this database
notion ai summarize <page_id>        # Summarize page content
notion ai extract <page_id> --schema "email,phone,date"  # Extract structured data
notion ai suggest <db_id> "what I want to do"  # Get command suggestions
\`\`\`

## Batch Operations (reduce tool calls)

\`\`\`bash
notion batch --llm --data '[
  {"op":"get","type":"page","id":"xxx"},
  {"op":"create","type":"page","parent":"db_id","data":{...}},
  {"op":"update","type":"page","id":"yyy","data":{...}}
]'
\`\`\`

## Output Formats

- Default: Human-readable
- --json or -j: Raw JSON (for parsing)
- --llm: Optimized for LLM consumption

## Tips for AI Agents

1. Always run \`notion inspect context <db_id>\` first to understand database structure
2. Property names and values must match EXACTLY (case-sensitive)
3. Use --dry-run on bulk/batch operations before executing
4. Status properties use "status" type, not "select"
5. The title property name varies per database (could be "Name", "Título", "Task", etc.)

## Get Help

\`\`\`bash
notion --help                # List all commands
notion <command> --help      # Help for specific command
notion ai prompt <db_id>     # Database-specific instructions
\`\`\`
`);
    });
}
