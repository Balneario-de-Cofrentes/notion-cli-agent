# notion-cli

> The most powerful command-line interface for Notion — built for humans AND AI agents.

[![npm version](https://img.shields.io/npm/v/@anthropic/notion-cli.svg)](https://www.npmjs.com/package/@anthropic/notion-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

While other Notion CLIs offer basic CRUD operations, **notion-cli** goes further with AI-native features, Obsidian integration, smart queries, bulk operations, validation, and more — everything an AI agent (or power user) needs to fully manage Notion from the terminal.

## ✨ Features

### Core Operations
- **Search** — Find pages and databases across your workspace
- **Pages** — Create, read, update, archive pages with full property support
- **Databases** — Query with filters, create schemas, manage entries
- **Blocks** — Add and manage page content (paragraphs, headings, lists, code, etc.)
- **Comments** — Read and create comments on pages
- **Users** — List workspace users and integrations

### 🤖 AI Agent Features
- **Smart Queries** — Natural language queries translated to Notion filters
- **Batch Operations** — Execute multiple operations in one command
- **Agent Prompts** — Generate optimal prompts for AI agents to work with databases
- **Summarize** — Get concise page summaries
- **Extract** — Pull structured data from page content

### 🔄 Obsidian Integration
- **Export to Obsidian** — Pages and databases with YAML frontmatter
- **Import from Obsidian** — Sync your vault to Notion
- **Bidirectional workflow** — Keep both systems in sync

### 📊 Analytics & Validation
- **Statistics** — Database metrics, breakdowns by property
- **Timeline** — Activity visualization over time
- **Health Check** — Database integrity scoring
- **Validation** — Find missing fields, overdue items, stale entries

### 🔗 Advanced Features
- **Templates** — Save and reuse page structures
- **Backup** — Full database backup to JSON/Markdown
- **Duplicate** — Clone pages and entire databases
- **Relations** — Manage links, find backlinks, visualize graphs
- **Bulk Operations** — Update or archive hundreds of entries at once

---

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/user/notion-cli.git
cd notion-cli

# Install dependencies
pnpm install

# Build
pnpm build

# Link globally (optional)
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

## 📖 Usage Guide

### Basic Commands

```bash
# Search across workspace
notion search "project plan"
notion search "meeting" --type page
notion search "" --type database    # List all databases

# Get page info
notion page get <page_id>
notion page get <page_id> --content  # Include blocks

# Create page in database
notion page create --parent <db_id> --title "New Task"
notion page create --parent <db_id> --title "Bug Fix" \
  --prop "Status=Todo" \
  --prop "Priority=High"

# Update page
notion page update <page_id> --prop "Status=Done"

# Archive page
notion page archive <page_id>
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

For database queries with non-select properties:
```bash
notion db query <db_id> \
  --filter-prop "Status" \
  --filter-type equals \
  --filter-value "Done" \
  --filter-prop-type status  # Required for status type
```

---

## 🎯 Command Reference

| Category | Commands |
|----------|----------|
| **Search** | `search` |
| **Pages** | `page get`, `page create`, `page update`, `page archive` |
| **Databases** | `db get`, `db query`, `db create`, `db update` |
| **Blocks** | `block get`, `block list`, `block append`, `block update`, `block delete` |
| **Comments** | `comment list`, `comment get`, `comment create` |
| **Users** | `user me`, `user list`, `user get` |
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
| **Batch** | `batch` |
| **API** | `api` |

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you would like to change.

---

## 📄 License

MIT © Balneario de Cofrentes

---

## 🙏 Acknowledgments

Built with:
- [Commander.js](https://github.com/tj/commander.js) — CLI framework
- [Notion API](https://developers.notion.com/) — Official Notion API
