# Database workflows

Use these patterns when the task is primarily about database structure, filters, entry creation, or bulk changes.

## Start with schema

```bash
notion inspect workspace
notion inspect schema <db_id> --llm
notion inspect context <db_id> --examples 5
```

Use `inspect context` before generating commands for an unfamiliar database. It includes schema, select/status options, and sample entries.

## Query patterns

```bash
notion db query <db_id> --limit 20
notion db query <db_id> --sort "Created" --sort-dir desc --limit 10
notion db query <db_id> \
  --filter-prop "Status" \
  --filter-type equals \
  --filter-value "Done" \
  --filter-prop-type status
notion db query <db_id> \
  --filter-prop "Due Date" \
  --filter-type before \
  --filter-value "2026-03-10" \
  --filter-prop-type date
```

## Natural-language querying

```bash
notion find "overdue tasks" -d <db_id>
notion find "in progress unassigned" -d <db_id>
notion find "urgent pending" -d <db_id> --llm
notion find "tareas vencidas" -d <db_id> --explain
```

`find` is good for common status, assignee, due-date, and priority patterns. Use `--explain` if you need to see the generated filter before executing.

## Entry creation and updates

```bash
notion page create --parent <db_id> --title "New Entry"
notion page create --parent <db_id> --title "Bug Fix" \
  --prop "Status=Todo" \
  --prop "Priority=High"

notion page update <page_id> --prop "Status=Done"
notion page update <page_id> --prop "Due Date=2026-03-15"
```

Inspect schema before writing properties whose values must match exact select or status options.

## Bulk changes

```bash
notion bulk update <db_id> --where "Status=Todo" --set "Status=In Progress" --dry-run
notion bulk update <db_id> --where "Priority=High,Status=Todo" --set "Owner=a@b.com" --dry-run
notion bulk archive <db_id> --where "Status=Done" --dry-run
```

Always dry-run first. Bulk commands query matching pages, preview the change, and then require `--yes` to apply.
