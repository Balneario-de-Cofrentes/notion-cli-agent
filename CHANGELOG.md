# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.21.0] - 2026-07-26

### Added

- **File uploads** — full support for Notion's File Upload API (`POST /v1/file_uploads` → `/send` → `/complete`). Files ≤20 MB upload in a single part; larger files are split into 10 MB parts and completed automatically. Every flag below takes a `<source>` that can be a **local path**, a **public URL** (imported server-side via `mode: external_url`, polled until ready), or an existing **`file_upload` ID**.
- **`file` command** — `file upload <path...>` (prints the upload ID), `file import <url>`, `file attach <page_id> <source...>` (upload + append in one call, block type detected from the file, `--as` to force it), `file list`, `file get`.
- **`block append --image/--file/--pdf/--video/--audio`** — attach media while adding content, with `--caption`.
- **`page create|update --cover <source>`** and **`--icon <emoji|source>`** — `--icon` still accepts an emoji; a path, URL, or upload ID is uploaded instead.
- **`page create|update --attach "Prop=a.pdf,b.png"`** — set a `files` property; the property name is resolved against the database schema and rejected if it isn't a `files` property.
- **`comment create --attach <source...>`** — attach up to 3 files to a comment.
- **MCP tools `file_upload` and `file_attach`**, plus an `attachments` param on `comment_create`.
- **`file import` derives a filename extension from `--content-type`** — Notion rejects URL imports whose filename has no extension, which is common for CDN URLs ending in a bare id. When neither the URL nor `--name` provides one, the CLI fails with an actionable message instead of Notion's opaque 400.

## [0.20.0] - 2026-06-27

### Added

- **Guest resolution** — Notion's `GET /v1/users` never returns guest users (only members and bots), so guests can't be listed or assigned by id. New `notion user resolve-guests` discovers guests by walking search results, reading each page's `created_by`/`last_edited_by`, resolving the unknown ids via `GET /v1/users/{id}`, and caching the `type: person` non-members in `~/.config/notion/guests.json` (`{ guests: [{id,name,email}], updatedAt }`, merged/deduped on each run). `notion sync` fishes guests as a side effect too.
- **`user list` merges cached guests** — guests are shown flagged `[guest]` alongside members (and under a `guests` array in `--json`), deduped against any guest already returned by the live list.
- **People assignment by email or name** — `--prop "Field:people=VALUE"` (page create/update, bulk) now resolves a non-UUID value to a user id: members (live list) + guests (cache), exact email first then case-insensitive name. UUIDs and unresolvable values pass through unchanged. Example: `--prop "Quién revisa:people=sergioangel@balneario.com"`.

### Fixed

- **Database alias resolution** — `db query` (and every command sharing `resolveDatabaseInput`: find, stats, dedup, export, etc.) now resolves the short aliases shown by `notion list` (`tasks` → Tareas, `projects` → Proyectos, `goals` → Objetivos, …). An exact alias match (the `databases`/`custom` map key) is now checked *before* title/substring matching, so `tasks` no longer errors "No database found" and `projects` no longer collides ambiguously with DBs titled "Projects [...]".
- **Short / undashed page ids** — `page get` now normalizes a 32-hex (no-dashes) id into a dashed UUID, and emits a clear "pass the full UUID" message for a truncated short id (e.g. `4c485397`) instead of Notion's cryptic `path.page_id should be a valid uuid` 400.

## [0.19.0] - 2026-04-08

### Added

- **`page edit --find/--replace-text`** — search-and-replace within a page via native markdown API. Single PATCH call, no block position calculations. `--replace-all` replaces all occurrences. (#52)
- **`comment create --markdown`** — create comments with markdown formatting (`**bold**`, `[links](url)`, etc.). MCP `comment_create` also accepts `markdown` boolean param. (#54)

### Changed

- **`export page` and `export database --content`** — use native markdown API (`GET /pages/:id/markdown`) instead of recursive block fetching. Eliminates `blocksToMarkdownAsync` for exports. (#53)
- **`backup --format markdown`** — uses native markdown API per page; `--content` flag required (same as JSON format). Eliminates `fetchBlocksRecursive` + `blocksToMarkdownSync` for markdown backups. (#53)

## [0.18.0] - 2026-04-08

### Changed

- **`page write --replace`** — uses native markdown replace API (`PATCH /pages/:id/markdown`) instead of fetching all blocks, deleting individually, and re-inserting. Single API call. (#56)
- **`page create --markdown`** — passes `markdown` field directly in the create body instead of converting to blocks client-side. (#56)
- **`import markdown --replace`** — uses native markdown replace API instead of block-level delete + append. (#56)
- **`import obsidian --content`** — passes markdown body directly via `markdown` field in page create, no chunked block appends. (#56)

## [0.17.0] - 2026-04-08

### Changed

- **`page read` uses native Notion markdown API** — single API call instead of recursive block fetching + client-side conversion. Better fidelity (columns, synced blocks, callouts, meeting notes). `--blocks` flag for legacy behavior. (#50)
- **MCP `page_get` tool** — new `markdown: true` parameter for token-efficient page content retrieval.

## [0.16.0] - 2026-04-07

### Added

- **`notion sync`** — cache all accessible databases locally for name-based lookups. (#44)
- **`notion list`** — show cached databases (no API call). `--json`, `--ids-only` supported. (#44)
- **`notion doctor`** — diagnostics command: checks token, API connectivity, workspace access, versions. `--json` supported. (#43)
- **Database lookup by name** — all database commands accept names instead of UUIDs. Resolution: workspace.json (curated > registry) with exact, case-insensitive, and substring matching. (#44)

## [0.14.0] - 2026-04-06

### Added

- **`notion --mcp`** — MCP server mode over stdio. Exposes 14 tools (search, page CRUD, db query, blocks, find, batch, inspect, validate, dedup, comments) as MCP tools for agent frameworks like Claude Code, Cursor, and VS Code. Uses [`mcp-stdio`](https://github.com/Balneario-de-Cofrentes/mcp-stdio) (zero-dep). (#34)

## [0.13.0] - 2026-04-06

### Added

- **`notion dedup <db_id>`** — find and clean duplicate pages in a database. Exact and fuzzy title matching. Strategies: `keep-largest`, `keep-newest`, `keep-oldest`. Supports `--fix`, `--dry-run`, `--yes`, `--json`, `--llm`. (#39)

## [0.12.0] - 2026-04-06

### Added

- **`--csv`** flag on `db query` and `find` — RFC 4180 CSV output with headers, proper escaping.
- **`--tsv`** flag on `db query` and `find` — tab-separated output for spreadsheet pasting.
- **`--ids-only`** flag on `db query`, `search`, and `find` — one ID per line for Unix piping.

## [0.11.1] - 2026-04-04

### Fixed

- **Schema-aware property types in `page create` and `page update`** — `--prop "Status=In Progress"` no longer fails when the property is a `status` type. The CLI now fetches the database schema to resolve ambiguous types (status vs select) instead of guessing from the value format. Type hints (`Status:status=Done`) still take precedence. (#31)
- **Multiple `--filter` flags with AND logic** — passing multiple `--filter` flags to `db query` now correctly combines them with AND logic instead of silently dropping all but the last one. (#32)

### Security

- Bumped `picomatch` 4.0.3 to 4.0.4 via Dependabot. (#30)

### Docs

- README: added missing `page read`, `page write`, `page edit`, `page property`, and `quickstart` commands to usage guide and command reference table.

## [0.11.0] - 2026-03-22

### Changed

- **Notion API version upgraded from `2025-09-03` to `2026-03-11`** — no user-facing changes.
- Archive/trash operations now use `in_trash` field (was `archived`).
- Block append positioning now uses `position: { after_block: id }` (was `after: id`).
- Both changes centralized via `buildTrashPayload()` and `buildBlockPosition()` helpers.

## [0.10.0] - 2026-03-21

### Added

- **`page update --clear-prop`** — type-aware property clearing. Generates correct empty payloads per property type (empty array for people/relation/multi_select, null for date/select/number, rejects status/title).
- **`search --first`** — return one result or exit 1, for deterministic agent lookups.
- **`search --db <id>`** — post-filter search results to pages in a specific database.
- **`search --exact`** — case-insensitive exact title match filter.
- **`search --llm`** — compact output: `[type] id title`.
- **`db query --title <value>`** — auto-detects title property from schema and builds exact title filter.
- **`db query --llm`** — compact output: `id title`.
- **`resolvePropertyName()`** — case-insensitive, whitespace-tolerant property name matching, used by `--clear-prop`. Available as a shared helper for future use by other commands.

## [0.9.1] - 2026-03-21

### Fixed

- `import obsidian --content` no longer truncates notes at 100 blocks — appends remaining blocks in chunks.
- `validate health` now scores all entries (was sampling first 100) and handles empty databases without NaN.
- `validate lint` duplicate title detection now checks all entries (was first page only).
- `page get --content` now fetches all blocks (was first page of children only).
- `import obsidian` now warns about unsupported property types instead of silently skipping. Added `phone_number` support.
- No more false "skipped title" warning on Obsidian import with `title` in frontmatter.

## [0.9.0] - 2026-03-21

### Added

- **`--prop` type hint syntax** — `--prop "Key:type=Value"` forces a specific property type (e.g., `--prop "Status:status=Done"`). Solves the status-vs-select ambiguity without requiring schema lookups.

### Changed

- **Notion API version upgraded from `2022-06-28` to `2025-09-03`** — all database operations now route through `/v1/data_sources/` endpoints natively. No user-facing changes; the CLI abstracts the API version entirely.
- Database resolver simplified by 72 lines (-23%) — removed legacy try-first fallback and version override hack.
- Search filter `--type database` now maps to the API's `data_source` object type transparently.
- `getPropertyValue()` now handles formula, rollup, relation, files, and people types (previously returned null).
- Consolidated 3 duplicate property extraction functions into shared helpers.

### Fixed

- `parseFilter` now correctly handles `is_empty` and `is_not_empty` operators — sends `{ is_empty: true }` instead of `{ is_empty: "<value>" }`. Also fixes valueless date operators (`past_week`, `next_month`, etc.).
- `parent.type` checks now handle v2025-09-03 `data_source_id` parent type alongside legacy `database_id`.
- Relation property reads now check `data_source_id` alongside `database_id`.
- `isMultiDataSource` now correctly checks for >1 data sources (was >0).
- Template `--name` sanitized to prevent path traversal.
- Batch skill docs corrected to show proper Notion API property format.
- README: removed incorrect "bidirectional sync" claim for Obsidian integration.
- Skills: fixed hardcoded binary path, updated `--llm` flag list.

## [0.8.2] - 2026-03-21

### Fixed

- `--version` flag now returns the actual package version instead of hardcoded `0.4.2` (#23)

## [0.8.1] - 2026-03-21

### Security

- Pinned `flatted` >= 3.4.2 via `pnpm.overrides` to fix 2 high-severity advisories (unbounded recursion DoS + prototype pollution via `parse()`, via eslint > flat-cache)

### Changed

- Updated `vitest` 2.1.9 -> 4.1.0
- Updated `@types/node` 22.19.8 -> 22.19.15
- `pnpm audit`: 0 vulnerabilities

## [0.8.0] - 2026-03-21

### Added

- **Multi-data-source database support** — Databases with multiple data sources (merged databases) now work transparently. The new `database-resolver.ts` auto-detects multi-DS databases and routes requests to `/v1/data_sources/` instead of failing with a 400 error.
- **`--data-source-id` global option** — Bypass auto-detection by specifying the data source ID explicitly on any command.
- **`queryAllPages()` helper** — Paginated fetch with filter/sort/limit/onProgress, replacing 5 duplicate pagination loops across commands.
- **`withErrorHandler()` utility** — Eliminates 37 identical try/catch blocks across 19 command files.

### Changed

- All 37 hardcoded `databases/${id}` call-sites migrated to resolver helpers (`getDatabaseSchema()`, `queryDatabase()`, `updateDatabase()`). Future API version migration only requires changes to `database-resolver.ts`.
- `inspect workspace` now shows `[multi-source]` tag and data source IDs for multi-DS databases, with graceful handling when properties are unavailable.
- Inline `PaginatedResponse` type casts replaced with canonical `PaginatedResponse<T>` from `types/notion.ts`.
- `export database` now uses `queryAllPages()` instead of its own cursor loop.

### Fixed

- `db query` now preserves multiple repeated filter groups passed via `--filter-prop` / `--filter-type` / `--filter-value` / `--filter-prop-type` instead of silently keeping only the last one. Multiple groups are sent as Notion compound filters (`{ and: [...] }`), and mismatched flag counts now fail with a clear error.
- `--filter-prop-type` count is now validated against `--filter-prop` count to prevent silent positional shift.
- Notion onboarding skill description YAML frontmatter fixed.

## [0.7.0] - 2026-03-10

## [0.6.0] - 2026-03-07

### Added

- **`pages read`** — Export any Notion page as Markdown to stdout or a file. Supports `--json` for raw block output, `--no-title` to omit the heading, and `-o <path>` to write to a file directly. Handles recursive child blocks.
- **`pages write`** — Write Markdown content into a Notion page from a file or stdin. Default behaviour is append; `--replace` removes all existing blocks first (DESTRUCTIVE — warns before executing). Chunks at 100 blocks respecting the Notion API limit.
- **`pages edit`** — Surgical block-level editing: delete, insert, or replace blocks at a specific index (`--at`) or after a block ID (`--after`). Supports `--delete <count>`, `--file`, and `--markdown`. Includes `--dry-run` to preview the edit plan.

### Changed

- **Shared utilities** — Extracted duplicated code from 15 command files into three new shared modules:
  - `src/types/notion.ts` — Centralised Notion API types (`Block`, `Page`, `Database`, `RichText`, etc.)
  - `src/utils/markdown.ts` — Bidirectional Markdown ↔ Notion block conversion with full inline formatting support (bold, italic, code, strikethrough, links)
  - `src/utils/notion-helpers.ts` — Shared helpers (`fetchAllBlocks`, `blocksToMarkdownAsync`, `getPageTitle`, `getDbTitle`, `getPropertyValue`)
- **Inline formatting in block commands** — `blocks create` and similar commands now produce proper Notion rich_text annotations when input contains Markdown formatting (e.g. `**bold** text`).
- **Backup Markdown output** — `backup` now renders rich_text annotations (bold, italic, code, links) instead of plain text.
- **`page write --replace` safety** — Warns with block count before deleting, surfaces partial-deletion errors with block IDs, and reports write progress on failure.
- **`page edit` atomicity warning** — Deletion loop now warns that the operation is not atomic; partial failure will leave the page in an intermediate state.

### Fixed

- Committed `dist/` artefacts removed from the repository (were incorrectly tracked despite `.gitignore`).
- `backup.ts` no longer crashes when `created_time` or `last_edited_time` is missing from a page response.

### Security

- Pinned transitive devDependency versions via `pnpm.overrides` to resolve 5 Dependabot alerts:
  - `minimatch` ≥ 3.1.4 — ReDoS via nested extglobs and repeated wildcards (3 CVEs, via eslint)
  - `rollup` ≥ 4.59.0 — Arbitrary file write via path traversal (via vitest/vite)
  - `ajv` ≥ 6.14.0 — ReDoS when using `$data` option (via eslint)
  - All affected packages are devDependencies with no runtime exposure.

---

## [0.5.0] - 2026-02-17

### Added

- **Rate limiting and retry** — API client enforces 3 req/s and auto-retries on 429/5xx with exponential backoff. Respects `Retry-After`. Configurable via `maxRetries` and `requestsPerSecond`.
- **Parallel batch operations** — `batch` now runs in parallel (default concurrency 3). New flags: `--concurrency <n>`, `--sequential`. Per-operation timing in `--llm` output.
- **Duplicate detection** — `validate lint` detects duplicate page titles in databases.
- **Health recommendations** — `validate health` outputs actionable recommendations.

### Changed

- **Weighted validation scoring** — `validate check` uses weighted health scoring: fill rate 30%, errors 30%, warnings 20%, timeliness 20%.

### Fixed

- `find` date pattern matching — specific patterns (`modified today`, `created today`) now matched before generic fallbacks; fixes operator precedence in Spanish patterns.

---

## [0.4.3] - 2026-02-17

Initial public release.
