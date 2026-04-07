---
name: notion-cli-agent
description: Use the local Notion CLI (notion-cli-agent) to query, create, update, and manage Notion pages and databases via shell. Use when interacting with Notion workspaces, querying databases, creating or updating pages, managing tasks, reading content blocks, or running bulk/batch operations on Notion data. Prefer over Notion MCP or API calls.
---

# notion-cli-agent

Local CLI for full Notion access.

## Binary

```bash
notion <args>   # globally installed via npm
```

Auth: `NOTION_TOKEN` env var, or `~/.config/notion/api_key`.

## Workspace sync (do this first)

```bash
notion sync                  # cache all databases locally
notion list                  # show cached databases
notion list --json           # for parsing
```

After sync, use database names instead of UUIDs in ALL commands:
```bash
notion db query "Tasks" --limit 5 --llm
notion find "Tasks" "overdue" --llm
notion stats overview "Projects"
```

If `~/.config/notion/workspace.json` exists (from `sync` or the **notion-onboarding** skill), names resolve automatically. Falls back to UUIDs if no cache.

## Agent Workflow

1. **Sync workspace** — `notion sync` (once per session, or `notion list` if already synced)
2. **Understand schema** — `notion inspect context "Tasks"` or `notion inspect schema "Tasks" --llm`
3. **Query deterministically first** — prefer `db query --title`, `search --exact --db --first`, or `--llm` over fuzzy workspace-wide search when you know the target DB
4. **Write** with `--dry-run` first on bulk/batch ops, then confirm with user

## Core Commands

### Discover
```bash
notion sync                                     # cache databases for name lookup
notion list                                     # show cached databases
notion inspect ws --compact                     # all databases, names + ids
notion inspect schema "Tasks" --llm             # property types + valid values
notion inspect context "Tasks"                  # workflow context + examples
notion ai prompt "Tasks"                        # DB-specific agent instructions
```

### Query
```bash
# Exact lookup in a known DB (deterministic — uses database query API)
notion db query "Tasks" --title "Known Page" --json
notion db query "Tasks" --limit 20 --llm                   # compact output

# Fuzzy search (workspace-wide, best-effort — Notion may miss long titles)
notion search "keyword" --limit 10
notion search "keyword" --db <db_id> --llm                 # filter by parent DB
notion search "short title" --exact --first --json         # best-effort exact match

# Natural language
notion find "overdue tasks unassigned" -d <db_id> --llm
notion find "high priority" -d <db_id> --explain           # preview filter, don't run
```

**For exact lookup by title in a known DB, always use `db query --title` — not `search --exact`.** Notion's search API is fuzzy and may miss pages with long or common-word titles.

### Read pages
```bash
notion page get <page_id>                       # properties
notion page get <page_id> --content             # + content blocks
notion page get <page_id> --json                # raw JSON
notion page read <page_id>                      # content as Markdown
notion page read <page_id> -o page.md           # save to file
notion ai summarize <page_id>                   # concise summary
notion ai extract <page_id> --schema "email,phone,date"
```

### Write pages
```bash
notion page create --parent <db_id> --title "Task Name"
notion page create --parent <db_id> --title "Task" --prop "Status:status=Todo" --prop "Priority:select=High"
notion page update <page_id> --prop "Status:status=Done"
notion page update <page_id> --clear-prop "Assignee"       # type-aware clear
notion page update <page_id> --clear-prop "Tags" --clear-prop "Deadline"
notion page write <page_id> -f content.md                  # write Markdown to page
notion page write <page_id> -f doc.md --replace            # replace all content
notion page edit <page_id> --at 3 --delete 2               # surgical block editing
notion page edit <page_id> --at 5 --markdown "New text"    # insert at position
```

### Add blocks
```bash
notion block append <page_id> --text "Paragraph"
notion block append <page_id> --heading2 "Section" --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --todo "Action item"
```

### Batch (minimize tool calls)
```bash
notion batch --dry-run --data '[
  {"op":"get","type":"page","id":"<page_id>"},
  {"op":"create","type":"page","parent":"<db_id>","data":{"title":"New"}},
  {"op":"update","type":"page","id":"<page_id2>","data":{"Status":"Done"}}
]'
notion batch --llm --data '[...]'               # execute
```

### Bulk & maintenance
```bash
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
notion stats overview <db_id>
notion validate check <db_id> --check-dates --check-stale 30
notion dedup <db_id>                                       # find duplicate pages
notion dedup <db_id> --fuzzy                               # include near-duplicates
notion dedup <db_id> --fix --strategy keep-largest --yes   # archive duplicates
```

## Output flags

| Flag | Use for |
|------|---------|
| `--llm` | Compact, structured output for agents (`search`, `db query`, `find`, `batch`, `inspect schema/context`, `stats overview`, `relations backlinks`) |
| `--json` / `-j` | Raw JSON for parsing |
| `--csv` | CSV with headers (`db query`, `find`) |
| `--tsv` | Tab-separated (`db query`, `find`) |
| `--ids-only` | One ID per line for piping (`db query`, `search`, `find`) |
| (default) | Human-readable |

## Property type filters

`--filter-prop-type` is required for non-text properties:

```bash
notion db query <db_id> \
  --filter-prop "Status" --filter-type equals \
  --filter-value "Done" --filter-prop-type status
```

Types: `status` · `select` · `multi_select` · `number` · `date` · `checkbox` · `people` · `relation`

See `references/filters.md` for full operator reference.

## Property type hints for --prop

Auto-detection treats plain strings as `select`. Use `Key:type=Value` to force a type:

```bash
notion page update <id> --prop "Status:status=Done"    # status, not select
notion page update <id> --prop "Notes:rich_text=Text"   # rich_text, not select
notion page update <id> --prop "Owner:people=<user_id>" # people
```

## Rules

- Property values are usually **case-sensitive** — verify exact status/select values with `inspect context`
- Property names are matched more flexibly in `0.10.0` (`resolvePropertyName()` is case-insensitive and whitespace-tolerant), but still prefer the real schema labels for reliability
- Title property name varies per DB (`"Name"`, `"Título"`, `"Task"` — check state or schema)
- Prefer `db query --title "..."` or `search --db <id> --exact --first` when you know the DB; avoid fuzzy `search` for operational updates
- Use `--clear-prop` instead of fake empty values like `Owner:people=` or `Tags=`
- `--dry-run` before any bulk/batch write
- Confirm with user before destructive bulk operations

## References

- `references/filters.md` — all property types × filter operators with examples
- `references/batch-patterns.md` — batch workflows (multi-update, bulk status sweep, multi-get)
- `references/workflows.md` — agent workflow recipes (task triage, weekly review, project sync)

## Self-help

```bash
notion quickstart          # full quick reference
notion <command> --help    # per-command help
notion ai suggest <db_id> "what I want to do"
```
