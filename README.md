# notion-cli

A full-featured command line interface for the Notion API — **built for humans AND AI agents**.

## Features

- **Search** - Find pages and databases across your workspace
- **Pages** - Create, read, update, and archive pages
- **Databases** - Query, create, and manage databases with filters and sorting
- **Blocks** - Add and manage page content (paragraphs, headings, lists, todos, code, etc.)
- **Comments** - Read and create comments on pages
- **Users** - List workspace users and get current integration info
- **Raw API** - Direct API access for advanced use cases

### 🤖 AI Agent Features

- **Export to Obsidian** - Export pages and databases with YAML frontmatter
- **Batch operations** - Execute multiple ops in one command (fewer tool calls)
- **Dry-run mode** - Preview what would happen without executing
- **LLM-friendly output** - Structured output optimized for AI consumption

## Installation

```bash
# Clone and build
git clone https://github.com/cf3/notion-cli.git
cd notion-cli
pnpm install
pnpm build

# Link globally (optional)
pnpm link --global
```

## Setup

### Get your API token

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the API key (starts with `ntn_` or `secret_`)

### Configure the token

```bash
# Option 1: Environment variable (recommended)
export NOTION_TOKEN="ntn_your_token_here"

# Option 2: Config file
mkdir -p ~/.config/notion
echo "ntn_your_token_here" > ~/.config/notion/api_key

# Option 3: Pass directly to commands
notion --token "ntn_xxx" search "query"
```

### Share your content

**Important:** You must share pages/databases with your integration for it to access them:
1. Open a page or database in Notion
2. Click "..." menu → "Connect to" → Select your integration

## Usage

### Search

```bash
# Search everything
notion search "project"

# Search only pages
notion search "meeting" --type page

# Search only databases  
notion search "tasks" --type database

# Sort by last edited
notion search "notes" --sort desc

# JSON output for scripting
notion search "query" --json
```

### Pages

```bash
# Get a page
notion page get <page_id>

# Get page with content (blocks)
notion page get <page_id> --content

# Create page in a database
notion page create --parent <database_id> --title "New Task"

# Create with properties
notion page create --parent <db_id> --title "Bug Fix" \
  --prop "Priority=High" \
  --prop "Tags=bug,urgent"

# Create page under another page
notion page create --parent <page_id> --parent-type page --title "Subpage"

# Specify title property name (if not "Name")
notion page create --parent <db_id> --title "Task" --title-prop "Título"

# Update page properties
notion page update <page_id> --prop "Status=Done"

# Archive a page
notion page archive <page_id>
```

### Databases

```bash
# Get database schema
notion db get <database_id>

# Query database
notion db query <database_id>
notion db query <database_id> --limit 10

# Filter by property (auto-detects type for simple values)
notion db query <db_id> --filter-prop "Priority" --filter-type "equals" --filter-value "High"

# Filter with explicit property type (for status, etc.)
notion db query <db_id> \
  --filter-prop "Status" \
  --filter-type "equals" \
  --filter-value "In Progress" \
  --filter-prop-type status

# Filter with JSON (for complex queries)
notion db query <db_id> --filter '{"and":[{"property":"Status","status":{"equals":"Done"}},{"property":"Priority","select":{"equals":"High"}}]}'

# Sort results
notion db query <db_id> --sort "Created" --sort-dir desc

# Create database
notion db create --parent <page_id> --title "My Tasks" \
  --property "Status:select" \
  --property "Due:date" \
  --property "Priority:select"

# Update database
notion db update <db_id> --title "New Title"
notion db update <db_id> --add-prop "Tags:multi_select"
notion db update <db_id> --remove-prop "OldProperty"
```

### Blocks (Page Content)

```bash
# List page content
notion block list <page_id>

# Get a specific block
notion block get <block_id>

# Add content to a page
notion block append <page_id> --text "Hello world"
notion block append <page_id> --heading1 "Title"
notion block append <page_id> --heading2 "Section"
notion block append <page_id> --heading3 "Subsection"

# Add lists
notion block append <page_id> --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --numbered "First" --numbered "Second"
notion block append <page_id> --todo "Buy groceries" --todo "Call mom"

# Add code blocks
notion block append <page_id> --code "console.log('hi')" --code-lang javascript

# Add other content
notion block append <page_id> --quote "To be or not to be"
notion block append <page_id> --callout "Important note"
notion block append <page_id> --divider

# Insert after a specific block
notion block append <page_id> --text "Inserted" --after <block_id>

# Update block content
notion block update <block_id> --text "New content"

# Delete (archive) a block
notion block delete <block_id>
```

### Comments

```bash
# List comments on a page/block
notion comment list <page_id>

# Get a specific comment
notion comment get <comment_id>

# Create comment on a page (starts new discussion)
notion comment create --page <page_id> --text "Great work!"

# Reply to existing discussion
notion comment create --discussion <discussion_id> --text "I agree"
```

### Users

```bash
# Get current user (integration bot)
notion user me

# List all workspace users
notion user list

# Get specific user
notion user get <user_id>
```

### Export (Obsidian Integration)

```bash
# Export a page to Markdown
notion export page <page_id>

# Export with Obsidian frontmatter (YAML metadata)
notion export page <page_id> --obsidian

# Save to file
notion export page <page_id> --obsidian -o my-page.md

# Export entire database to Obsidian vault
notion export db <database_id> --vault ~/my-vault

# Export to subfolder
notion export db <db_id> --vault ~/my-vault --folder notion-tasks

# Include page content (slower but complete)
notion export db <db_id> --vault ~/my-vault --content

# Export with filter
notion export db <db_id> --vault ~/my-vault --filter '{"property":"Status","status":{"equals":"Done"}}'
```

The exported files include:
- YAML frontmatter with all Notion properties
- `notion_id` and `notion_url` for reference
- Dates, tags, status, relations, etc.
- Compatible with Obsidian Dataview plugin

### Batch Operations (for AI Agents)

Execute multiple operations in a single command — perfect for reducing tool calls in AI agents:

```bash
# Dry run - see what would happen
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"abc123"},
  {"op":"query","type":"database","id":"def456"}
]'

# Execute with LLM-friendly output
notion batch --llm --data '[
  {"op":"get","type":"page","id":"abc123"},
  {"op":"create","type":"page","parent":"def456","data":{"properties":{"Name":{"title":[{"text":{"content":"New Task"}}]}}}},
  {"op":"update","type":"page","id":"ghi789","data":{"properties":{"Status":{"status":{"name":"Done"}}}}}
]'

# Read operations from file
notion batch -f operations.json

# Stop on first error
notion batch --stop-on-error -f operations.json
```

**Supported operations:**

| Op | Type | Description |
|----|------|-------------|
| `get` | page, database, block | Retrieve by ID |
| `create` | page, database | Create new |
| `update` | page, database, block | Update properties |
| `delete` | page, block | Archive/delete |
| `query` | database | Query with filters |
| `append` | block | Append children |

### Raw API Access

For advanced use cases not covered by other commands:

```bash
# GET request
notion api GET "pages/<page_id>"

# POST request with body
notion api POST "search" --data '{"query":"test"}'

# With query parameters
notion api GET "users" --query "page_size=5"
```

## Property Formats

When setting properties with `--prop`, the CLI auto-detects types:

| Value Format | Detected Type | Example |
|--------------|---------------|---------|
| Plain text | select | `--prop "Status=Done"` |
| `true`/`false` | checkbox | `--prop "Active=true"` |
| Numbers | number | `--prop "Count=42"` |
| `YYYY-MM-DD` | date | `--prop "Due=2024-12-31"` |
| URL | url | `--prop "Link=https://..."` |
| Email | email | `--prop "Contact=me@example.com"` |
| Comma-separated | multi_select | `--prop "Tags=bug,urgent"` |
| JSON | as-is | `--prop 'Data={"key":"value"}'` |

## Filter Property Types

When filtering databases, use `--filter-prop-type` for non-select properties:

| Type | Example |
|------|---------|
| `status` | `--filter-prop-type status` |
| `select` | `--filter-prop-type select` |
| `multi_select` | `--filter-prop-type multi_select` |
| `text` / `rich_text` | `--filter-prop-type text` |
| `number` | `--filter-prop-type number` |
| `checkbox` | `--filter-prop-type checkbox` |
| `date` | `--filter-prop-type date` |

## Output Formats

- **Default**: Human-readable formatted output
- **`--json` or `-j`**: Raw JSON output (for scripting)

## Examples

### Create a task and add content

```bash
# Create task
PAGE_ID=$(notion page create --parent $DB_ID --title "Write docs" --json | jq -r '.id')

# Add content
notion block append $PAGE_ID --heading2 "Overview"
notion block append $PAGE_ID --text "This document covers..."
notion block append $PAGE_ID --todo "Write introduction"
notion block append $PAGE_ID --todo "Add examples"
```

### Find and update tasks

```bash
# Find in-progress tasks and mark for review
notion db query $DB_ID \
  --filter-prop Status --filter-type equals --filter-value "In Progress" \
  --filter-prop-type status --json | \
  jq -r '.results[].id' | \
  while read id; do
    notion page update $id --prop "Status=Review"
  done
```

### Export database to JSON

```bash
notion db query $DB_ID --limit 100 --json > tasks.json
```

### Backup page content

```bash
notion page get $PAGE_ID --content --json > page-backup.json
```

## Aliases

For convenience, commands have shorter aliases:

| Command | Aliases |
|---------|---------|
| `page` | `pages`, `p` |
| `database` | `databases`, `db` |
| `block` | `blocks`, `b` |
| `comment` | `comments` |
| `user` | `users` |

## Requirements

- Node.js 20+
- A Notion integration with appropriate permissions

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss changes.
