# notion-cli

Full-featured command line interface for the Notion API.

## Installation

```bash
# Clone and install
git clone https://github.com/cf3/notion-cli
cd notion-cli
pnpm install
pnpm build

# Link globally
pnpm link --global
```

Or install directly:

```bash
npm install -g @cf3/notion-cli
```

## Setup

Set your Notion API token:

```bash
# Option 1: Environment variable
export NOTION_TOKEN="ntn_your_token_here"

# Option 2: Config file
mkdir -p ~/.config/notion
echo "ntn_your_token_here" > ~/.config/notion/api_key
```

Get your token from [notion.so/my-integrations](https://www.notion.so/my-integrations).

**Important:** Share your pages/databases with the integration for access.

## Usage

### Search

```bash
# Search everything
notion search "project"

# Search only pages
notion search "meeting notes" --type page

# Search only databases
notion search "tasks" --type database

# Output JSON
notion search "query" --json
```

### Pages

```bash
# Get a page
notion page get <page_id>
notion page get <page_id> --content  # Include blocks
notion page get <page_id> --json

# Create a page in a database
notion page create --parent <database_id> --title "New Task"
notion page create --parent <database_id> --title "Bug" \
  --prop "Status=In Progress" \
  --prop "Priority=High"

# Create a page under another page
notion page create --parent <page_id> --parent-type page --title "Subpage"

# Update a page
notion page update <page_id> --prop "Status=Done"
notion page update <page_id> --archive

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

# Query with filters
notion db query <database_id> \
  --filter-prop "Status" \
  --filter-type "equals" \
  --filter-value "Done"

# Query with JSON filter
notion db query <database_id> --filter '{"property":"Status","select":{"equals":"Done"}}'

# Query with sorting
notion db query <database_id> --sort "Created" --sort-dir desc

# Create database
notion db create --parent <page_id> --title "My Tasks" \
  --property "Status:select" \
  --property "Due:date" \
  --property "Priority:select"

# Update database
notion db update <database_id> --title "New Title"
notion db update <database_id> --add-prop "Tags:multi_select"
notion db update <database_id> --remove-prop "Old Property"
```

### Blocks (Page Content)

```bash
# List page content
notion block list <page_id>

# Get a specific block
notion block get <block_id>

# Append content to a page
notion block append <page_id> --text "Hello world"
notion block append <page_id> --heading1 "Chapter 1"
notion block append <page_id> --heading2 "Section A"
notion block append <page_id> --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --numbered "First" --numbered "Second"
notion block append <page_id> --todo "Buy groceries" --todo "Call mom"
notion block append <page_id> --code "console.log('hi')" --code-lang javascript
notion block append <page_id> --quote "To be or not to be"
notion block append <page_id> --callout "Important note here"
notion block append <page_id> --divider

# Insert after a specific block
notion block append <page_id> --text "Inserted text" --after <block_id>

# Update a block
notion block update <block_id> --text "New content"
notion block update <block_id> --archive

# Delete a block
notion block delete <block_id>
```

### Comments

```bash
# List comments on a page/block
notion comment list <page_id>

# Get a specific comment
notion comment get <comment_id>

# Create a comment on a page (starts new discussion)
notion comment create --page <page_id> --text "Great work!"

# Reply to existing discussion
notion comment create --discussion <discussion_id> --text "I agree"
```

### Users

```bash
# Get current user (integration bot)
notion user me

# List all users
notion user list

# Get a specific user
notion user get <user_id>
```

### Raw API

For advanced use cases:

```bash
# GET request
notion api GET pages/<page_id>

# POST request with body
notion api POST search --data '{"query":"test"}'

# With query parameters
notion api GET users --query "page_size=5"
```

## Property Formats

When setting properties with `--prop`:

| Type | Format | Example |
|------|--------|---------|
| Text | `key=value` | `--prop "Notes=Hello"` |
| Number | `key=123` | `--prop "Count=42"` |
| Checkbox | `key=true/false` | `--prop "Done=true"` |
| Date | `key=YYYY-MM-DD` | `--prop "Due=2024-12-31"` |
| URL | `key=https://...` | `--prop "Link=https://example.com"` |
| Email | `key=a@b.com` | `--prop "Contact=me@example.com"` |
| Select | `key=value` | `--prop "Status=Done"` |
| Multi-select | `key=a,b,c` | `--prop "Tags=bug,urgent"` |

## Output

- Default: Human-readable formatted output
- `--json` or `-j`: Raw JSON output (for scripting)

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
notion block append $PAGE_ID --todo "Review"
```

### Query and update tasks

```bash
# Find all in-progress tasks
notion db query $DB_ID --filter-prop Status --filter-type equals --filter-value "In Progress" --json | \
  jq -r '.results[].id' | \
  while read id; do
    notion page update $id --prop "Status=Review"
  done
```

### Export database to JSON

```bash
notion db query $DB_ID --limit 100 --json > tasks.json
```

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss.
