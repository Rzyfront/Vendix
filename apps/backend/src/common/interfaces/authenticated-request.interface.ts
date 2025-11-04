import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    id: number;
    email: string;
    first_name?: string;
    last_name?: string;
    organization_id?: number;
    store_id?: number;
    user_roles?: Array<{
      id: number;
      user_id: number;
      role_id: number;
      organization_id?: number;
      store_id?: number;
      roles?: {
        id: number;
        name: string;
        description?: string;
      };
    }>;
  };
}
