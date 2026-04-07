# Workspace State Schema

File: `~/.config/notion/workspace.json`

## Full Schema

```json
{
  "version": 1,
  "onboardedAt": "2026-03-10",
  "updatedAt": "2026-03-10",

  "workspace": {
    "name": "My Workspace"
  },

  "home": {
    "pageId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "title": "Home",
    "url": "https://notion.so/..."
  },

  "databases": {
    "tasks": {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "Tasks",
      "titleProp": "Name",
      "statusProp": "Status",
      "statuses": ["Todo", "In Progress", "Done", "Blocked"],
      "priorityProp": "Priority",
      "assigneeProp": "Assignee",
      "dueDateProp": "Due"
    },
    "projects": {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "Projects",
      "titleProp": "Name",
      "statusProp": "Status",
      "statuses": ["Not started", "In progress", "Completed", "Archived"]
    },
    "goals": {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "OKRs Q1 2026",
      "titleProp": "Objective",
      "statusProp": "Status",
      "statuses": ["On track", "At risk", "Done"]
    }
  },

  "custom": {
    "crm": {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "Contacts",
      "purpose": "CRM / client management"
    },
    "areas": {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "title": "Areas of Responsibility",
      "purpose": "Life areas / PARA system"
    }
  },

  "syncedAt": "2026-04-07T12:00:00.000Z",
  "registry": [
    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "title": "Tasks", "url": "https://notion.so/...", "syncedAt": "2026-04-07T12:00:00.000Z" },
    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "title": "Projects", "url": "https://notion.so/...", "syncedAt": "2026-04-07T12:00:00.000Z" },
    { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "title": "Contacts", "url": "https://notion.so/...", "syncedAt": "2026-04-07T12:00:00.000Z" }
  ]
}
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Schema version, currently `1` |
| `onboardedAt` | yes | ISO date of initial setup |
| `updatedAt` | yes | ISO date of last update |
| `workspace.name` | yes | Notion workspace name |
| `home` | no | Main dashboard page (not a database) |
| `databases.tasks` | recommended | Day-to-day task tracking |
| `databases.projects` | recommended | Project containers |
| `databases.goals` | no | OKRs, objectives, goals |
| `custom.*` | no | Any other key databases, keyed by short name |
| `syncedAt` | no | ISO timestamp of last `notion sync` |
| `registry` | no | Flat array of all databases (auto-populated by `notion sync`) |

## Database entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Notion database UUID |
| `title` | yes | Human display name |
| `titleProp` | yes | Exact name of the `title` type property |
| `statusProp` | no | Exact name of the status/select property |
| `statuses` | no | Valid status values (exact case) |
| `priorityProp` | no | Property name for priority |
| `assigneeProp` | no | Property name for assignee |
| `dueDateProp` | no | Property name for due date |

## Usage by agent skills

When starting any Notion task:

```bash
# Load state
STATE=$(cat ~/.config/notion/workspace.json 2>/dev/null)

# Extract task DB id (example using jq)
TASKS_DB=$(echo "$STATE" | jq -r '.databases.tasks.id')
```

Skills should gracefully handle missing state by suggesting the user run onboarding or sync first:
> "I don't have your Notion workspace mapped yet. Run `notion sync` for basic name-to-ID resolution, or run the notion-onboarding skill for full semantic mapping."

## registry vs databases/custom

- `databases` and `custom` are hand-curated by the onboarding skill with semantic metadata (statusProp, statuses, assigneeProp, etc.)
- `registry` is auto-populated by `notion sync` with just id + title + url
- Name resolution checks `databases`/`custom` first (curated), then falls back to `registry`
- Both can coexist in the same file
