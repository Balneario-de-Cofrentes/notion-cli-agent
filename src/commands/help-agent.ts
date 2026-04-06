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
notion inspect ws --compact          # List all accessible databases
notion inspect ws --json             # Full raw inventory
notion inspect schema <db_id> --llm  # Get database schema with valid values
notion inspect context <db_id>       # Full context for working with a database
\`\`\`

### 2. Search and query
\`\`\`bash
# Deterministic lookup in a known DB (preferred)
notion db query <db_id> --title "Known Page" --json
notion db query <db_id> --limit 20 --llm

# Fuzzy search (workspace-wide, best-effort)
notion search "keyword" --limit 10
notion search "keyword" --db <db_id> --llm           # filter by parent DB
notion search "short title" --exact --first --json    # exact match, one result

# Natural language
notion find "overdue tasks unassigned" -d <db_id> --llm
notion find "high priority" -d <db_id> --explain      # preview filter
\`\`\`

### 3. Create entries
\`\`\`bash
notion page create --parent <db_id> --title "New Entry"
notion page create --parent <db_id> --title "Task" --prop "Status:status=Todo" --prop "Priority:select=High"
\`\`\`

### 4. Update entries
\`\`\`bash
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --clear-prop "Assignee"     # type-aware clear
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
\`\`\`

### 5. Read page content
\`\`\`bash
notion page get <page_id>            # Get page properties
notion page get <page_id> --content  # Include content blocks
notion page get <page_id> --json     # Raw JSON
notion page read <page_id>           # Content as Markdown
notion page read <page_id> -o page.md
notion ai summarize <page_id>        # Get concise summary
\`\`\`

### 6. Write page content
\`\`\`bash
notion page write <page_id> -f content.md             # Append Markdown
notion page write <page_id> -f doc.md --replace        # Replace all content
notion page edit <page_id> --at 3 --delete 2           # Surgical block editing
notion page edit <page_id> --at 5 --markdown "New text"
\`\`\`

### 7. Add blocks
\`\`\`bash
notion block append <page_id> --text "Hello world"
notion block append <page_id> --heading2 "Section" --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --todo "Task to do"
\`\`\`

### 8. Dedup and maintenance
\`\`\`bash
notion dedup <db_id>                                   # Find duplicates
notion dedup <db_id> --fuzzy                           # Include near-duplicates
notion dedup <db_id> --fix --strategy keep-largest --yes
notion validate check <db_id> --check-dates --check-stale 30
notion stats overview <db_id>
\`\`\`

## Property Type Hints

Use \`Key:type=Value\` to force a type (avoids status/select ambiguity):
\`\`\`bash
notion page update <id> --prop "Status:status=Done"
notion page update <id> --prop "Notes:rich_text=Text"
notion page update <id> --prop "Owner:people=<user_id>"
\`\`\`

## Property Types for Filters

When filtering, specify --filter-prop-type for non-text properties:
- status: --filter-prop-type status
- select: --filter-prop-type select
- number: --filter-prop-type number
- date: --filter-prop-type date
- checkbox: --filter-prop-type checkbox
- people: --filter-prop-type people
- relation: --filter-prop-type relation

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
notion batch --dry-run --data '[...]'  # Preview first
\`\`\`

## Output Formats

| Flag | Use for |
|------|---------|
| (default) | Human-readable |
| --json / -j | Raw JSON for parsing |
| --llm | Compact structured output (search, db query, find, batch, inspect, stats) |
| --csv | CSV with headers (db query, find) |
| --tsv | Tab-separated (db query, find) |
| --ids-only | One ID per line for piping (db query, search, find) |

## Tips for AI Agents

1. Always run \`notion inspect context <db_id>\` first to understand database structure
2. For exact lookup by title, use \`db query --title\` — not \`search --exact\`
3. Property names are resolved case-insensitively since v0.10.0, but prefer exact schema labels
4. Use \`--clear-prop\` instead of fake empty values like \`Owner:people=\`
5. Use --dry-run on bulk/batch operations before executing
6. Status properties use "status" type, not "select" — use type hints to disambiguate
7. The title property name varies per database (could be "Name", "Título", "Task", etc.)

## Get Help

\`\`\`bash
notion --help                # List all commands
notion <command> --help      # Help for specific command
notion ai prompt <db_id>     # Database-specific instructions
\`\`\`
`);
    });
}
