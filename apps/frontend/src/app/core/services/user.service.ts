import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface User {
  id: number;
  username: string;
  email: string;
  state: 'active' | 'inactive' | 'suspended' | 'archived';
  last_login: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  email_verified: boolean;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  onboarding_completed: boolean;
  organization_id: number;
  user_roles: Array<{
    id: number;
    user_id: number;
    role_id: number;
    roles: {
      id: number;
      name: string;
      description: string;
      is_system_role: boolean;
      created_at: string;
      updated_at: string;
      role_permissions: any[];
    };
  }>;
  organizations?: any;
}

export interface CreateUserDto {
  organization_id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  state?: 'active' | 'inactive';
}

export interface UpdateUserDto {
  first_name?: string;
  last_name?: string;
  email?: string;
  state?: 'active' | 'inactive';
}

export interface UsersListResponse {
  data: User[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly API_URL = `${environment.apiUrl}/api/users`;

  constructor(private http: HttpClient) {}

  // Create user
  createUser(userData: CreateUserDto): Observable<User> {
    return this.http.post<User>(this.API_URL, userData);
  }

  // List users with pagination and filters
  getUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    state?: 'active' | 'inactive' | 'suspended' | 'archived';
    organization_id?: number;
  }): Observable<UsersListResponse> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.page) httpParams = httpParams.set('page', params.page.toString());
      if (params.limit) httpParams = httpParams.set('limit', params.limit.toString());
      if (params.search) httpParams = httpParams.set('search', params.search);
      if (params.state) httpParams = httpParams.set('state', params.state);
      if (params.organization_id) httpParams = httpParams.set('organization_id', params.organization_id.toString());
    }

    return this.http.get<UsersListResponse>(this.API_URL, { params: httpParams });
  }

  // Get user details
  getUser(userId: number): Observable<User> {
    return this.http.get<User>(`${this.API_URL}/${userId}`);
  }

  // Update user
  updateUser(userId: number, userData: UpdateUserDto): Observable<User> {
    return this.http.patch<User>(`${this.API_URL}/${userId}`, userData);
  }

  // Suspend user (soft delete)
  suspendUser(userId: number): Observable<any> {
    return this.http.delete(`${this.API_URL}/${userId}`);
  }

  // Archive user
  archiveUser(userId: number): Observable<any> {
    return this.http.post(`${this.API_URL}/${userId}/archive`, {});
  }

  // Reactivate user
  reactivateUser(userId: number): Observable<User> {
    return this.http.post<User>(`${this.API_URL}/${userId}/reactivate`, {});
  }
}