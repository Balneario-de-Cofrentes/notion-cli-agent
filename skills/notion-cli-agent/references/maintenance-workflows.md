# Maintenance workflows

Use these patterns when the task is about integrity checks, backups, migrations, sync, or exports.

## Validation

```bash
notion validate check <db_id> --required "Status,Owner" --check-dates --check-stale 14 --fix
notion validate lint <db_id>
notion validate health <db_id>
```

`validate check` is best for missing required fields, overdue entries, and stale work. `--fix` prints suggested follow-up commands.

## Stats and relations

```bash
notion stats overview <db_id>
notion stats timeline <db_id> --days 30
notion relations backlinks <page_id> --llm
notion relations graph <page_id>
```

## Backup and export

```bash
notion backup <db_id> -o ./backups
notion backup <db_id> -o ./backups --format markdown --content
notion backup <db_id> -o ./backups --incremental
notion export page <page_id> --obsidian
notion export db <db_id> --vault ~/vault --folder notion-export
```

Use backup for local snapshots and export when the target format is Markdown or an Obsidian vault layout.

## Import

```bash
notion import markdown ./doc.md --to <page_id>
notion import markdown ./doc.md --to <page_id> --replace
notion import csv ./tasks.csv --to <db_id>
notion import obsidian ~/vault --to <page_id>
```

Use import commands for one-time migration or sync-style ingestion. Inspect the destination schema first when importing into databases.
