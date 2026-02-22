export enum TicketPriority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
  P4 = 'P4',
}

export enum TicketStatus {
  NEW = 'NEW',
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_RESPONSE = 'WAITING_RESPONSE',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  REOPENED = 'REOPENED',
}

export enum TicketCategory {
  INCIDENT = 'INCIDENT',
  SERVICE_REQUEST = 'SERVICE_REQUEST',
  PROBLEM = 'PROBLEM',
  CHANGE = 'CHANGE',
  QUESTION = 'QUESTION',
}

export interface Ticket {
  id: number;
  ticket_number: string;
  organization_id: number;
  store_id?: number;
  organization?: {
    id: number;
    name: string;
    slug: string;
  };
  store?: {
    id: number;
    name: string;
    slug: string;
  };
  created_by_user_id: number;
  created_by?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  title: string;
  description: string;
  category?: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to_user_id?: number;
  assigned_to?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  sla_deadline?: string;
  sla_breached: boolean;
  first_response_at?: string;
  resolved_at?: string;
  closed_at?: string;
  resolution_summary?: string;
  resolution_time_minutes?: number;
  customer_satisfied?: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  attachments?: TicketAttachment[];
  comments?: TicketComment[];
  _count?: {
    comments: number;
    attachments: number;
  };
}

export interface TicketAttachment {
  id: number;
  file_name: string;
  file_key: string;
  file_url: string;
  file_size?: number;
  file_type?: string;
  mime_type?: string;
  thumbnail_url?: string;
  created_at: string;
}

export interface TicketComment {
  id: number;
  ticket_id: number;
  content: string;
  is_internal: boolean;
  author_id?: number;
  author?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  author_name?: string;
  author_email?: string;
  created_at: string;
}

export interface TicketStats {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_category: Record<string, number>;
  overdue: number;
  avg_resolution_time: number;
  open_tickets: number;
  resolved: number;
  pending: number;
}

export interface TicketQueryDto {
  page?: number;
  limit?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  search?: string;
  organization_id?: number;
  store_id?: number;
}

export interface PaginatedTicketsResponse {
  data: Ticket[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface CreateTicketDto {
  title: string;
  description: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  organization_id?: number;
  store_id?: number;
  tags?: string[];
}

export interface UpdateTicketDto {
  title?: string;
  description?: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  status?: TicketStatus;
  assigned_to_user_id?: number;
  tags?: string[];
}

export interface UpdateTicketStatusDto {
  status: TicketStatus;
  reason?: string;
}

export interface CloseTicketDto {
  resolution_summary?: string;
  customer_satisfied?: boolean;
}

export interface AssignTicketDto {
  assigned_to_user_id: number;
}
