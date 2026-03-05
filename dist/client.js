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
class RateLimiter {
    timestamps = [];
    maxRequests;
    constructor(requestsPerSecond) {
        this.maxRequests = requestsPerSecond;
    }
    async wait() {
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
    token;
    version;
    maxRetries;
    rateLimiter;
    constructor(options) {
        this.token = options.token;
        this.version = options.version || NOTION_VERSION;
        this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.rateLimiter = new RateLimiter(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND);
    }
    async request(path, options = {}) {
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
        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Notion-Version': this.version,
            'Content-Type': 'application/json',
        };
        let lastError = null;
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
                    await new Promise(resolve => setTimeout(resolve, MIN_RETRY_DELAY_MS * Math.pow(2, attempt)));
                    continue;
                }
                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    const message = error.message || response.statusText;
                    throw new Error(`Notion API Error (${response.status}): ${message}`);
                }
                return response.json();
            }
            catch (error) {
                lastError = error;
                // Don't retry client-side errors (4xx) except 429
                if (lastError.message.includes('Notion API Error (4')) {
                    throw lastError;
                }
                // Retry network errors
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, MIN_RETRY_DELAY_MS * Math.pow(2, attempt)));
                    continue;
                }
            }
        }
        throw lastError || new Error('Request failed after retries');
    }
    // Convenience methods
    get(path, query) {
        return this.request(path, { method: 'GET', query });
    }
    post(path, body, query) {
        return this.request(path, { method: 'POST', body, query });
    }
    patch(path, body) {
        return this.request(path, { method: 'PATCH', body });
    }
    delete(path) {
        return this.request(path, { method: 'DELETE' });
    }
}
// Singleton instance management
let clientInstance = null;
export function getClient() {
    if (!clientInstance) {
        throw new Error('Client not initialized. Call initClient() first.');
    }
    return clientInstance;
}
export function getTokenSync() {
    // Priority: env var > config file
    const envToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
    if (envToken)
        return envToken;
    // Try config file locations
    const configPaths = [
        path.join(os.homedir(), '.config', 'notion', 'api_key'),
        path.join(os.homedir(), '.notion', 'token'),
    ];
    for (const configPath of configPaths) {
        try {
            const token = fs.readFileSync(configPath, 'utf-8').trim();
            if (token)
                return token;
        }
        catch {
            continue;
        }
    }
    throw new Error('Notion API token not found. Set NOTION_TOKEN env var or create ~/.config/notion/api_key');
}
export function initClient(token) {
    const resolvedToken = token || getTokenSync();
    clientInstance = new NotionClient({ token: resolvedToken });
    return clientInstance;
}
//# sourceMappingURL=client.js.map