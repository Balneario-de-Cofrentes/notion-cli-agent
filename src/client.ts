/**
 * Notion API Client
 * Low-level HTTP client for Notion API
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28'; // Stable version

export interface NotionClientOptions {
  token: string;
  version?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
}

export class NotionClient {
  private token: string;
  private version: string;

  constructor(options: NotionClientOptions) {
    this.token = options.token;
    this.version = options.version || NOTION_VERSION;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query } = options;

    let url = `${NOTION_API_BASE}/${path}`;
    
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Notion-Version': this.version,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = (error as { message?: string }).message || response.statusText;
      throw new Error(`Notion API Error (${response.status}): ${message}`);
    }

    return response.json() as Promise<T>;
  }

  // Convenience methods
  get<T = unknown>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  post<T = unknown>(path: string, body?: RequestOptions['body'], query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  patch<T = unknown>(path: string, body?: RequestOptions['body']): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

// Singleton instance management
let clientInstance: NotionClient | null = null;

export function getClient(): NotionClient {
  if (!clientInstance) {
    throw new Error('Client not initialized. Call initClient() first.');
  }
  return clientInstance;
}

export function getTokenSync(): string {
  // Priority: env var > config file
  const envToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (envToken) return envToken;

  // Try config file locations
  const configPaths = [
    path.join(os.homedir(), '.config', 'notion', 'api_key'),
    path.join(os.homedir(), '.notion', 'token'),
  ];

  for (const configPath of configPaths) {
    try {
      const token = fs.readFileSync(configPath, 'utf-8').trim();
      if (token) return token;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Notion API token not found. Set NOTION_TOKEN env var or create ~/.config/notion/api_key'
  );
}

export function initClient(token?: string): NotionClient {
  const resolvedToken = token || getTokenSync();
  clientInstance = new NotionClient({ token: resolvedToken });
  return clientInstance;
}
