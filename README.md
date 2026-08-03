# notion-cli-agent

> The most powerful command-line interface for Notion — built for AI agents first, humans too.

[![npm version](https://img.shields.io/npm/v/notion-cli-agent.svg)](https://www.npmjs.com/package/notion-cli-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

notion-cli-agent is designed to be used by AI agents that need to read and write Notion workspaces — natural language queries, batch operations, `--llm` output mode, workspace introspection, and more. Works great for humans too.

---

## 🤖 For AI Agents

### Quick start

```bash
npm install -g notion-cli-agent
export NOTION_TOKEN="ntn_your_token_here"

# Full quick reference (read this first)
notion quickstart
```

### Agent Skills (recommended)

This repo ships [AgentSkills](https://agentskills.dev)-compatible skill files in the [`skills/`](./skills/) directory. Skills use **progressive disclosure**: the core `SKILL.md` is small enough to live in your agent's context window, and detailed reference files (`filters.md`, `batch-patterns.md`, `workflows.md`) are loaded on demand.

```
skills/
├── notion-onboarding/    ← run first: maps your workspace to a state file
└── notion-cli-agent/     ← core CLI skill + references
```

**Recommended setup for agents:**

1. Install skills in your agent framework (see [`skills/README.md`](./skills/README.md))
2. Run the **`notion-onboarding`** skill once — it discovers your databases (tasks, projects, OKRs, home page) and saves them to `~/.config/notion/workspace.json`
3. All subsequent tasks use the mapped IDs automatically — no more looking up database IDs

### Why a CLI over the Notion MCP/API?

- **`--llm` mode** — compact, structured output optimized for agent consumption
- **`notion find`** — natural language → Notion filters in one command
- **`notion batch`** — multiple operations in a single shell call (minimize tool calls)
- **`notion ai prompt`** — generates a database-specific prompt for the agent
- **`notion inspect context`** — full schema + examples + command reference in one shot
- No rate-limit boilerplate, no SDK setup, shell-composable

---

## ✨ Features

### Core Operations
- **Search** — Find pages and databases across your workspace
- **Pages** — Create, read, update, archive pages with full property support
- **Databases** — Query with filters, create schemas, manage entries
- **Blocks** — Add and manage page content (paragraphs, headings, lists, code, etc.)
- **Comments** — Read and create comments on pages
- **Files** — Upload images and attachments to pages, properties, icons/covers, and comments
- **Users** — List workspace users and integrations

### 🤖 AI Agent Features
- **Smart Queries** — Natural language queries translated to Notion filters
- **Batch Operations** — Execute multiple operations in one command
- **Agent Prompts** — Generate optimal prompts for AI agents to work with databases
- **Summarize** — Get concise page summaries
- **Extract** — Pull structured data from page content

### 🔄 Obsidian Integration
- **Export to Obsidian** — Pages and databases with YAML frontmatter
- **Import from Obsidian** — Import vault notes to Notion
- **CSV & Markdown import** — Bulk import from files

### 📊 Analytics & Validation
- **Statistics** — Database metrics, breakdowns by property
- **Timeline** — Activity visualization over time
- **Health Check** — Database integrity scoring
- **Validation** — Find missing fields, overdue items, stale entries

### 🔗 Advanced Features
- **Workspace Sync** — Cache databases locally, use names instead of UUIDs everywhere
- **Templates** — Save and reuse page structures
- **Backup** — Full database backup to JSON/Markdown
- **Duplicate** — Clone pages and entire databases
- **Relations** — Manage links, find backlinks, visualize graphs
- **Bulk Operations** — Update or archive hundreds of entries at once

---

## 📦 Installation

### From npm (recommended)

```bash
npm install -g notion-cli-agent
```

### From source

```bash
# Clone the repository
git clone https://github.com/Balneario-de-Cofrentes/notion-cli-agent.git
cd notion-cli-agent

# Install dependencies
pnpm install

# Build
pnpm build

# Link globally
pnpm link --global
```

### Requirements
- Node.js 20+
- A Notion integration token ([create one here](https://www.notion.so/my-integrations))

---

## ⚙️ Configuration

### 1. Get your API token

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name and select capabilities
4. Copy the token (starts with `ntn_` or `secret_`)

### 2. Set the token

```bash
# Option 1: Environment variable (recommended)
export NOTION_TOKEN="ntn_your_token_here"

# Option 2: Pass directly
notion --token "ntn_xxx" search "query"
```

### 3. Share content with your integration

**Important:** Your integration can only access pages explicitly shared with it.

1. Open any page or database in Notion
2. Click "..." menu → "Connect to" → Select your integration

---

## 🔄 Workspace Sync

Sync your workspace to use database names instead of UUIDs:

```bash
# Cache all accessible databases locally
notion sync

# List cached databases
notion list
notion list --json         # For scripts
notion list --ids-only     # One ID per line

# Now use names anywhere you'd use a database UUID
notion db query "Tasks" --limit 5
notion find "Tasks" "overdue assigned to me"
notion validate health "Projects"
notion stats overview "OKRs"
```

All database commands accept both UUIDs and names. Name resolution uses case-insensitive matching with substring fallback. If a name is ambiguous, the CLI shows candidates and asks you to be more specific.

---

## 📖 Usage Guide

### Basic Commands

```bash
# Search across workspace
notion search "project plan"
notion search "meeting" --type page
notion search "" --type database    # List all databases

# Exact lookup in a known database (deterministic)
notion db query <db_id> --title "Known Page" --json

# Filtered search (best-effort — Notion search is fuzzy)
notion search "keyword" --db <db_id> --exact --first --json
notion search "task" --db <db_id>                   # Filter by parent database

# Get page info
notion page get <page_id>
notion page get <page_id> --content  # Include blocks

# Create page in database
notion page create --parent <db_id> --title "New Task"
notion page create --parent <db_id> --title "Bug Fix" \
  --prop "Status=Todo" \
  --prop "Priority=High"
notion page create --parent <db_id> --title "Meeting Notes" --icon 📝

# Update page
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --title "New Title"
notion page update <page_id> --icon 🚀
notion page update <page_id> --clear-prop "Assignee"  # Type-aware clear

# Archive page
notion page archive <page_id>
```

### Output Formats

```bash
# Export database as CSV
notion db query <db_id> --csv > tasks.csv

# Tab-separated (paste into spreadsheets)
notion db query <db_id> --tsv | pbcopy

# Just IDs for piping into other commands
notion db query <db_id> --filter "Status=Done" --ids-only | \
  xargs -I {} notion page archive {}

# Count search results
notion search "bugs" --ids-only | wc -l
```

| Flag | Commands | Description |
|------|----------|-------------|
| `--json` / `-j` | all | Raw JSON |
| `--llm` | most | Compact agent-friendly output |
| `--csv` | `db query`, `find` | CSV with headers |
| `--tsv` | `db query`, `find` | Tab-separated |
| `--ids-only` | `db query`, `search`, `find` | One ID per line |

---

## 📄 Page Content (read/write/edit)

Read, write, and surgically edit page content as Markdown.

```bash
# Read page content as Markdown (uses native Notion markdown API)
notion page read <page_id>
notion page read <page_id> --blocks        # Legacy: fetch blocks and convert client-side
notion page read <page_id> --json          # Raw block JSON output
notion page read <page_id> -o page.md      # Write to file

# Write Markdown content into a page
notion page write <page_id> -f content.md
echo "# Hello" | notion page write <page_id>
notion page write <page_id> -f doc.md --replace   # Replace all content (destructive)

# Surgical block-level editing
notion page edit <page_id> --at 3 --delete 2                    # Delete 2 blocks at index 3
notion page edit <page_id> --at 5 --markdown "New paragraph"    # Insert at index 5
notion page edit <page_id> --at 0 --delete 1 --file new.md      # Replace first block
notion page edit <page_id> --dry-run --at 3 --delete 1          # Preview without changes
```

---

## 📎 Files & Attachments

Upload images and attachments to Notion. Anywhere a `<source>` is accepted it can be a **local path**, a **public URL** (Notion imports it server-side), or an existing **`file_upload` ID** (attach the same upload again without re-uploading). Files over 20 MB are split into parts automatically.

```bash
# Upload and attach in one call (block type detected from the file)
notion file attach <page_id> shot.png
notion file attach <page_id> a.pdf b.png --caption "Q3 report"
notion file attach <page_id> clip.mp4 --as video --after <block_id>

# Upload only — prints the file_upload ID for later use
notion file upload shot.png                       # → ID: 1a2b3c4d-...
notion file upload a.pdf b.png --json
notion file import https://example.com/logo.png   # Import from a public URL

# Inspect uploads
notion file list --status uploaded
notion file get <file_upload_id>

# Attach while adding content
notion block append <page_id> --text "See below" --image shot.png --caption "Diagram"
notion block append <page_id> --pdf report.pdf --file data.zip

# Page icon, cover, and files properties
notion page update <page_id> --icon logo.png --cover https://example.com/hero.jpg
notion page update <page_id> --attach "Attachments=spec.pdf,diagram.png"
notion page create --parent <db_id> -t "Release" --attach "Docs=notes.md"

# Comments (max 3 attachments)
notion comment create --page <page_id> -t "Screenshot attached" --attach shot.png
```

`--icon` still takes an emoji (`--icon 📝`); anything that looks like a path, URL, or upload ID is uploaded instead.

**URL imports need a file extension.** Notion requires a filename with an extension, and many CDN URLs end in a bare ID. Supply one with `--content-type` (or `--name`) and reuse the resulting ID:

```bash
notion file import https://images.unsplash.com/photo-1506744038136 --content-type image/jpeg
notion page update <page_id> --cover <file_upload_id>
```

---

## 🤖 AI Agent Features

### Smart Queries with `find`

Translate natural language into Notion filters:

```bash
# Find overdue tasks
notion find "overdue tasks" -d <db_id>

# Find unassigned items in progress
notion find "in progress unassigned" -d <db_id>

# Find high priority pending items
notion find "urgent pending" -d <db_id>

# See what filter was generated
notion find "tareas vencidas" -d <db_id> --explain
```

**Supported patterns:**
- Status: `done`, `in progress`, `todo`, `pending`, `hecho`, `en marcha`
- Assignment: `unassigned`, `sin asignar`
- Dates: `overdue`, `vencidas`, `today`, `this week`
- Priority: `urgent`, `high priority`, `importante`

### Batch Operations

Execute multiple operations in one command — perfect for AI agents to minimize tool calls:

```bash
# Preview what would happen
notion batch --dry-run --data '[
  {"op": "get", "type": "page", "id": "abc123"},
  {"op": "create", "type": "page", "parent": "db_id", "data": {...}},
  {"op": "update", "type": "page", "id": "xyz789", "data": {...}}
]'

# Execute with LLM-friendly output
notion batch --llm --data '[...]'

# Read from file
notion batch -f operations.json
```

**Supported operations:**
| Op | Types | Description |
|----|-------|-------------|
| `get` | page, database, block | Retrieve by ID |
| `create` | page, database | Create new |
| `update` | page, database, block | Modify |
| `delete` | page, block | Archive/delete |
| `query` | database | Query with filters |
| `append` | block | Add children |

### Generate Agent Prompts

Create optimal prompts for AI agents to work with a specific database:

```bash
notion ai prompt <database_id>
```

**Output includes:**
- Database schema with all properties
- Valid values for select/status fields (exact spelling matters!)
- Example entries
- Common operations with correct syntax
- Warnings about property naming (e.g., "Title is called 'Título', not 'Name'")

### Summarize Pages

Get concise summaries for quick understanding:

```bash
notion ai summarize <page_id>

# Output:
# Project Plan Q1
# Last edited: 2 days ago
# Blocks: 45
# Properties:
#   - Status: In Progress
#   - Owner: Juan
# Sections:
#   - Overview
#   - Timeline
#   - Resources
# Todos: 8/12 completed
```

### Extract Structured Data

Pull specific data points from page content:

```bash
notion ai extract <page_id> --schema "email,phone,company,date"

# Output:
{
  "email": "contact@example.com",
  "phone": "+34 612 345 678",
  "company": "Acme Corp",
  "date": "2024-03-15"
}
```

### Command Suggestions

Get command suggestions based on natural language:

```bash
notion ai suggest <db_id> "quiero ver las tareas completadas esta semana"

# Outputs:
# notion find "hecho" -d <db_id>
# notion db query <db_id> --filter-prop "Status" --filter-value "Hecho" --filter-prop-type status
```

---

## 🔄 Obsidian Integration

### Export to Obsidian

**Export a single page:**
```bash
notion export page <page_id> --obsidian -o my-note.md
```

**Export entire database to vault:**
```bash
notion export db <database_id> --vault ~/obsidian-vault --folder notion-tasks
```

**With full page content:**
```bash
notion export db <db_id> --vault ~/vault --content
```

**Exported files include:**
```yaml
---
notion_id: "abc123..."
notion_url: "https://notion.so/..."
created: 2024-01-15
updated: 2024-02-01
status: "In Progress"
priority: "High"
tags:
  - "project"
  - "q1"
---
# Page Title

Content here...
```

### Import from Obsidian

**Import vault to database:**
```bash
notion import obsidian ~/my-vault --to <database_id>
notion import obsidian ~/my-vault --to <db_id> --folder specific-folder
notion import obsidian ~/my-vault --to <db_id> --content  # Include page content
```

**Import CSV:**
```bash
notion import csv data.csv --to <database_id>
notion import csv tasks.csv --to <db_id> --title-column "Task Name"
```

**Import Markdown file:**
```bash
notion import markdown document.md --to <page_id>
notion import markdown doc.md --to <page_id> --replace  # Replace existing content
```

---

## 📊 Database Analytics

### Statistics Overview

```bash
notion stats overview <database_id>

# Output:
# 📊 Database: Tasks
#    Total entries: 342
#
# Status:
#   Done                 124 (36%)  ████████
#   In Progress           89 (26%)  ██████
#   Todo                  78 (23%)  █████
#   Blocked               51 (15%)  ███
#
# Priority:
#   High                  45 (13%)  ███
#   Medium               187 (55%)  ███████████
#   Low                  110 (32%)  ███████
```

### Activity Timeline

```bash
notion stats timeline <database_id> --days 14

# 2024-02-01 (Thu)  12 ████████████
# 2024-01-31 (Wed)   8 ████████
# 2024-01-30 (Tue)  15 ███████████████
# ...
```

---

## ✅ Validation & Health

### Full Validation

```bash
notion validate check <database_id> \
  --required "Assignee,Deadline" \
  --check-dates \
  --check-stale 30 \
  --fix

# Output:
# ⚠️ MISSING REQUIRED (23)
#    - Task ABC: Missing required property: Assignee
#    - Task XYZ: Missing required property: Deadline
#    Fix: notion page update <id> --prop "Assignee=..."
#
# ⚠️ OVERDUE (8)
#    - Old task: Overdue: deadline was 2024-01-15
#
# ℹ️ STALE (5)
#    - Stuck item: Not updated in 45 days (status: In Progress)
#
# 📊 Health Score: 72/100
```

### Quick Lint

```bash
notion validate lint <database_id>

# ✅ Empty titles: OK
# ⚠️ "In Progress" for >30 days: 5 found
# Total issues: 5
```

### Health Report

```bash
notion validate health <database_id>

# 📊 Health Report: Tasks
# ════════════════════════════════════════
# Health Score: 78/100 🟡
# ════════════════════════════════════════
#
# 📈 Activity (last 7 days): 34/100 entries (34%)
# ✅ Completion rate: 65%
# 📝 Average fill rate: 82%
#
# Property fill rates:
#   ✅ Title         ██████████ 100%
#   ✅ Status        ██████████ 100%
#   ⚠️ Assignee      ████████░░ 77%
#   ❌ Tags          ██░░░░░░░░ 15%
```

---

## 💾 Backup & Restore

### Full Database Backup

```bash
# Backup to JSON
notion backup <database_id> -o ./backups/tasks

# Backup to Markdown
notion backup <db_id> -o ./backups --format markdown

# Include page content
notion backup <db_id> -o ./backups --content

# Incremental backup (only changed entries)
notion backup <db_id> -o ./backups --incremental
```

**Output structure:**
```
backups/
├── schema.json           # Database schema
├── index.json            # Entry index
├── .backup-meta.json     # Backup metadata
└── pages/
    ├── Task_One_abc123.json
    ├── Task_Two_def456.json
    └── ...
```

---

## 🧹 Dedup — Find & Clean Duplicates

```bash
# Find duplicate pages by title
notion dedup <db_id>

# Include near-duplicates (strips copy/draft suffixes)
notion dedup <db_id> --fuzzy

# Archive duplicates, keep the page with most content
notion dedup <db_id> --fix --strategy keep-largest --yes

# Keep newest or oldest
notion dedup <db_id> --fix --strategy keep-newest --yes
notion dedup <db_id> --fix --strategy keep-oldest --yes

# Preview first (default when --fix without --yes)
notion dedup <db_id> --fix --strategy keep-largest
```

---

## 🔗 Relations & Backlinks

### Find Backlinks

Discover what pages link to a specific page:

```bash
notion relations backlinks <page_id>

# 📎 Direct Relations:
#    Project Alpha
#    └─ via property: Related Tasks
#
#    Sprint 23
#    └─ via property: Tasks
#
# 📝 Potential Mentions:
#    Meeting Notes Jan 15
#    Weekly Report
```

### Link/Unlink Pages

```bash
# Create relation
notion relations link <source_id> <target_id> --property "Related"

# Bidirectional linking
notion relations link <page1> <page2> --property "Related" --bidirectional

# Remove relation
notion relations unlink <source_id> <target_id> --property "Related"
```

### Visualize Relationship Graph

```bash
# Text format
notion relations graph <page_id> --depth 2

# DOT format (for Graphviz)
notion relations graph <page_id> --format dot > graph.dot
dot -Tpng graph.dot -o graph.png

# JSON format
notion relations graph <page_id> --format json
```

---

## 📋 Templates

### Save a Page as Template

```bash
notion template save <page_id> --name "weekly-report" --description "Weekly team report"
```

### List Templates

```bash
notion template list

# 📄 weekly-report
#    Blocks: 15
#    Description: Weekly team report
#
# 📄 meeting-notes
#    Blocks: 8
```

### Use Template

```bash
notion template use "weekly-report" --parent <db_id> --title "Report Week 5"
```

### Manage Templates

```bash
notion template show "weekly-report"  # View details
notion template delete "weekly-report"  # Remove
```

---

## 🔄 Bulk Operations

### Bulk Update

Update multiple entries at once:

```bash
# Preview first
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run

# Execute
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --yes
```

### Bulk Archive

Archive entries matching a condition:

```bash
# Archive completed items older than 2024
notion bulk archive <db_id> --where "Status=Done" --dry-run
notion bulk archive <db_id> --where "Status=Done" --yes
```

**Where clause syntax:**
- Equals: `Property=Value`
- Multiple conditions: `Status=Done,Priority=Low`

---

## 🔍 Workspace Introspection

### List Accessible Databases

```bash
notion inspect workspace
notion inspect ws --compact  # Just names and IDs
```

### Get Database Schema

```bash
notion inspect schema <database_id>
notion inspect schema <db_id> --llm  # Optimized for AI consumption
```

### Generate Context for AI

```bash
notion inspect context <database_id>

# Outputs comprehensive context including:
# - Schema with all properties and valid values
# - Example entries
# - Quick command reference
```

---

## 🔌 Raw API Access

For operations not covered by other commands:

```bash
# GET request
notion api GET "pages/<page_id>"

# POST with body
notion api POST "search" --data '{"query": "test"}'

# With query parameters
notion api GET "users" --query "page_size=5"
```

---

## 📝 Property Formats

When setting properties with `--prop`, the CLI auto-detects types:

| Value Format | Detected Type | Example |
|--------------|---------------|---------|
| Plain text | select | `--prop "Status=Done"` |
| `true`/`false` | checkbox | `--prop "Active=true"` |
| Numbers | number | `--prop "Count=42"` |
| `YYYY-MM-DD` | date | `--prop "Due=2024-12-31"` |
| URL | url | `--prop "Link=https://..."` |
| Email | email | `--prop "Contact=a@b.com"` |
| Comma-separated | multi_select | `--prop "Tags=bug,urgent"` |

**Type hints** — Force a specific property type with `Key:type=Value`:

```bash
# Status properties (vs auto-detected select)
notion page update <id> --prop "Status:status=Done"

# Rich text instead of select
notion page update <id> --prop "Notes:rich_text=Some notes"

# People by user ID, email, or name
notion page update <id> --prop "Assignee:people=user-id-here"
notion page update <id> --prop "Assignee:people=ana@example.com"   # resolved to id
notion page update <id> --prop "Assignee:people=Ana Pérez"          # case-insensitive name
```

> **Assigning guests.** Notion's `GET /v1/users` (and `notion user list`) only
> returns **members and bots** — guest users are invisible and you can't list
> their id. Run `notion user resolve-guests` once: it discovers guests from
> page authorship (`created_by`/`last_edited_by`) via `GET /v1/users/{id}` and
> caches them in `~/.config/notion/guests.json`. After that, `notion user list`
> shows them flagged `[guest]`, and `--prop "Field:people=<email|name>"`
> resolves members (live list) and guests (cache) — exact email first, then
> case-insensitive name. `notion sync` fishes guests too. Non-UUID values that
> match nothing pass through unchanged.

For database queries with non-select properties:
```bash
notion db query <db_id> \
  --filter-prop "Status" \
  --filter-type equals \
  --filter-value "Done" \
  --filter-prop-type status  # Required for status type
```

---

## 🔌 MCP Server Mode

Run as an MCP tool server for agent frameworks (Claude Code, Cursor, VS Code):

```bash
notion --mcp
```

Configure in Claude Code (`settings.json`):
```json
{
  "mcpServers": {
    "notion": {
      "command": "notion",
      "args": ["--mcp"],
      "env": { "NOTION_TOKEN": "ntn_your_token" }
    }
  }
}
```

Exposes 14 tools: `search`, `page_get`, `page_create`, `page_update`, `db_query`, `db_schema`, `block_children`, `block_append`, `find`, `batch`, `inspect_workspace`, `comment_create`, `validate_health`, `dedup`.

---

## 🎯 Command Reference

| Category | Commands |
|----------|----------|
| **Search** | `search` |
| **Pages** | `page get`, `page create`, `page update`, `page archive`, `page read`, `page write`, `page edit`, `page property` |
| **Databases** | `db get`, `db query`, `db create`, `db update` |
| **Blocks** | `block get`, `block list`, `block append`, `block update`, `block delete` |
| **Comments** | `comment list`, `comment create`, `comment get` |
| **Files** | `file upload`, `file import`, `file attach`, `file list`, `file get` |
| **Users** | `user me`, `user list`, `user get`, `user resolve-guests` |
| **Export** | `export page`, `export db` |
| **Import** | `import obsidian`, `import csv`, `import markdown` |
| **AI** | `ai summarize`, `ai extract`, `ai prompt`, `ai suggest` |
| **Find** | `find` |
| **Bulk** | `bulk update`, `bulk archive` |
| **Validate** | `validate check`, `validate lint`, `validate health` |
| **Stats** | `stats overview`, `stats timeline` |
| **Backup** | `backup` |
| **Templates** | `template list`, `template save`, `template use`, `template show`, `template delete` |
| **Duplicate** | `duplicate page`, `duplicate schema`, `duplicate db` |
| **Relations** | `relations backlinks`, `relations link`, `relations unlink`, `relations graph` |
| **Inspect** | `inspect workspace`, `inspect schema`, `inspect context` |
| **Dedup** | `dedup` |
| **Batch** | `batch` |
| **Quickstart** | `quickstart` |
| **API** | `api` |

---

## 📦 Agent Skills

The [`skills/`](./skills/) directory contains [AgentSkills](https://agentskills.dev)-compatible packages for use with OpenClaw, Claude Code, Cursor, and other agent frameworks.

### Structure

```
skills/
├── README.md                               # Installation & overview
├── notion-onboarding/
│   ├── SKILL.md                            # Workspace discovery workflow
│   └── references/
│       └── state-schema.md                 # ~/.config/notion/workspace.json schema
└── notion-cli-agent/
    ├── SKILL.md                            # Core CLI usage
    └── references/
        ├── filters.md                      # Property types × filter operators
        ├── batch-patterns.md               # Multi-op batch patterns
        └── workflows.md                    # Agent workflow recipes
```

### Progressive disclosure

Skills load in three layers to keep context usage efficient:

| Layer | Content | When loaded |
|-------|---------|-------------|
| Metadata | `name` + `description` | Always — triggers the skill |
| Core | `SKILL.md` body | When skill activates |
| Reference | `references/*.md` | On demand, as needed |

The main `SKILL.md` for each skill is kept under 150 lines. Deep reference material lives in separate files that the agent reads only when that topic comes up.

### Installation

```bash
# OpenClaw
cp -r skills/notion-cli-agent ~/.local/share/openclaw/skills/
cp -r skills/notion-onboarding ~/.local/share/openclaw/skills/

# See skills/README.md for other frameworks
```

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you would like to change.

### Releasing

The version in `package.json`, the `CHANGELOG.md` entry, the git tag, and the GitHub release are all cut before publishing. To publish a tagged version to npm:

```bash
git checkout main && git pull
git describe --tags --exact-match          # confirm you're on the release tag
npm publish                                # prepublishOnly runs the build
```

`files` in `package.json` limits the tarball to `dist/`, `README.md`, and `LICENSE` — `npm pack --dry-run` shows exactly what ships. Run `pnpm test` before publishing; there is no CI gate on publish.

---

## 📄 License

MIT © [Balneario de Cofrentes](https://balneario.com) - The largest longevity clinic in the world.

---

## 🙏 Acknowledgments

Built with:
- [Commander.js](https://github.com/tj/commander.js) — CLI framework
- [Notion API](https://developers.notion.com/) — Official Notion API
