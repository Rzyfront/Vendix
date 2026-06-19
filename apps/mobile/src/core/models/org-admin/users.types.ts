import type { ISODateString } from './common.types';

export type UserState = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';

export interface OrgUser {
  id: string;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string;
  state: UserState;
  email_verified: boolean;
  roles: string[];
  permissions: string[];
  organization_id: string;
  default_store_id?: string | null;
  default_store_name?: string | null;
  last_login_at?: ISODateString;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface InviteUserInput {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  roles: string[];
  default_store_id?: string;
}

export interface UpdateUserInput {
  first_name?: string;
  last_name?: string;
  phone?: string;
  roles?: string[];
  default_store_id?: string | null;
  state?: UserState;
}

export interface UserStats {
  total_usuarios: number;
  activos: number;
  pendientes: number;
  con_2fa: number;
  inactivos: number;
  suspendidos: number;
  email_verificado: number;
  archivados: number;
}
