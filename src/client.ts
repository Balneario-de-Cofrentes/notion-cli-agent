/**
 * Notion API Client
 * Low-level HTTP client for Notion API
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28'; // Stable version

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_REQUESTS_PER_SECOND = 3;
const MIN_RETRY_DELAY_MS = 500;

export interface NotionClientOptions {
  token: string;
  version?: string;
  maxRetries?: number;
  requestsPerSecond?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
}

class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;

  constructor(requestsPerSecond: number) {
    this.maxRequests = requestsPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than 1 second
    this.timestamps = this.timestamps.filter(t => now - t < 1000);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0];
      const waitMs = 1000 - (now - oldestInWindow);
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    this.timestamps.push(Date.now());
  }
}

export class NotionClient {
  private token: string;
  private version: string;
  private maxRetries: number;
  private rateLimiter: RateLimiter;

  constructor(options: NotionClientOptions) {
    this.token = options.token;
    this.version = options.version || NOTION_VERSION;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.rateLimiter = new RateLimiter(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND);
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

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.wait();

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        // Rate limited: respect Retry-After header
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter
            ? parseFloat(retryAfter) * 1000
            : MIN_RETRY_DELAY_MS * Math.pow(2, attempt);

          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
        }

        // Server errors: retry with backoff
        if (response.status >= 500 && attempt < this.maxRetries) {
          await new Promise(resolve =>
            setTimeout(resolve, MIN_RETRY_DELAY_MS * Math.pow(2, attempt))
          );
          continue;
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message = (error as { message?: string }).message || response.statusText;
          throw new Error(`Notion API Error (${response.status}): ${message}`);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error as Error;

        // Don't retry client-side errors (4xx) except 429
        if (lastError.message.includes('Notion API Error (4')) {
          throw lastError;
        }

        // Retry network errors
        if (attempt < this.maxRetries) {
          await new Promise(resolve =>
            setTimeout(resolve, MIN_RETRY_DELAY_MS * Math.pow(2, attempt))
          );
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
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
