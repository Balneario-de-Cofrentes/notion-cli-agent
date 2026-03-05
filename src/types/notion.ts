/**
 * Shared Notion API types
 *
 * Centralizes the type definitions that were previously duplicated
 * across export.ts, import.ts, backup.ts, blocks.ts, and others.
 */

// ─── Rich Text ───────────────────────────────────────────────────────────────

export interface RichTextAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
}

export interface RichTextLink {
  url: string;
}

export interface RichText {
  type: string;
  plain_text: string;
  href?: string | null;
  annotations?: RichTextAnnotations;
  text?: {
    content: string;
    link?: RichTextLink | null;
  };
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

export interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  children?: Block[];
  [key: string]: unknown;
}

export interface BlockData {
  rich_text?: RichText[];
  checked?: boolean;
  language?: string;
  url?: string;
  expression?: string;
  icon?: { type: string; emoji?: string };
  caption?: RichText[];
  type?: string;
  file?: { url: string };
  external?: { url: string };
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export interface Page {
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
  parent: { type: string; database_id?: string; page_id?: string };
}

// ─── Databases ───────────────────────────────────────────────────────────────

export interface PropertySchema {
  type: string;
  [key: string]: unknown;
}

export interface Database {
  id: string;
  title?: { plain_text: string }[];
  description?: { plain_text: string }[];
  url?: string;
  properties: Record<string, PropertySchema>;
}

// ─── Notion Block Builders ───────────────────────────────────────────────────

export interface NotionRichTextItem {
  type: 'text';
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: RichTextAnnotations;
}

export interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor?: string;
}
