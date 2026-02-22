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

export interface TicketAttachment {
  id: number;
  file_name: string;
  file_key: string;
  /** S3 signed URL for the file */
  file_url: string;
  file_size?: number;
  file_type?: string;
  mime_type?: string;
  thumbnail_url?: string;
  thumbnail_key?: string;
  width?: number;
  height?: number;
  description?: string;
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
  author_type?: string;
  created_at: string;
  updated_at: string;
  attachments?: TicketAttachment[];
}

export interface Ticket {
  id: number;
  ticket_number: string;
  organization_id: number;
  store_id?: number;
  created_by_user_id: number;
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
  related_order_id?: number;
  related_product_id?: number;
  sla_deadline?: string;
  sla_breached: boolean;
  first_response_at?: string;
  resolved_at?: string;
  closed_at?: string;
  resolution_summary?: string;
  resolution_time_minutes?: number;
  customer_satisfied?: boolean;
  source_channel: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  attachments: TicketAttachment[];
  comments: TicketComment[];
  _count?: {
    comments: number;
    attachments: number;
  };
}

export interface TicketStats {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_category: Record<string, number>;
  overdue: number;
  avg_resolution_time: number;
  open_tickets: number;
  my_tickets: number;
  resolved: number;
  pending: number;
}

export interface CreateTicketRequest {
  title: string;
  description: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  related_order_id?: number;
  related_product_id?: number;
  attachments?: Array<{
    base64_data: string;
    file_name: string;
    mime_type: string;
  }>;
  tags?: string[];
}
