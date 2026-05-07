---
name: notion-onboarding
description: "First-time Notion workspace discovery — identify key databases (projects/tasks/OKRs/home page) via guided discovery and save persistent state. Run before any Notion workflow when no state exists. Triggers: 'set up Notion', 'map my workspace', 'onboard Notion', first Notion setup, or when ~/.config/notion/workspace.json is missing."
---

# Notion Workspace Onboarding

Maps the user's Notion workspace and saves a state file that all future Notion skills read.

**State file:** `~/.config/notion/workspace.json`

## Step 0 — Check existing state

```bash
cat ~/.config/notion/workspace.json 2>/dev/null
```

If it exists: show the current mapping, ask the user if they want to update it or continue. If absent: proceed with full onboarding.

## Step 1 — Verify auth & get user

```bash
notion user me
```

Confirm the integration is working. Note the workspace name.

If this returns `401 API token is invalid`, you're almost certainly hitting a stale `NOTION_TOKEN` env var inherited from the parent process — the CLI prefers env vars over `~/.config/notion/api_key`. Use the file-token workaround from the **notion-cli-agent** skill for the rest of this onboarding:

```bash
NOTION_TOKEN=$(cat ~/.config/notion/api_key) notion user me
```

If that works, apply the same `NOTION_TOKEN=$(cat ~/.config/notion/api_key)` prefix to every `notion` call in the steps below.

## Step 2 — Discover all accessible databases

```bash
notion inspect ws --compact
notion inspect ws --json
```

This lists all databases the integration can see. Present the list clearly to the user (name + ID).

## Step 3 — Guided identification

Ask the user to identify which databases correspond to each role. Be conversational — not all workspaces have all of these:

```
I found these databases in your workspace:
[list from step 2]

Can you tell me:
1. Which one is your main Tasks / To-do database? (where day-to-day work lives)
2. Which one is your Projects database? (higher-level work containers)
3. Do you have a Goals, OKRs, or Objectives database?
4. Is there a main Home or Dashboard page (not a database) I should know about?
5. Any other databases that are central to how you work? (e.g., CRM, Notes, Areas)
```

## Step 4 — Inspect each identified database

For each confirmed database, run:

```bash
notion inspect context <db_id>
notion inspect schema <db_id> --llm
```

Extract from the output:
- The exact `titleProp` name (the property of type `title`)
- The `statusProp` name and valid status values (if any)
- Key properties used for filtering (priority, assignee, due date, etc.)

## Step 5 — Build and save the state file

Write `~/.config/notion/workspace.json` following the schema in `references/state-schema.md`.

```bash
mkdir -p ~/.config/notion
# write the JSON file
```

Example minimal state:
```json
{
  "version": 1,
  "onboardedAt": "YYYY-MM-DD",
  "updatedAt": "YYYY-MM-DD",
  "workspace": { "name": "Acme" },
  "databases": {
    "tasks": {
      "id": "abc-123",
      "title": "Tasks",
      "titleProp": "Name",
      "statusProp": "Status",
      "statuses": ["Todo", "In Progress", "Done"]
    }
  }
}
```

## Step 6 — Confirm with user

Show a human-readable summary of what was saved. Ask: "Does this look right? Anything to adjust?"

Apply any corrections, save the final file.

## After onboarding

Tell the user: "Your workspace is now mapped. Any Notion task I do will use these databases by default — no need to look up IDs. Run this onboarding again anytime to update."

For full state schema see: `references/state-schema.md`
