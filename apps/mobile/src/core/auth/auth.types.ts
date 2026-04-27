import type { RoleName } from '@vendix/shared-types';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
}

export interface ForgotPasswordData {
  email: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
}

export interface User {
  id: string;
  email: string;
  roles: RoleName[];
  defaultOrganizationId?: string;
  defaultStoreId?: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}
