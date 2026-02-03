/**
 * Notion API Client
 * Low-level HTTP client for Notion API
 */
export interface NotionClientOptions {
    token: string;
    version?: string;
}
export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
}
export declare class NotionClient {
    private token;
    private version;
    constructor(options: NotionClientOptions);
    request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
    get<T = unknown>(path: string, query?: RequestOptions['query']): Promise<T>;
    post<T = unknown>(path: string, body?: RequestOptions['body'], query?: RequestOptions['query']): Promise<T>;
    patch<T = unknown>(path: string, body?: RequestOptions['body']): Promise<T>;
    delete<T = unknown>(path: string): Promise<T>;
}
export declare function getClient(): NotionClient;
export declare function getTokenSync(): string;
export declare function initClient(token?: string): NotionClient;
//# sourceMappingURL=client.d.ts.map