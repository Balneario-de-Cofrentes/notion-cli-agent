# Content workflows

Use these patterns when the task is about page bodies, Markdown conversion, block edits, or comments.

## Read page content

```bash
notion page get <page_id> --content
notion page read <page_id>
notion page read <page_id> --output ./page.md
notion block list <page_id>
```

Use `page read` when you want Markdown. Use `block list` or `page get --content --json` when block IDs matter.

## Write Markdown

```bash
notion page write <page_id> --file ./notes.md
printf '# Heading\n\nBody text\n' | notion page write <page_id>
notion page write <page_id> --file ./replacement.md --replace
```

`--replace` deletes existing blocks before writing new ones. Treat it as destructive.

## Surgical edits

```bash
notion page edit <page_id> --at 5 --delete 1 --markdown "## Replacement section"
notion page edit <page_id> --after <block_id> --markdown "- Added item"
notion page edit <page_id> --at 0 --delete 0 --file ./insert.md
```

Use `page edit` when you know the target block position or block ID and do not want to rewrite the whole page.

## Direct block operations

```bash
notion block append <page_id> --text "Plain paragraph"
notion block append <page_id> --heading2 "Status" --bullet "Item 1" --bullet "Item 2"
notion block append <page_id> --todo "**Review** PR"
notion block update <block_id> --text "Updated line"
notion block delete <block_id>
```

Inline Markdown such as `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[link](https://...)` is parsed into Notion rich text for appended block text.

## Comments

```bash
notion comment list <page_id>
notion comment create --page <page_id> --text "Please review this section."
notion comment create --discussion <discussion_id> --text "Reply in thread."
```
