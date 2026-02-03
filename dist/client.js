/**
 * Notion API Client
 * Low-level HTTP client for Notion API
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28'; // Stable version
export class NotionClient {
    token;
    version;
    constructor(options) {
        this.token = options.token;
        this.version = options.version || NOTION_VERSION;
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
        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const message = error.message || response.statusText;
            throw new Error(`Notion API Error (${response.status}): ${message}`);
        }
        return response.json();
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