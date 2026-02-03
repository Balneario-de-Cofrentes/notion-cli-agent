import { vi } from 'vitest';

interface MockResponseOptions {
  status?: number;
  data?: any;
  headers?: Record<string, string>;
  statusText?: string;
}

interface MockRoutes {
  [key: string]: MockResponseOptions;
}

/**
 * Create a mock Response object
 */
export function createMockResponse(options: MockResponseOptions = {}): Response {
  const {
    status = 200,
    data = {},
    headers = {},
    statusText = 'OK',
  } = options;

  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({
      'content-type': 'application/json',
      ...headers,
    }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    clone: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return mockResponse;
}

/**
 * Create a simple mock fetch function that returns a single response
 */
export function createMockFetch(options: MockResponseOptions = {}) {
  return vi.fn().mockResolvedValue(createMockResponse(options));
}

/**
 * Create a route-based mock fetch function
 * Routes are keyed by "METHOD path" (e.g., "POST search", "GET pages/123")
 */
export function mockNotionAPI(routes: MockRoutes) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/^\/v1\//, ''); // Remove /v1/ prefix
    const routeKey = `${method} ${path}`;

    // Try exact match first
    if (routes[routeKey]) {
      return createMockResponse(routes[routeKey]);
    }

    // Try method wildcard (e.g., "* search")
    const wildcardKey = `* ${path}`;
    if (routes[wildcardKey]) {
      return createMockResponse(routes[wildcardKey]);
    }

    // Try path wildcard (e.g., "GET *")
    const methodWildcard = `${method} *`;
    if (routes[methodWildcard]) {
      return createMockResponse(routes[methodWildcard]);
    }

    // No match found - return 404
    return createMockResponse({
      status: 404,
      statusText: 'Not Found',
      data: {
        object: 'error',
        status: 404,
        message: `No mock defined for: ${routeKey}`,
      },
    });
  });
}

/**
 * Create a mock fetch that simulates Notion API errors
 */
export function mockNotionError(status: number, message: string) {
  return createMockFetch({
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
    data: {
      object: 'error',
      status,
      code: status === 400 ? 'validation_error' : 'internal_error',
      message,
    },
  });
}

/**
 * Common Notion API error scenarios
 */
export const notionErrors = {
  badRequest: () => mockNotionError(400, 'Bad request'),
  unauthorized: () => mockNotionError(401, 'Unauthorized'),
  forbidden: () => mockNotionError(403, 'Forbidden'),
  notFound: () => mockNotionError(404, 'Resource not found'),
  rateLimited: () => mockNotionError(429, 'Rate limited'),
  serverError: () => mockNotionError(500, 'Internal server error'),
  serviceUnavailable: () => mockNotionError(503, 'Service unavailable'),
};
