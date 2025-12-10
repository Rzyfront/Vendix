export enum UserState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

export interface Customer {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  state: UserState;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
  last_login?: Date;
}

export interface CustomerStats {
  total_customers: number;
  active_customers: number;
  new_customers_this_month: number;
}

export interface CustomerQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: string;
  email_verified?: boolean;
  created_from?: Date;
  created_to?: Date;
}
