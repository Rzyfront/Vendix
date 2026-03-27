export interface ConversationWithMessages {
  id: number;
  store_id: number;
  organization_id: number;
  user_id: number;
  title: string | null;
  summary: string | null;
  app_key: string | null;
  status: string;
  metadata: any;
  created_at: Date;
  updated_at: Date;
  messages: Array<{
    id: number;
    role: string;
    content: string;
    tool_calls: any;
    tokens_used: number;
    cost_usd: any;
    metadata: any;
    created_at: Date;
  }>;
}

export interface PaginatedConversations {
  data: any[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
