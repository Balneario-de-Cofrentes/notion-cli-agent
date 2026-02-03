/**
 * Reusable test fixtures matching Notion API response shapes
 */

export const mockUser = {
  object: 'user',
  id: 'user-123',
  type: 'person',
  name: 'Test User',
  avatar_url: 'https://example.com/avatar.jpg',
  person: {
    email: 'test@example.com',
  },
};

export const mockPage = {
  object: 'page',
  id: 'page-123',
  created_time: '2024-01-01T00:00:00.000Z',
  last_edited_time: '2024-01-02T00:00:00.000Z',
  created_by: mockUser,
  last_edited_by: mockUser,
  archived: false,
  parent: {
    type: 'database_id',
    database_id: 'db-123',
  },
  properties: {
    Name: {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: 'Test Page', link: null },
          plain_text: 'Test Page',
        },
      ],
    },
    Status: {
      id: 'status',
      type: 'status',
      status: { name: 'In Progress', color: 'blue' },
    },
    Tags: {
      id: 'tags',
      type: 'multi_select',
      multi_select: [
        { name: 'important', color: 'red' },
        { name: 'urgent', color: 'orange' },
      ],
    },
  },
  url: 'https://notion.so/page-123',
};

export const mockDatabase = {
  object: 'database',
  id: 'db-123',
  created_time: '2024-01-01T00:00:00.000Z',
  last_edited_time: '2024-01-02T00:00:00.000Z',
  title: [
    {
      type: 'text',
      text: { content: 'Test Database', link: null },
      plain_text: 'Test Database',
    },
  ],
  properties: {
    Name: {
      id: 'title',
      type: 'title',
      title: {},
    },
    Status: {
      id: 'status',
      type: 'status',
      status: {
        options: [
          { name: 'Not started', color: 'gray' },
          { name: 'In Progress', color: 'blue' },
          { name: 'Done', color: 'green' },
        ],
      },
    },
    Priority: {
      id: 'priority',
      type: 'select',
      select: {
        options: [
          { name: 'Low', color: 'gray' },
          { name: 'Medium', color: 'yellow' },
          { name: 'High', color: 'red' },
        ],
      },
    },
    Tags: {
      id: 'tags',
      type: 'multi_select',
      multi_select: {
        options: [
          { name: 'bug', color: 'red' },
          { name: 'feature', color: 'blue' },
        ],
      },
    },
    Assignee: {
      id: 'assignee',
      type: 'people',
      people: {},
    },
    'Due Date': {
      id: 'due',
      type: 'date',
      date: {},
    },
  },
  url: 'https://notion.so/db-123',
};

export const mockBlock = {
  object: 'block',
  id: 'block-123',
  created_time: '2024-01-01T00:00:00.000Z',
  last_edited_time: '2024-01-02T00:00:00.000Z',
  type: 'paragraph',
  paragraph: {
    rich_text: [
      {
        type: 'text',
        text: { content: 'This is a test paragraph.', link: null },
        plain_text: 'This is a test paragraph.',
      },
    ],
    color: 'default',
  },
  has_children: false,
};

export const mockHeadingBlock = {
  object: 'block',
  id: 'block-h1',
  type: 'heading_1',
  heading_1: {
    rich_text: [
      {
        type: 'text',
        text: { content: 'Test Heading', link: null },
        plain_text: 'Test Heading',
      },
    ],
    color: 'default',
  },
  has_children: false,
};

export const mockCodeBlock = {
  object: 'block',
  id: 'block-code',
  type: 'code',
  code: {
    rich_text: [
      {
        type: 'text',
        text: { content: 'console.log("hello");', link: null },
        plain_text: 'console.log("hello");',
      },
    ],
    language: 'javascript',
  },
  has_children: false,
};

export const mockComment = {
  object: 'comment',
  id: 'comment-123',
  created_time: '2024-01-01T00:00:00.000Z',
  last_edited_time: '2024-01-02T00:00:00.000Z',
  created_by: mockUser,
  parent: {
    type: 'page_id',
    page_id: 'page-123',
  },
  discussion_id: 'disc-123',
  rich_text: [
    {
      type: 'text',
      text: { content: 'This is a test comment.', link: null },
      plain_text: 'This is a test comment.',
    },
  ],
};

export const mockSearchResult = {
  object: 'list',
  results: [mockPage, mockDatabase],
  next_cursor: null,
  has_more: false,
  type: 'page_or_database',
};

export const mockQueryResult = {
  object: 'list',
  results: [mockPage],
  next_cursor: 'cursor-abc',
  has_more: true,
  type: 'page',
};

export const mockBlockChildren = {
  object: 'list',
  results: [mockBlock, mockHeadingBlock, mockCodeBlock],
  next_cursor: null,
  has_more: false,
  type: 'block',
};

export const mockUserList = {
  object: 'list',
  results: [mockUser],
  next_cursor: null,
  has_more: false,
  type: 'user',
};

export const mockCommentList = {
  object: 'list',
  results: [mockComment],
  next_cursor: null,
  has_more: false,
  type: 'comment',
};

/**
 * Helper to create paginated results
 */
export function createPaginatedResult<T>(
  items: T[],
  cursor: string | null = null,
  hasMore = false
) {
  return {
    object: 'list',
    results: items,
    next_cursor: cursor,
    has_more: hasMore,
  };
}

/**
 * Helper to create a minimal page
 */
export function createMockPage(id: string, title: string, properties: any = {}) {
  return {
    ...mockPage,
    id,
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [
          {
            type: 'text',
            text: { content: title, link: null },
            plain_text: title,
          },
        ],
      },
      ...properties,
    },
  };
}

/**
 * Helper to create a minimal database
 */
export function createMockDatabase(id: string, title: string, properties: any = {}) {
  return {
    ...mockDatabase,
    id,
    title: [
      {
        type: 'text',
        text: { content: title, link: null },
        plain_text: title,
      },
    ],
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: {},
      },
      ...properties,
    },
  };
}
