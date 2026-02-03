/**
 * Formatting utilities for CLI output
 */

export function formatOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatPageTitle(page: unknown): string {
  const p = page as {
    properties?: Record<string, {
      type: string;
      title?: Array<{ plain_text: string }>;
    }>;
  };

  if (!p.properties) return 'Untitled';

  // Find title property
  for (const prop of Object.values(p.properties)) {
    if (prop.type === 'title' && prop.title) {
      return prop.title.map(t => t.plain_text).join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

export function formatDatabaseTitle(db: unknown): string {
  const d = db as {
    title?: Array<{ plain_text: string }>;
  };

  if (!d.title || d.title.length === 0) return 'Untitled Database';
  return d.title.map(t => t.plain_text).join('') || 'Untitled Database';
}

export function formatBlock(block: unknown): string {
  const b = block as {
    id: string;
    type: string;
    [key: string]: unknown;
  };

  const typeData = b[b.type] as {
    rich_text?: Array<{ plain_text: string }>;
    checked?: boolean;
    language?: string;
    url?: string;
    caption?: Array<{ plain_text: string }>;
  } | undefined;

  let content = '';
  
  switch (b.type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
    case 'callout':
    case 'toggle':
      content = typeData?.rich_text?.map(t => t.plain_text).join('') || '';
      break;
    case 'to_do':
      content = typeData?.rich_text?.map(t => t.plain_text).join('') || '';
      break;
    case 'code':
      const lang = typeData?.language || 'plain text';
      content = `[${lang}] ${typeData?.rich_text?.map(t => t.plain_text).join('') || ''}`;
      break;
    case 'divider':
      content = '---';
      break;
    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
      content = typeData?.url || typeData?.caption?.map(t => t.plain_text).join('') || `[${b.type}]`;
      break;
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      content = typeData?.url || `[${b.type}]`;
      break;
    default:
      content = `[${b.type}]`;
  }

  const prefix = getBlockPrefix(b.type);
  return `${prefix} ${content} (${b.id.slice(0, 8)}...)`;
}

function getBlockPrefix(type: string): string {
  const prefixes: Record<string, string> = {
    paragraph: '¶',
    heading_1: 'H1',
    heading_2: 'H2',
    heading_3: 'H3',
    bulleted_list_item: '•',
    numbered_list_item: '#',
    to_do: '☐',
    toggle: '▶',
    code: '`',
    quote: '"',
    callout: '💡',
    divider: '—',
    image: '🖼',
    video: '🎥',
    file: '📎',
    pdf: '📄',
    bookmark: '🔖',
    embed: '🔗',
    table: '📊',
    column_list: '|',
    column: '│',
    link_preview: '🔗',
    synced_block: '🔄',
    template: '📋',
    child_page: '📄',
    child_database: '🗄',
    table_of_contents: '📑',
    breadcrumb: '🍞',
    equation: '∑',
  };
  return prefixes[type] || '?';
}

export function parseProperties(props: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of props) {
    const eqIndex = prop.indexOf('=');
    if (eqIndex === -1) continue;

    const key = prop.slice(0, eqIndex);
    const value = prop.slice(eqIndex + 1);

    // Try to determine property type from value format
    if (value.startsWith('[') || value.startsWith('{')) {
      // JSON value
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = { rich_text: [{ text: { content: value } }] };
      }
    } else if (value === 'true' || value === 'false') {
      // Checkbox
      result[key] = { checkbox: value === 'true' };
    } else if (/^\d+(\.\d+)?$/.test(value)) {
      // Number
      result[key] = { number: parseFloat(value) };
    } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      // Date
      result[key] = { date: { start: value } };
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      // URL
      result[key] = { url: value };
    } else if (value.includes('@') && value.includes('.')) {
      // Email
      result[key] = { email: value };
    } else if (value.includes(',')) {
      // Multi-select
      result[key] = { multi_select: value.split(',').map(v => ({ name: v.trim() })) };
    } else {
      // Default: treat as select or rich_text
      // Try select first (single value)
      result[key] = { select: { name: value } };
    }
  }

  return result;
}

export function parseFilter(
  property: string,
  filterType: string,
  value: string,
  propType?: string
): Record<string, unknown> {
  const filter: Record<string, unknown> = { property };

  // If property type is explicitly specified, use it
  if (propType) {
    switch (propType) {
      case 'status':
        filter.status = { [filterType]: value };
        break;
      case 'select':
        filter.select = { [filterType]: value };
        break;
      case 'multi_select':
        filter.multi_select = { [filterType]: value };
        break;
      case 'text':
      case 'rich_text':
        filter.rich_text = { [filterType]: value };
        break;
      case 'number':
        filter.number = { [filterType]: parseFloat(value) };
        break;
      case 'checkbox':
        filter.checkbox = { [filterType]: value === 'true' };
        break;
      case 'date':
        filter.date = { [filterType]: value };
        break;
      default:
        filter[propType] = { [filterType]: value };
    }
    return filter;
  }

  // Auto-detect property type from value format
  if (value === 'true' || value === 'false') {
    filter.checkbox = { [filterType]: value === 'true' };
  } else if (/^\d+(\.\d+)?$/.test(value)) {
    filter.number = { [filterType]: parseFloat(value) };
  } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    filter.date = { [filterType]: value };
  } else {
    // Default to select for simple string values (most common case)
    filter.select = { [filterType]: value };
  }

  return filter;
}
